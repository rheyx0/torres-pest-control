-- ---------------------------------------------------------------------------
-- Migration 049 - The expiry date comes with the delivery.
--
-- Run after 048-visit-in-progress.sql.
--
-- A chemical's expiry was typed once, on "Add item", and never again. But an
-- item is a product line, not a container: every delivery brings a new lot
-- with its own date printed on it, so the date entered at Add item was only
-- true until the second delivery arrived. The person unboxing the delivery is
-- the one holding the real date, so Stock In is where it is now entered.
--
--   1. stock_in_batch() is recreated from migration 040. Each p_items entry
--      may carry `expiration_date` (a date). When it does, it OVERWRITES the
--      item's inventory.expiration_date; when it does not, the item keeps the
--      date it had. Deliberately simple: the item shows the date of the most
--      recent delivery that gave one. It does not keep a date per lot, so a
--      newer delivery can hide an older, sooner-expiring lot still on the
--      shelf; the office corrects that on Edit item if it matters.
--
--   2. An expiry earlier than the delivery date is refused: stock that has
--      already expired is not something to take into inventory.
--
--   3. The date is also written onto the IN movement
--      (inventory_movements.expiration_date), so the stock history shows
--      which delivery brought which date, and returned from the function so
--      the app can show the item's new date without refetching.
--
-- The signature is unchanged, so the app's call and the grant are the same.
-- Against a database without this migration the old function ignores the
-- extra JSON key: stock still comes in, the expiry just isn't saved.
--
-- THIS FILE IS NOW THE SOURCE OF TRUTH FOR stock_in_batch(): re-running 040
-- restores the version that ignores the expiry, so re-run 049 after it.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements
  add column if not exists expiration_date date;

comment on column public.inventory_movements.expiration_date is
  'Stock In only: the expiry printed on this delivery. Copied onto inventory.expiration_date by stock_in_batch().';

-- The return type gains a column, so the function has to be dropped, not
-- replaced.
drop function if exists public.stock_in_batch(jsonb, date, text, text, uuid);

create function public.stock_in_batch(
  p_items                    jsonb,
  p_movement_date            date,
  p_reference                text,
  p_intake_branch_or_station text,
  p_idempotency_key          uuid
)
returns table (
  movement_id     uuid,
  item_id         uuid,
  amount          numeric,
  movement_date   date,
  reference       text,
  actor           text,
  unit_cost       numeric,
  total_cost      numeric,
  created_at      timestamptz,
  new_quantity    numeric,
  expiration_date date
)
language plpgsql security definer set search_path = public
as $stock_in_batch$
declare
  entry record;
  item_status inventory_status;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  created_at_value timestamptz;
  new_quantity_value numeric;
  new_expiry_value date;
  resolved_cost numeric;
  resolved_amount numeric;
  entry_key uuid;
  row_index integer := 0;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required.';
  end if;
  if nullif(trim(p_reference), '') is null then
    raise exception 'A purchase order or supplier invoice reference is required.';
  end if;
  if nullif(trim(p_intake_branch_or_station), '') is null then
    raise exception 'An intake branch or station is required.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as entries(item_id uuid)
    group by entries.item_id having count(*) > 1
  ) then
    raise exception 'Each inventory item can only be added once per Stock In.';
  end if;

  -- Replayed submission (a double-click, a retried request): the first row of
  -- the batch carries the key, so finding it means the whole batch already
  -- landed. Returning it unchanged is what makes a retry safe.
  if p_idempotency_key is not null
     and exists (select 1 from public.inventory_movements m where m.batch_key = p_idempotency_key) then
    return query
      select m.id, m.item_id, m.amount, m.movement_date, m.reference, m.actor,
             coalesce(m.unit_cost, 0), coalesce(m.total_cost, 0), m.created_at, i.quantity,
             i.expiration_date::date
      from public.inventory_movements m
      join public.inventory i on i.id = m.item_id
      where m.batch_key = p_idempotency_key
      order by m.created_at;
    return;
  end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  for entry in
    select entries.item_id, entries.amount, entries.unit_cost,
           entries.entered_amount, entries.entered_unit, entries.conversion_factor,
           entries.expiration_date
    from jsonb_to_recordset(p_items) as entries(
      item_id uuid, amount numeric, unit_cost numeric,
      entered_amount numeric, entered_unit text, conversion_factor numeric,
      expiration_date date
    )
  loop
    resolved_amount := round(entry.amount, 4);
    if resolved_amount is null or resolved_amount <= 0 then
      raise exception 'Stock In amounts must be greater than 0.';
    end if;

    select status into item_status from public.inventory where id = entry.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item.'; end if;

    resolved_cost := coalesce(entry.unit_cost, 0);
    if resolved_cost < 0 then raise exception 'Purchase cost cannot be negative.'; end if;

    -- 049: a delivery that has already expired is not taken in.
    if entry.expiration_date is not null
       and entry.expiration_date < coalesce(p_movement_date, current_date) then
      raise exception 'This delivery is already expired: the expiry date is before the delivery date.';
    end if;

    -- Only the first row carries the idempotency key: the column is unique, so
    -- it can identify the batch but cannot be repeated across its rows.
    entry_key := case when row_index = 0 then p_idempotency_key else null end;
    row_index := row_index + 1;

    insert into public.inventory_movements (
      item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
      intake_branch_or_station, purchase_reference, idempotency_key, batch_key, movement_type,
      unit_cost, total_cost, entered_amount, entered_unit, conversion_factor,
      expiration_date
    )
    values (
      entry.item_id, resolved_amount, resolved_amount,
      coalesce(p_movement_date, current_date),
      nullif(trim(p_reference), ''), actor_name, actor_account_id,
      nullif(trim(p_intake_branch_or_station), ''), nullif(trim(p_reference), ''),
      entry_key, p_idempotency_key, 'IN',
      resolved_cost, round(resolved_cost * resolved_amount, 2),
      entry.entered_amount, nullif(trim(coalesce(entry.entered_unit, '')), ''),
      coalesce(entry.conversion_factor, 1),
      entry.expiration_date
    )
    returning id, inventory_movements.created_at into movement_id_value, created_at_value;

    -- 049: the delivery's expiry, when it gave one, replaces the item's.
    update public.inventory
    set quantity = quantity + resolved_amount,
        cost = case when entry.unit_cost is null then cost else resolved_cost end,
        expiration_date = coalesce(entry.expiration_date::timestamptz, inventory.expiration_date)
    where id = entry.item_id
    returning quantity, inventory.expiration_date::date into new_quantity_value, new_expiry_value;

    return query select
      movement_id_value, entry.item_id, resolved_amount,
      coalesce(p_movement_date, current_date), nullif(trim(p_reference), ''), actor_name,
      resolved_cost, round(resolved_cost * resolved_amount, 2),
      created_at_value, new_quantity_value, new_expiry_value;
  end loop;
end;
$stock_in_batch$;

grant execute on function public.stock_in_batch(jsonb, date, text, text, uuid) to anon, authenticated;
