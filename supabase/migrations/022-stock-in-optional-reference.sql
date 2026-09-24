-- Stock-in references are optional; blank values remain NULL in movement history.
create or replace function public.stock_in(
  p_item_id uuid, p_amount numeric, p_movement_date date, p_reference text,
  p_actor text, p_idempotency_key uuid, p_actor_id uuid, p_intake_branch_or_station text
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, reference text, actor text, created_at timestamptz, new_quantity numeric)
language plpgsql security definer set search_path = public
as $stock_in$
declare
  existing inventory_movements;
  item_status inventory_status;
  movement_id_value uuid;
  created_at_value timestamptz;
  new_quantity_value numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Stock In amount must be greater than 0';
  end if;

  if p_idempotency_key is not null then
    select * into existing
    from public.inventory_movements
    where idempotency_key = p_idempotency_key;

    if existing.id is not null then
      select quantity into new_quantity_value
      from public.inventory
      where id = existing.item_id;

      return query select existing.id, existing.item_id, existing.amount,
        existing.movement_date, existing.reference, existing.actor,
        existing.created_at, new_quantity_value;
      return;
    end if;
  end if;

  select status into item_status
  from public.inventory
  where id = p_item_id
  for update;

  if item_status is null then
    raise exception 'Inventory item not found';
  end if;
  if item_status = 'DISABLED' then
    raise exception 'Cannot Stock In on a disabled item';
  end if;

  insert into public.inventory_movements
    (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
     intake_branch_or_station, purchase_reference, idempotency_key, movement_type)
  values
    (p_item_id, p_amount, p_amount, p_movement_date, nullif(trim(p_reference), ''),
     p_actor, p_actor_id, nullif(trim(p_intake_branch_or_station), ''),
     nullif(trim(p_reference), ''), p_idempotency_key, 'IN')
  returning id, inventory_movements.created_at
    into movement_id_value, created_at_value;

  update public.inventory
  set quantity = quantity + p_amount
  where id = p_item_id
  returning quantity into new_quantity_value;

  return query select movement_id_value, p_item_id, p_amount, p_movement_date,
    nullif(trim(p_reference), ''), p_actor, created_at_value, new_quantity_value;
end;
$stock_in$;

grant execute on function public.stock_in(uuid, numeric, date, text, text, uuid, uuid, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
