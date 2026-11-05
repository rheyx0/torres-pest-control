-- Migration 021 — Apply scheduling audit additions to databases that already ran 020.
-- Run after migration 020. Safe to run more than once.

alter table public.inventory_movements add column if not exists movement_type text not null default 'IN';
alter table public.inventory_movements add column if not exists quantity_delta numeric;
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('IN', 'OUT', 'CORRECTION'));
update public.inventory_movements
set quantity_delta = case when movement_type = 'OUT' then -amount else amount end
where quantity_delta is null;

create or replace function public.stock_out_batch(
  p_appointment_id uuid,
  p_items jsonb,
  p_movement_date date
)
returns table (movement_id uuid, item_id uuid, appointment_id uuid, amount numeric, movement_date date, actor text, new_quantity numeric)
language plpgsql security definer set search_path = public
as $$
declare item_row record; item_status inventory_status; current_quantity numeric; actor_name text; actor_id uuid; movement_id_value uuid; new_quantity_value numeric;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status <> 'Cancelled') then raise exception 'Active appointment not found.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one stock-out item is required.'; end if;
  if exists (
    select entries.item_id
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric)
    group by entries.item_id
    having count(*) > 1
  ) then raise exception 'Each inventory item can only be added once per stock-out.'; end if;
  select r.id, coalesce(a.name, s.name, t.name) into actor_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id left join public.staff s on s.id = r.id left join public.technicians t on t.id = r.id limit 1;
  for item_row in select entries.item_id, entries.amount from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric) order by entries.item_id loop
    if item_row.amount is null or item_row.amount <= 0 then raise exception 'Stock Out amount must be greater than 0.'; end if;
    select status, quantity into item_status, current_quantity from public.inventory where id = item_row.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;
    if item_row.amount > current_quantity then raise exception 'Requested quantity exceeds available stock.'; end if;
    insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id)
    values (item_row.item_id, item_row.amount, -item_row.amount, coalesce(p_movement_date, current_date), 'Appointment ' || p_appointment_id::text, actor_name, actor_id, 'OUT', p_appointment_id)
    returning id into movement_id_value;
    update public.inventory set quantity = quantity - item_row.amount where id = item_row.item_id returning quantity into new_quantity_value;
    return query select movement_id_value, item_row.item_id, p_appointment_id, item_row.amount, coalesce(p_movement_date, current_date), actor_name, new_quantity_value;
  end loop;
end;
$$;
grant execute on function public.stock_out_batch(uuid, jsonb, date) to anon, authenticated;

create or replace function public.stock_correction(
  p_item_id uuid,
  p_delta numeric,
  p_reason text,
  p_movement_date date
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, reference text, actor text, new_quantity numeric)
language plpgsql security definer set search_path = public
as $$
declare item_status inventory_status; current_quantity numeric; actor_name text; actor_id uuid; movement_id_value uuid; new_quantity_value numeric;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Correction amount cannot be zero.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A correction reason is required.'; end if;
  select status, quantity into item_status, current_quantity from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found.'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot correct a disabled item.'; end if;
  if current_quantity + p_delta < 0 then raise exception 'Correction cannot make stock negative.'; end if;
  select r.id, coalesce(a.name, s.name, t.name) into actor_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id left join public.staff s on s.id = r.id left join public.technicians t on t.id = r.id limit 1;
  insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type)
  values (p_item_id, abs(p_delta), p_delta, coalesce(p_movement_date, current_date), trim(p_reason), actor_name, actor_id, 'CORRECTION')
  returning id into movement_id_value;
  update public.inventory set quantity = quantity + p_delta where id = p_item_id returning quantity into new_quantity_value;
  return query select movement_id_value, p_item_id, abs(p_delta), coalesce(p_movement_date, current_date), trim(p_reason), actor_name, new_quantity_value;
end;
$$;
grant execute on function public.stock_correction(uuid, numeric, text, date) to anon, authenticated;

create or replace function public.stock_in(
  p_item_id uuid, p_amount numeric, p_movement_date date, p_reference text,
  p_actor text, p_idempotency_key uuid, p_actor_id uuid, p_intake_branch_or_station text
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, reference text, actor text, created_at timestamptz, new_quantity numeric)
language plpgsql security definer set search_path = public
as $stock_in$
declare existing inventory_movements; item_status inventory_status; movement_id_value uuid; created_at_value timestamptz; new_quantity_value numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Stock In amount must be greater than 0'; end if;
  if nullif(trim(p_reference), '') is null then raise exception 'A purchase order or supplier invoice reference is required'; end if;
  if p_idempotency_key is not null then
    select * into existing from public.inventory_movements where idempotency_key = p_idempotency_key;
    if existing.id is not null then select quantity into new_quantity_value from public.inventory where id = existing.item_id; return query select existing.id, existing.item_id, existing.amount, existing.movement_date, existing.reference, existing.actor, existing.created_at, new_quantity_value; return; end if;
  end if;
  select status into item_status from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item'; end if;
  insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, intake_branch_or_station, purchase_reference, idempotency_key, movement_type)
  values (p_item_id, p_amount, p_amount, p_movement_date, nullif(trim(p_reference), ''), p_actor, p_actor_id, nullif(trim(p_intake_branch_or_station), ''), nullif(trim(p_reference), ''), p_idempotency_key, 'IN')
  returning id, inventory_movements.created_at into movement_id_value, created_at_value;
  update public.inventory set quantity = quantity + p_amount where id = p_item_id returning quantity into new_quantity_value;
  return query select movement_id_value, p_item_id, p_amount, p_movement_date, nullif(trim(p_reference), ''), p_actor, created_at_value, new_quantity_value;
end;
$stock_in$;
grant execute on function public.stock_in(uuid, numeric, date, text, text, uuid, uuid, text) to anon, authenticated;
notify pgrst, 'reload schema';
