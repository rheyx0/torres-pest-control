-- ===========================================================================
-- Torres Pest Control — demo data, part 5 of 5: stock movements and stock levels
--
-- The single-file supabase/seed-demo-data.sql is 58 KB, which the Supabase
-- SQL Editor's paste box does not always take in one piece — a paste cut off
-- mid-statement fails with "syntax error at end of input" pointing at an
-- empty line. These parts are the same SQL, small enough to paste reliably.
--
-- RUN THEM IN ORDER, 1 to 5. Each is its own transaction, so a part either
-- lands whole or not at all. Each also refuses to run if the part before it
-- has not, so getting the order wrong tells you rather than corrupting the
-- data. Starting again from part 1 is always safe: it clears everything
-- first.
--
-- If you can use psql instead, prefer the single file — one transaction over
-- the whole seed is a stronger guarantee than five:
--   psql "$SUPABASE_DB_URL" -f supabase/seed-demo-data.sql
-- ===========================================================================

begin;

-- Prerequisite check: this part builds on the one before it.
do $guard$
begin
  if not exists (select 1 from public.appointment_reports where appointment_id = 'a0000000-0000-4000-8000-000000000013') then
    raise exception 'Part 4 has not been run: the demo service reports are missing. Run the parts in order, 1 to 5.';
  end if;
end $guard$;

-- 8. Stock coming in
--
--    Two of these deliveries were received in a unit the item is not tracked
--    in — a drum in US gallons, a sack in pounds — which is what the
--    conversion added in migration 040 exists for. Both figures are kept:
--    entered_amount / entered_unit is what the delivery note said, `amount`
--    is what the stock level moved by.
-- ---------------------------------------------------------------------------

with office as (
  select coalesce(
    (select a.id from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.id from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as id,
  coalesce(
    (select a.name from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.name from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as name
)
insert into public.inventory_movements (
  item_id, amount, quantity_delta, movement_date, reference, purchase_reference,
  actor, actor_id, intake_branch_or_station, movement_type, unit_cost, total_cost,
  entered_amount, entered_unit, conversion_factor, batch_key, created_at
)
select
  v.item_id, v.amount, v.amount,
  current_date + v.day_offset,
  v.reference, v.reference,
  office.name, office.id, v.station, 'IN',
  v.unit_cost, round(v.unit_cost * v.amount, 2),
  v.entered_amount, v.entered_unit, v.conversion_factor,
  v.batch_key,
  ((current_date + v.day_offset)::timestamp + time '10:00') at time zone 'Asia/Manila'
from (values
  -- Opening stock, one delivery note across the chemical store.
  ('e0000000-0000-4000-8000-000000000001'::uuid, 24::numeric, -60, 'PO-2024-0731'::text, 'Main Warehouse'::text, 2850.00::numeric, null::numeric, null::text, 1::numeric, 'b0000000-0000-4000-8000-000000000001'::uuid),
  ('e0000000-0000-4000-8000-000000000002', 18, -60, 'PO-2024-0731', 'Main Warehouse', 3450.00, null, null, 1, 'b0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000006', 2500, -60, 'PO-2024-0731', 'Main Warehouse', 9.80, null, null, 1, 'b0000000-0000-4000-8000-000000000001'),

  -- A drum of termiticide bought in US gallons, tracked in litres.
  -- 5 gal x 3.785411784 = 18.9271 L.
  ('e0000000-0000-4000-8000-000000000003', 18.9271, -40, 'PO-2024-0806', 'Main Warehouse', 5200.00, 5, 'gal', 3.785411784, 'b0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000004', 12, -38, 'PO-2024-0806', 'Main Warehouse', 6800.00, null, null, 1, 'b0000000-0000-4000-8000-000000000002'),

  -- Rodenticide bought by the pound, tracked in kilograms.
  -- 20 lb x 0.45359237 = 9.0718 kg.
  ('e0000000-0000-4000-8000-000000000007', 9.0718, -26, 'INV-8842', 'Main Warehouse', 1250.00, 20, 'lb', 0.45359237, 'b0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000005', 1200, -30, 'INV-8842', 'Main Warehouse', 18.50, null, null, 1, 'b0000000-0000-4000-8000-000000000003'),

  -- Fumigant, ordered against a job.
  ('e0000000-0000-4000-8000-000000000008', 400, -36, 'PO-2024-0818', 'Main Warehouse', 42.00, null, null, 1, 'b0000000-0000-4000-8000-000000000004'),

  -- Equipment and consumables.
  ('e0000000-0000-4000-8000-000000000009', 4, -60, 'PO-2024-0725', 'Main Warehouse', 6500.00, null, null, 1, 'b0000000-0000-4000-8000-000000000005'),
  ('e0000000-0000-4000-8000-000000000010', 1, -60, 'PO-2024-0725', 'Main Warehouse', 185000.00, null, null, 1, 'b0000000-0000-4000-8000-000000000005'),
  ('e0000000-0000-4000-8000-000000000011', 3, -60, 'PO-2024-0725', 'Main Warehouse', 12500.00, null, null, 1, 'b0000000-0000-4000-8000-000000000005'),
  ('e0000000-0000-4000-8000-000000000012', 3, -60, 'PO-2024-0725', 'Main Warehouse', 4800.00, null, null, 1, 'b0000000-0000-4000-8000-000000000005'),

  ('e0000000-0000-4000-8000-000000000013', 60, -48, 'PO-2024-0742', 'Main Warehouse', 385.00, null, null, 1, 'b0000000-0000-4000-8000-000000000006'),
  ('e0000000-0000-4000-8000-000000000014', 250, -48, 'PO-2024-0742', 'Main Warehouse', 65.00, null, null, 1, 'b0000000-0000-4000-8000-000000000006'),
  ('e0000000-0000-4000-8000-000000000015', 24, -48, 'PO-2024-0742', 'Toril Station', 480.00, null, null, 1, 'b0000000-0000-4000-8000-000000000006'),
  ('e0000000-0000-4000-8000-000000000016', 30, -48, 'PO-2024-0742', 'Toril Station', 950.00, null, null, 1, 'b0000000-0000-4000-8000-000000000006'),
  ('e0000000-0000-4000-8000-000000000017', 50, -48, 'PO-2024-0742', 'Toril Station', 320.00, null, null, 1, 'b0000000-0000-4000-8000-000000000006'),

  -- Received long before the product was withdrawn. It is disabled now, so no
  -- further Stock In is possible — but the drums are still on the shelf, which
  -- is the whole reason the item is disabled rather than deleted.
  ('e0000000-0000-4000-8000-000000000018', 6, -59, 'PO-2023-0410', 'Main Warehouse', 1950.00, null, null, 1, 'b0000000-0000-4000-8000-000000000008'),

  -- A top-up delivery three weeks ago, so the history has more than one date.
  ('e0000000-0000-4000-8000-000000000001', 8, -21, 'PO-2024-0903', 'Main Warehouse', 2920.00, null, null, 1, 'b0000000-0000-4000-8000-000000000007'),
  ('e0000000-0000-4000-8000-000000000014', 120, -21, 'PO-2024-0903', 'Main Warehouse', 68.00, null, null, 1, 'b0000000-0000-4000-8000-000000000007'),
  ('e0000000-0000-4000-8000-000000000015', 12, -21, 'PO-2024-0903', 'Toril Station', 495.00, null, null, 1, 'b0000000-0000-4000-8000-000000000007')
) as v(item_id, amount, day_offset, reference, station, unit_cost, entered_amount, entered_unit, conversion_factor, batch_key),
office;

-- ---------------------------------------------------------------------------
-- 9. Stock used on jobs
--
--    Dated and attributed to the visit that consumed it, so the client's
--    "Materials used" list and the appointment's stock-out tab both have
--    something in them. Chemicals carry the lot number read off the container.
-- ---------------------------------------------------------------------------

insert into public.inventory_movements (
  item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
  movement_type, appointment_id, batch_number, stock_out_reason, created_at
)
select
  v.item_id, v.amount, -v.amount,
  (a.scheduled_at at time zone 'Asia/Manila')::date,
  'Appointment ' || a.id::text,
  coalesce(t.name, 'Technician'), a.technician_id,
  'OUT', a.id, v.batch_number, 'APPOINTMENT',
  a.scheduled_at + (a.duration_minutes || ' minutes')::interval
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'e0000000-0000-4000-8000-000000000005'::uuid, 35::numeric, 'MFG-2405-118'::text),
  ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 0.4, 'DMD-2404-092'),

  ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 2.5, 'SLF-2403-441'),
  ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000005', 60, 'MFG-2405-118'),
  ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000014', 8, null),

  ('a0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002', 1.8, 'DMD-2404-092'),
  ('a0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000005', 90, 'MFG-2405-118'),

  ('a0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000007', 1.6, 'RCM-2402-017'),
  ('a0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000013', 4, null),
  ('a0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000017', 2, null),

  ('a0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000008', 180, 'QPH-2401-330'),
  ('a0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000017', 6, null),
  ('a0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000016', 6, null),

  ('a0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000004', 5.5, 'TRM-2404-201'),
  ('a0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000003', 4.2, 'PRM-2403-778'),
  ('a0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000017', 4, null),

  ('a0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000005', 55, 'MFG-2405-118'),
  ('a0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000006', 120, 'KOT-2404-063'),

  ('a0000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000005', 40, 'MFG-2405-118'),

  ('a0000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000001', 1.9, 'SLF-2403-441'),
  ('a0000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000006', 150, 'KOT-2404-063'),

  ('a0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000007', 1.2, 'RCM-2402-017'),
  ('a0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000014', 12, null),

  ('a0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000002', 1.5, 'DMD-2404-092'),
  ('a0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000005', 75, 'MFG-2405-118'),

  ('a0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000003', 2.8, 'PRM-2403-778')
) as v(appointment_id, item_id, amount, batch_number)
join public.appointments a on a.id = v.appointment_id
left join public.technicians t on t.id = a.technician_id;

-- ---------------------------------------------------------------------------
-- 10. Stock leaving for the other three reasons
--
--     A technician checkout names the person holding it, which is the whole
--     point of recording the reason. Missing and damaged name nobody. All
--     three are backdated, because a shortfall is found days after it happens
--     — which is why the date on that form is editable.
-- ---------------------------------------------------------------------------

with crew as (
  select array_agg(t.id order by t.created_at, t.id) as ids,
         array_agg(t.name order by t.created_at, t.id) as names
  from public.technicians t
  where t.status = 'ACTIVE'
),
office as (
  select coalesce(
    (select a.id from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.id from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as id,
  coalesce(
    (select a.name from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.name from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as name
)
insert into public.inventory_movements (
  item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
  movement_type, stock_out_reason, technician_id, note, created_at
)
select
  v.item_id, v.amount, -v.amount,
  current_date + v.day_offset,
  case v.reason
    when 'TECHNICIAN_CHECKOUT' then 'Checked out by ' || crew.names[1 + (v.tech_slot % array_length(crew.ids, 1))]
    when 'MISSING' then 'Missing stock'
    else 'Damaged stock'
  end,
  office.name, office.id,
  'OUT', v.reason,
  case when v.reason = 'TECHNICIAN_CHECKOUT'
       then crew.ids[1 + (v.tech_slot % array_length(crew.ids, 1))] end,
  v.note,
  ((current_date + v.day_offset)::timestamp + time '16:30') at time zone 'Asia/Manila'
from (values
  ('e0000000-0000-4000-8000-000000000015'::uuid, 4::numeric, -19, 'TECHNICIAN_CHECKOUT'::text, 0::int,
   'Weekly PPE issue for the Toril route.'::text),
  ('e0000000-0000-4000-8000-000000000013', 6, -16, 'TECHNICIAN_CHECKOUT', 1,
   'Taken for the Ecoland station replacements.'),
  ('e0000000-0000-4000-8000-000000000016', 2, -11, 'TECHNICIAN_CHECKOUT', 2,
   'Cartridge change before the Calinan fumigation.'),
  ('e0000000-0000-4000-8000-000000000014', 25, -23, 'MISSING', 0,
   'Physical count came up 25 boards short against the log. Suspect an unrecorded issue on the Bajada route.'),
  ('e0000000-0000-4000-8000-000000000002', 1.0, -13, 'DAMAGED', 0,
   'One litre bottle cracked in transit and leaked in the vehicle bin. Disposed of per MSDS.'),
  ('e0000000-0000-4000-8000-000000000013', 3, -8, 'DAMAGED', 0,
   'Three stations crushed by a forklift at the Toril warehouse. Lids unusable.')
) as v(item_id, amount, day_offset, reason, tech_slot, note),
crew, office;

-- ---------------------------------------------------------------------------
-- 11. One counted correction
--
--     A physical count that disagreed with the log, which is what the
--     correction path is for — as distinct from stock that actually left.
-- ---------------------------------------------------------------------------

with office as (
  select coalesce(
    (select a.id from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.id from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as id,
  coalesce(
    (select a.name from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.name from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as name
)
insert into public.inventory_movements (
  item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, created_at
)
select
  v.item_id, abs(v.delta), v.delta,
  current_date + v.day_offset,
  v.reason, office.name, office.id, 'CORRECTION',
  ((current_date + v.day_offset)::timestamp + time '17:00') at time zone 'Asia/Manila'
from (values
  ('e0000000-0000-4000-8000-000000000017'::uuid, 5::numeric, -6::int,
   'Quarterly count: five extra coveralls found in the Toril station locker, never logged as received.'::text),
  ('e0000000-0000-4000-8000-000000000008', -20, -5,
   'Quarterly count: twenty tablets short. Fumigant cabinet log reconciled with the licensed fumigator.')
) as v(item_id, delta, day_offset, reason),
office;

-- ---------------------------------------------------------------------------
-- 12. Stock levels, derived from the log
--
--     Not typed in above and not kept in step by hand. The movement log is
--     the record; the quantity is a sum of it. Anything else drifts, which is
--     exactly why the app has no quantity field to type into.
-- ---------------------------------------------------------------------------

update public.inventory i
set quantity = coalesce((
  select sum(m.quantity_delta)
  from public.inventory_movements m
  where m.item_id = i.id
), 0);

-- A safety net rather than a formality: a negative stock level would mean the
-- movements above are wrong, and it is better to fail here than to hand
-- somebody a demo that quietly disagrees with itself.
do $$
declare bad_item text;
begin
  select i.name into bad_item from public.inventory i where i.quantity < 0 limit 1;
  if bad_item is not null then
    raise exception 'Seed produced a negative stock level for "%". Fix the movements above.', bad_item;
  end if;
end $$;

-- Migration 055 tracks chemicals by batch; the truncate in part 1 cleared
-- them. Each seeded chemical's stock becomes its opening batch. Skipped on a
-- database without 055.
do $$
declare chemical uuid;
begin
  if to_regprocedure('public.ensure_item_batches(uuid)') is null then return; end if;
  for chemical in select i.id from public.inventory i where i.type = 'CHEMICAL' and i.quantity > 0 loop
    perform public.ensure_item_batches(chemical);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';
