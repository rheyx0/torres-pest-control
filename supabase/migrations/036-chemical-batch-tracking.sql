-- ---------------------------------------------------------------------------
-- Migration 036 - Chemical batch tracking and exact application quantities.
--
-- Run after 035-treatment-templates-and-rates.sql.
--
-- Two halves of the same requirement: record WHICH lot of a chemical was used,
-- and HOW MUCH of it, precisely.
--
-- Design note — why the lot is recorded on the movement and not on the item:
--
--   public.inventory holds one row per product, with one quantity. A shelf
--   holding 3 L of Demand CS from lot L24-0917 and 5 L from lot L25-0142 cannot
--   be represented by that row. Modelling it properly means a batches table,
--   which changes what inventory.quantity means for the Inventory page, the
--   reorder logic, every movement and the dashboard.
--
--   The requirement is "batch/lot number for chemicals USED", so the lot is
--   captured at the moment of use — the technician reads it off the container
--   in their hand. That answers both traceability questions:
--
--     from a client  -> which lots were applied at their property
--     from a lot     -> which clients received it   (recall)
--
--   What it deliberately does NOT do is track lots still in stock, so it cannot
--   warn that a held lot is about to expire. That needs the batches table and
--   is a separate, much larger change.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The lot number, on the movement that used it.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements
  add column if not exists batch_number text;

comment on column public.inventory_movements.batch_number is
  'Manufacturer lot/batch code read off the container at the time of use. Recall traceability.';

-- Recall lookups run the other way round — "who received lot L24-0917" — so
-- the index is on the lot, not on the item.
create index if not exists inventory_movements_batch_number_idx
  on public.inventory_movements (batch_number)
  where batch_number is not null;

-- ---------------------------------------------------------------------------
-- 2. Exact quantities.
--
--    Migration 006 added `check (amount = trunc(amount))` across every
--    movement, with the comment "Stock In quantities are counts". That is true
--    for stock IN — you receive 6 whole tubes — and wrong for stock OUT, where
--    0.4 of a litre is the honest number. It was written before movement_type
--    existed, so it over-applied.
--
--    The rule is kept for IN and dropped for OUT. Note this migration is the
--    other half of 035: the app can now show "10 mL per 1 L water" as a
--    standard rate, and until now could not record the fraction that implies.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements
  drop constraint if exists inventory_movements_amount_whole_number_check;

alter table public.inventory_movements
  add constraint inventory_movements_amount_whole_number_check
  check (movement_type <> 'IN' or amount = trunc(amount)) not valid;

-- ---------------------------------------------------------------------------
-- 3. Stock-out carries the lot, and accepts decimals.
--
--    Replaces the migration 026 definition. The argument list is unchanged, but
--    the RETURNS TABLE gains batch_number — and `create or replace` cannot
--    alter a function's return type:
--
--      ERROR 42P13: cannot change return type of existing function
--
--    So the old definition is dropped first. The name and arguments are
--    identical, so nothing calling stock_out_batch needs to change.
-- ---------------------------------------------------------------------------

drop function if exists public.stock_out_batch(uuid, jsonb, date);

create function public.stock_out_batch(
  p_appointment_id uuid,
  p_items jsonb,
  p_movement_date date
)
returns table (movement_id uuid, item_id uuid, appointment_id uuid, amount numeric, movement_date date, actor text, new_quantity numeric, batch_number text)
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

  for item_row in
    select entries.item_id, entries.amount, entries.batch_number
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric, batch_number text)
    order by entries.item_id
  loop
    -- Decimals are now allowed: a technician applying 0.4 L must be able to say so.
    if item_row.amount is null or item_row.amount <= 0 then raise exception 'Stock-Out quantities must be greater than zero.'; end if;

    select status, quantity into item_status, current_quantity from public.inventory where id = item_row.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;
    if item_row.amount > current_quantity then raise exception 'Requested quantity exceeds available stock.'; end if;

    insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id, batch_number)
    values (
      item_row.item_id, item_row.amount, -item_row.amount,
      coalesce(p_movement_date, current_date),
      'Appointment ' || p_appointment_id::text,
      actor_name, actor_id, 'OUT', p_appointment_id,
      nullif(trim(coalesce(item_row.batch_number, '')), '')
    )
    returning id into movement_id_value;

    update public.inventory set quantity = quantity - item_row.amount where id = item_row.item_id returning quantity into new_quantity_value;

    return query select
      movement_id_value, item_row.item_id, p_appointment_id, item_row.amount,
      coalesce(p_movement_date, current_date), actor_name, new_quantity_value,
      nullif(trim(coalesce(item_row.batch_number, '')), '');
  end loop;
end;
$$;

grant execute on function public.stock_out_batch(uuid, jsonb, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recall lookup
--
--   Which clients received a given lot, and when:
--
--     select c.reference, c.name, a.scheduled_at, m.amount, i.name as product
--     from public.inventory_movements m
--     join public.inventory i on i.id = m.item_id
--     join public.appointments a on a.id = m.appointment_id
--     join public.clients c on c.id = a.client_id
--     where m.batch_number = 'L24-0917'
--     order by a.scheduled_at;
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
