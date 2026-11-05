-- ---------------------------------------------------------------------------
-- Migration 079 - stock handed to a technician is signed for, by both.
--
-- Run after 078-warranty-and-checkups.sql.
--
-- On paper the business has the person handing stock over and the technician
-- taking it both sign. The activity log only says who typed the stock out in,
-- so it is not proof of who took it. Now a checkout carries both signatures:
--
--   inventory_movements.handover_signature_path   who handed it over
--   inventory_movements.receiver_signature_path   the technician who took it
--   inventory_movements.handover_group            one id per handover, shared
--                                                 by its lines (one slip)
--   inventory_movements.handed_over_by_name
--
-- stock_out_lines_signed(...) is the app's way to check stock out to a
-- technician: it refuses without both signatures (images uploaded first to
-- the report-attachments bucket under checkouts/), books the lines through
-- 069's stock_out_lines in the same transaction, and stamps every movement it
-- made. stock_out_lines and stock_out_manual themselves are untouched, so
-- write-offs (missing, damaged, expired) need no signatures.
--
-- Nothing existing is replaced. Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements add column if not exists handover_signature_path text;
alter table public.inventory_movements add column if not exists receiver_signature_path text;
alter table public.inventory_movements add column if not exists handover_group uuid;
alter table public.inventory_movements add column if not exists handed_over_by_name text;
create index if not exists inventory_movements_handover_group_idx on public.inventory_movements (handover_group) where handover_group is not null;

drop function if exists public.stock_out_lines_signed(jsonb, date, uuid, text, uuid, text, text);

create function public.stock_out_lines_signed(
  p_lines              jsonb,
  p_movement_date      date,
  p_technician_id      uuid,
  p_note               text,
  p_for_appointment_id uuid,
  p_handover_path      text,
  p_receiver_path      text
)
returns table (
  movement_id        uuid,
  item_id            uuid,
  amount             numeric,
  movement_date      date,
  reason             text,
  technician_id      uuid,
  actor              text,
  note               text,
  new_quantity       numeric,
  for_appointment_id uuid,
  batch_id           uuid,
  batch_number       text,
  handover_group     uuid
)
language plpgsql security definer set search_path = public
as $signed$
declare
  v_group uuid := gen_random_uuid();
  v_actor text;
  v_row record;
  v_ids uuid[] := '{}';
begin
  if not public.is_office_account() then raise exception 'Only the office checks stock out to a technician.'; end if;
  if p_technician_id is null then raise exception 'Select the technician the stock is going to.'; end if;
  if nullif(trim(coalesce(p_handover_path, '')), '') is null then raise exception 'The person handing the stock over must sign.'; end if;
  if nullif(trim(coalesce(p_receiver_path, '')), '') is null then raise exception 'The technician taking the stock must sign.'; end if;

  select coalesce(a.name, s.name) into v_actor
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  limit 1;

  for v_row in
    select * from public.stock_out_lines(p_lines, p_movement_date, 'TECHNICIAN_CHECKOUT', p_technician_id, p_note, p_for_appointment_id)
  loop
    v_ids := v_ids || v_row.movement_id;
    movement_id := v_row.movement_id;
    item_id := v_row.item_id;
    amount := v_row.amount;
    movement_date := v_row.movement_date;
    reason := v_row.reason;
    technician_id := v_row.technician_id;
    actor := v_row.actor;
    note := v_row.note;
    new_quantity := v_row.new_quantity;
    for_appointment_id := v_row.for_appointment_id;
    batch_id := v_row.batch_id;
    batch_number := v_row.batch_number;
    handover_group := v_group;
    return next;
  end loop;

  -- A statement of its own, so it sees the movements just booked.
  update public.inventory_movements m
    set handover_signature_path = trim(p_handover_path),
        receiver_signature_path = trim(p_receiver_path),
        handover_group = v_group,
        handed_over_by_name = v_actor
    where m.id = any(v_ids);
end;
$signed$;

grant execute on function public.stock_out_lines_signed(jsonb, date, uuid, text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
