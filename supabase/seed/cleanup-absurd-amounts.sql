-- ===========================================================================
-- Clean up impossible amounts left from before the limits existed.
--
-- Run after migration 058, by hand, in the Supabase SQL Editor.
-- Not a migration: it changes existing data, so look before you run it.
--
-- STEP 1 — run only the "PREVIEW" block and read what it lists.
-- STEP 2 — run the "FIX" block.
--
-- What FIX changes, and what it leaves alone:
--
--   * A stock movement with an impossible COST (unit cost over ₱999,999.99, a
--     total over ₱99,999,999,000, or a negative one) has its cost cleared: the
--     unit cost becomes blank and the total 0. Its QUANTITY is not touched, so
--     stock levels do not move. A note on the row says why.
--   * An item whose "cost per unit" is impossible gets the unit cost of its
--     latest sensible delivery, or 0 if it has none.
--   * A batch (migration 055) or an appointment price that is impossible is
--     cleared.
--   * Impossible QUANTITIES are only reported. Changing a stock level has to
--     be a recorded movement, not a silent edit — send the list and they can
--     be corrected properly.
--
-- It ends by validating migration 058's constraints that no longer have a
-- row breaking them, so the database guarantees them from then on.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PREVIEW (changes nothing)
-- ---------------------------------------------------------------------------

select 'movement cost' as problem, m.id, i.name as item, m.movement_date, m.amount, m.unit_cost, m.total_cost
from public.inventory_movements m
left join public.inventory i on i.id = m.item_id
where m.unit_cost > 999999.99 or m.unit_cost < 0 or m.total_cost > 99999999000 or m.total_cost < 0
union all
select 'movement quantity', m.id, i.name, m.movement_date, m.amount, m.unit_cost, m.total_cost
from public.inventory_movements m
left join public.inventory i on i.id = m.item_id
where m.amount > 100000 or m.amount < 0
union all
select 'item cost', i.id, i.name, null, i.quantity, i.cost, null
from public.inventory i
where i.cost > 999999.99 or i.cost < 0
union all
select 'item quantity', i.id, i.name, null, i.quantity, i.cost, null
from public.inventory i
where i.quantity > 10000000 or i.quantity < 0
order by 1, 4;


-- ---------------------------------------------------------------------------
-- FIX
-- ---------------------------------------------------------------------------

begin;

-- Movement costs: cleared, quantities kept. A row whose quantity is also
-- impossible is left for the report: migration 058's limits check the whole
-- row on update, so clearing only its cost would still be refused.
update public.inventory_movements m
set unit_cost = null,
    total_cost = 0,
    note = concat_ws(' ', nullif(trim(coalesce(m.note, '')), ''),
      '[Cost cleared: the recorded figure was impossible (unit ' || coalesce(m.unit_cost::text, '—') || ', total ' || coalesce(m.total_cost::text, '—') || ').]')
where (m.unit_cost > 999999.99 or m.unit_cost < 0 or m.total_cost > 99999999000 or m.total_cost < 0)
  and m.amount between 0 and 100000;

-- Item cost: the latest sensible delivery's unit cost, else 0.
update public.inventory i
set cost = coalesce((
  select m.unit_cost from public.inventory_movements m
  where m.item_id = i.id and m.movement_type = 'IN'
    and m.unit_cost is not null and m.unit_cost between 0 and 999999.99
  order by m.movement_date desc, m.created_at desc
  limit 1
), 0)
where (i.cost > 999999.99 or i.cost < 0)
  and i.quantity between 0 and 10000000
  and (i.reorder_level is null or i.reorder_level between 0 and 100000);

-- Batch costs and appointment prices.
do $$
begin
  if to_regclass('public.inventory_batches') is not null then
    update public.inventory_batches b set unit_cost = null
    where (b.unit_cost > 999999.99 or b.unit_cost < 0)
      and b.quantity <= 10000000 and b.quantity_received <= 10000000;
  end if;
end;
$$;

update public.appointments a set price = null
where a.price > 999999.99 or a.price < 0;

-- Validate each 058 constraint that nothing breaks any more; report the rest.
do $$
declare
  target record;
  broken boolean;
begin
  for target in
    select * from (values
      ('inventory', 'inventory_cost_limit_check', 'cost > 999999.99 or cost < 0'),
      ('inventory', 'inventory_quantity_limit_check', 'quantity > 10000000 or quantity < 0'),
      ('inventory', 'inventory_reorder_level_limit_check', 'reorder_level > 100000 or reorder_level < 0'),
      ('inventory_movements', 'inventory_movements_amount_limit_check', 'amount > 100000 or amount < 0'),
      ('inventory_movements', 'inventory_movements_unit_cost_limit_check', 'unit_cost > 999999.99 or unit_cost < 0'),
      ('inventory_movements', 'inventory_movements_total_cost_limit_check', 'total_cost > 99999999000 or total_cost < 0'),
      ('appointments', 'appointments_price_limit_check', 'price > 999999.99 or price < 0')
    ) as checks(table_name, constraint_name, violation)
  loop
    execute format('select exists (select 1 from public.%I where %s)', target.table_name, target.violation) into broken;
    if broken then
      raise notice 'Not validated: % still has rows where %. Send the PREVIEW output to have them corrected.', target.table_name, target.violation;
    else
      execute format('alter table public.%I validate constraint %I', target.table_name, target.constraint_name);
    end if;
  end loop;
end;
$$;

commit;
