-- ---------------------------------------------------------------------------
-- Migration 058 - Hard limits on money and quantities, on the tables.
--
-- Run after 057-technician-absences.sql.
--
-- Migration 047 capped every NEW stock movement (100,000 units, ₱999,999.99
-- a unit) with a trigger, and the forms check the same limits. Two holes were
-- left:
--
--   - rows written before 047 were never checked. A few test deliveries with
--     absurd costs (₱1.1 × 10^284) are still in the log, and the Today page's
--     Cost & stock panel adds them up;
--   - inventory.cost ("Cost per unit" on Edit item) and a few other columns
--     had no database limit at all — only the form's.
--
-- This adds CHECK constraints on the tables themselves, so no path — a form,
-- an RPC, a direct API call, hand-run SQL — can store an impossible figure.
-- They are added NOT VALID: they apply to every row written or changed from
-- now on, but do not fail this migration because of old rows. Clean those up
-- with supabase/cleanup-absurd-amounts.sql, which finishes by validating the
-- constraints, so from then on the whole table is guaranteed.
--
-- The limits match src/utils/constants.js LIMITS:
--   MAX_UNIT_COST / MAX_PRICE   ₱999,999.99
--   MAX_MOVEMENT_QTY            100,000 units in one movement
-- plus a stock level of at most 10,000,000 units and a movement total of at
-- most 100,000 × ₱999,999.99.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- Items.
alter table public.inventory drop constraint if exists inventory_cost_limit_check;
alter table public.inventory add constraint inventory_cost_limit_check
  check (cost is null or (cost >= 0 and cost <= 999999.99)) not valid;

alter table public.inventory drop constraint if exists inventory_quantity_limit_check;
alter table public.inventory add constraint inventory_quantity_limit_check
  check (quantity >= 0 and quantity <= 10000000) not valid;

alter table public.inventory drop constraint if exists inventory_reorder_level_limit_check;
alter table public.inventory add constraint inventory_reorder_level_limit_check
  check (reorder_level is null or (reorder_level >= 0 and reorder_level <= 100000)) not valid;

-- Stock movements: 047's trigger covers inserts; these cover updates too, and
-- the total, which the trigger never looked at.
alter table public.inventory_movements drop constraint if exists inventory_movements_amount_limit_check;
alter table public.inventory_movements add constraint inventory_movements_amount_limit_check
  check (amount >= 0 and amount <= 100000) not valid;

alter table public.inventory_movements drop constraint if exists inventory_movements_unit_cost_limit_check;
alter table public.inventory_movements add constraint inventory_movements_unit_cost_limit_check
  check (unit_cost is null or (unit_cost >= 0 and unit_cost <= 999999.99)) not valid;

alter table public.inventory_movements drop constraint if exists inventory_movements_total_cost_limit_check;
alter table public.inventory_movements add constraint inventory_movements_total_cost_limit_check
  check (total_cost is null or (total_cost >= 0 and total_cost <= 99999999000)) not valid;

-- Appointments: 047's RPCs cap the price; this caps the column.
alter table public.appointments drop constraint if exists appointments_price_limit_check;
alter table public.appointments add constraint appointments_price_limit_check
  check (price is null or (price >= 0 and price <= 999999.99)) not valid;

-- Chemical batches (055), when they exist.
do $$
begin
  if to_regclass('public.inventory_batches') is not null then
    alter table public.inventory_batches drop constraint if exists inventory_batches_limit_check;
    alter table public.inventory_batches add constraint inventory_batches_limit_check
      check (quantity <= 10000000 and quantity_received <= 10000000
             and (unit_cost is null or (unit_cost >= 0 and unit_cost <= 999999.99))) not valid;
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying: rows the constraints do not yet vouch for (clean them up with
-- supabase/cleanup-absurd-amounts.sql).
--
--   select id, name, quantity, cost from public.inventory
--   where cost > 999999.99 or cost < 0 or quantity > 10000000 or quantity < 0;
--
--   select id, movement_date, amount, unit_cost, total_cost from public.inventory_movements
--   where amount > 100000 or unit_cost > 999999.99 or total_cost > 99999999000;
-- ---------------------------------------------------------------------------
