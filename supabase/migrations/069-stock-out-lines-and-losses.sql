-- ---------------------------------------------------------------------------
-- Migration 069 - stock out several items at once, and losses on stock a
-- technician is holding.
--
-- Run after 068-follow-up-visits.sql.
--
--   1. stock_out_lines(lines, date, reason, technician, note, for visit):
--      the Inventory page's Stock out with a line per item, like Receive
--      delivery. Each line goes through 055's stock_out_manual() (batches,
--      soonest expiry first, the 047 limits), all in one transaction: if any
--      line is refused, none is recorded. lines = [{ item_id, amount, batch_id }].
--
--   2. report_checkout_loss(checkout, amount, kind, note, date): stock a
--      technician checked out was lost, stolen or damaged. Before this the
--      only way to close what a technician held was return_checkout(), which
--      puts the stock back on the shelf, stock that no longer exists. A loss
--      is an OUT movement pointing at the checkout (checkout_id), so
--      checkout_remaining() goes down, with quantity_delta 0: the stock left
--      the shelf when it was checked out, so the shelf does not change again.
--      Its reason is MISSING (lost, stolen) or DAMAGED, so it counts in the
--      "Missing / damaged" figures, with the technician named. Office only.
--
--   054's inventory_movements_checkout_link_check let only a visit's usage
--   (APPOINTMENT) or a RETURN point at a checkout; it now lets a loss
--   (MISSING, DAMAGED) point at one too.
--
-- Nothing else existing is replaced. Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements drop constraint if exists inventory_movements_checkout_link_check;
alter table public.inventory_movements add constraint inventory_movements_checkout_link_check
  check (checkout_id is null or stock_out_reason in ('APPOINTMENT', 'MISSING', 'DAMAGED') or movement_type = 'RETURN');

-- 054's inventory_movements_checkout_technician_check let a technician be
-- named only on a checkout or a return; a loss on a checkout names them too.
alter table public.inventory_movements drop constraint if exists inventory_movements_checkout_technician_check;
alter table public.inventory_movements add constraint inventory_movements_checkout_technician_check
  check (
    technician_id is null
    or stock_out_reason = 'TECHNICIAN_CHECKOUT'
    or movement_type = 'RETURN'
    or (checkout_id is not null and stock_out_reason in ('MISSING', 'DAMAGED'))
  );

drop function if exists public.stock_out_lines(jsonb, date, text, uuid, text, uuid);

create function public.stock_out_lines(
  p_lines              jsonb,
  p_movement_date      date,
  p_reason             text,
  p_technician_id      uuid,
  p_note               text,
  p_for_appointment_id uuid default null
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
  batch_number       text
)
language plpgsql security definer set search_path = public
as $stock_out_lines$
declare
  line jsonb;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to stock out.';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'Stock out at most 50 lines at a time.';
  end if;

  for line in select value from jsonb_array_elements(p_lines) loop
    return query
      select * from public.stock_out_manual(
        (line->>'item_id')::uuid,
        (line->>'amount')::numeric,
        p_movement_date,
        p_reason,
        p_technician_id,
        p_note,
        case when p_reason = 'TECHNICIAN_CHECKOUT' then p_for_appointment_id else null end,
        nullif(line->>'batch_id', '')::uuid
      );
  end loop;
end;
$stock_out_lines$;

grant execute on function public.stock_out_lines(jsonb, date, text, uuid, text, uuid) to anon, authenticated;

drop function if exists public.report_checkout_loss(uuid, numeric, text, text, date);

create function public.report_checkout_loss(
  p_checkout_id   uuid,
  p_amount        numeric,
  p_kind          text,
  p_note          text,
  p_movement_date date default null
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, remaining numeric)
language plpgsql security definer set search_path = public
as $report_checkout_loss$
declare
  checkout public.inventory_movements;
  left_out numeric;
  technician_name text;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  happened_on date;
  label text;
begin
  if coalesce(public.current_account_role(), '') not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can report stock as lost or damaged.';
  end if;
  if p_kind is null or p_kind not in ('LOST', 'STOLEN', 'DAMAGED') then
    raise exception 'Choose whether the stock was lost, stolen or damaged.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a quantity greater than zero.'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Write what happened.';
  end if;

  select * into checkout from public.inventory_movements m
  where m.id = p_checkout_id and m.stock_out_reason = 'TECHNICIAN_CHECKOUT';
  if checkout.id is null then raise exception 'That checkout was not found.'; end if;
  if checkout.custody_closed_at is not null then
    raise exception 'That checkout was settled before custody was tracked.';
  end if;

  -- Serialise with return_checkout() and visit draws on the same item.
  perform 1 from public.inventory i where i.id = checkout.item_id for update;

  left_out := public.checkout_remaining(checkout.id);
  if p_amount > left_out then
    raise exception 'Only % is still out on this checkout.', left_out;
  end if;

  happened_on := coalesce(p_movement_date, current_date);
  if happened_on < checkout.movement_date then
    raise exception 'A loss cannot be dated before the checkout.';
  end if;

  select t.name into technician_name from public.technicians t where t.id = checkout.technician_id;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  label := case p_kind when 'LOST' then 'Lost' when 'STOLEN' then 'Stolen' else 'Damaged' end
    || ' while with ' || coalesce(technician_name, 'a technician');

  insert into public.inventory_movements (
    item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
    movement_type, stock_out_reason, technician_id, note, checkout_id, batch_id, batch_number
  )
  values (
    checkout.item_id, p_amount, 0, happened_on, label, actor_name, actor_account_id,
    'OUT', case when p_kind = 'DAMAGED' then 'DAMAGED' else 'MISSING' end, checkout.technician_id,
    trim(p_note), checkout.id, checkout.batch_id, checkout.batch_number
  )
  returning id into movement_id_value;

  return query select movement_id_value, checkout.item_id, p_amount, happened_on, left_out - p_amount;
end;
$report_checkout_loss$;

grant execute on function public.report_checkout_loss(uuid, numeric, text, text, date) to anon, authenticated;

notify pgrst, 'reload schema';
