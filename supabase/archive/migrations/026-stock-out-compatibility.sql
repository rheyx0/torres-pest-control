-- Migration 026 - Ensure appointment Stock-Out updates inventory and history.

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
  if exists (select entries.item_id from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric) group by entries.item_id having count(*) > 1) then raise exception 'Each inventory item can only be added once per stock-out.'; end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  for item_row in select entries.item_id, entries.amount from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric) order by entries.item_id loop
    if item_row.amount is null or item_row.amount <= 0 or item_row.amount <> trunc(item_row.amount) then raise exception 'Stock-Out quantities must be positive whole numbers.'; end if;
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
notify pgrst, 'reload schema';
