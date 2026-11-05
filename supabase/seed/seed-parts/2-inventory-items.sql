-- ===========================================================================
-- Torres Pest Control — demo data, part 2 of 5: inventory items
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
  if not exists (select 1 from public.clients where reference = 'TPC-C-0013') then
    raise exception 'Part 1 has not been run: the demo clients are missing. Run the parts in order, 1 to 5.';
  end if;
end $guard$;

-- 3. Inventory
--
--    Products a Philippine pest-control operator actually carries, with PHP
--    costs in the right order of magnitude. Quantity is deliberately NOT set
--    here: it is recomputed from the movement log at the end of this script,
--    which is the only arrangement that cannot drift — the same rule the app
--    enforces by refusing to expose a quantity field.
--
--    Reorder levels are set so a few items land on Low Stock once the
--    movements below have run. An inventory page where nothing is ever low is
--    a page whose badge nobody has seen working.
-- ---------------------------------------------------------------------------

insert into public.inventory (
  id, name, type, unit, cost, supplier, storage_location, reorder_level, status,
  intake_branch_or_station, chemical_type, expiration_date, safety_level, hazard_rating, date_received,
  serial_number, condition, last_maintenance_date, next_maintenance_date, manufacturer, model,
  material_category, description, created_at
) values
  -- Chemicals ---------------------------------------------------------------
  ('e0000000-0000-4000-8000-000000000001', 'Solfac EW 050', 'CHEMICAL', 'L', 2850.00,
   'Bayer Environmental Science PH', 'Chemical Store A', 8, 'ACTIVE', 'Main Warehouse',
   'INSECTICIDE', now() + interval '14 months', 'High',
   'Harmful if swallowed. Full PPE and respirator required.', now() - interval '60 days',
   null, null, null, null, null, null, null, null, now() - interval '20 months'),

  ('e0000000-0000-4000-8000-000000000002', 'Demand CS 2.5', 'CHEMICAL', 'L', 3450.00,
   'Syngenta Crop Protection PH', 'Chemical Store A', 6, 'ACTIVE', 'Main Warehouse',
   'INSECTICIDE', now() + interval '20 months', 'High',
   'Skin and eye irritant. Do not apply over open food surfaces.', now() - interval '55 days',
   null, null, null, null, null, null, null, null, now() - interval '20 months'),

  ('e0000000-0000-4000-8000-000000000003', 'Premise 200 SC', 'CHEMICAL', 'L', 5200.00,
   'Envu Philippines', 'Chemical Store B', 10, 'ACTIVE', 'Main Warehouse',
   'INSECTICIDE', now() + interval '18 months', 'High',
   'Termiticide. Keep away from wells, ponds and drainage.', now() - interval '40 days',
   null, null, null, null, null, null, null, null, now() - interval '19 months'),

  ('e0000000-0000-4000-8000-000000000004', 'Termidor SC', 'CHEMICAL', 'L', 6800.00,
   'BASF Philippines', 'Chemical Store B', 8, 'ACTIVE', 'Main Warehouse',
   'INSECTICIDE', now() + interval '22 months', 'High',
   'Termiticide. Soil application only — never indoors as a surface spray.', now() - interval '38 days',
   null, null, null, null, null, null, null, null, now() - interval '15 months'),

  ('e0000000-0000-4000-8000-000000000005', 'Maxforce Forte Gel Bait', 'CHEMICAL', 'g', 18.50,
   'Bayer Environmental Science PH', 'Chemical Store A', 400, 'ACTIVE', 'Main Warehouse',
   'INSECTICIDE', now() + interval '11 months', 'Medium',
   'Low hazard in use. Place out of reach of children and pets.', now() - interval '30 days',
   null, null, null, null, null, null, null, null, now() - interval '18 months'),

  ('e0000000-0000-4000-8000-000000000006', 'K-Othrine WG 250', 'CHEMICAL', 'g', 9.80,
   'Envu Philippines', 'Chemical Store A', 600, 'ACTIVE', 'Main Warehouse',
   'INSECTICIDE', now() + interval '16 months', 'Medium',
   'Wettable granule. Mix outdoors, avoid inhaling the dust.', now() - interval '52 days',
   null, null, null, null, null, null, null, null, now() - interval '12 months'),

  ('e0000000-0000-4000-8000-000000000007', 'Racumin Paste Bait', 'CHEMICAL', 'kg', 1250.00,
   'Bayer Environmental Science PH', 'Chemical Store A', 7, 'ACTIVE', 'Main Warehouse',
   'RODENTICIDE', now() + interval '9 months', 'High',
   'Anticoagulant rodenticide. Secured bait stations only.', now() - interval '26 days',
   null, null, null, null, null, null, null, null, now() - interval '17 months'),

  ('e0000000-0000-4000-8000-000000000008', 'Quickphos Fumigation Tablets', 'CHEMICAL', 'pcs', 42.00,
   'Excel Crop Care PH', 'Locked Fumigant Cabinet', 120, 'ACTIVE', 'Main Warehouse',
   'FUMIGANT', now() + interval '7 months', 'High',
   'Releases phosphine gas. Licensed fumigator and gas monitor mandatory.', now() - interval '36 days',
   null, null, null, null, null, null, null, null, now() - interval '14 months'),

  -- Equipment ---------------------------------------------------------------
  ('e0000000-0000-4000-8000-000000000009', 'Solo 425 Knapsack Sprayer 16L', 'EQUIPMENT', 'pcs', 6500.00,
   'Solo Philippines', 'Equipment Room', 2, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null,
   'SOLO-425-0117', 'ACTIVE', now() - interval '2 months', now() + interval '4 months', 'Solo', '425',
   null, null, now() - interval '21 months'),

  ('e0000000-0000-4000-8000-000000000010', 'Igeba TF-35 Thermal Fogger', 'EQUIPMENT', 'pcs', 185000.00,
   'Igeba Geraetebau GmbH', 'Equipment Room', 1, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null,
   'IGEBA-TF35-0042', 'MAINTENANCE', now() - interval '20 days', now() + interval '10 days', 'Igeba', 'TF-35',
   null, null, now() - interval '30 months'),

  ('e0000000-0000-4000-8000-000000000011', 'B&G Extenda-Ban Sprayer 1 gal', 'EQUIPMENT', 'pcs', 12500.00,
   'B&G Equipment Company', 'Equipment Room', 2, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null,
   'BG-VS1-0208', 'ACTIVE', now() - interval '3 months', now() + interval '3 months', 'B&G Equipment', 'VS-1',
   null, null, now() - interval '24 months'),

  ('e0000000-0000-4000-8000-000000000012', 'Termite Soil Injection Rod', 'EQUIPMENT', 'pcs', 4800.00,
   'Pestech Supplies Davao', 'Equipment Room', 2, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null,
   'TSR-0031', 'ACTIVE', now() - interval '5 months', now() + interval '1 month', 'Pestech', 'PT-Rod',
   null, null, now() - interval '18 months'),

  -- Materials ---------------------------------------------------------------
  ('e0000000-0000-4000-8000-000000000013', 'Protecta LP Bait Station', 'MATERIAL', 'pcs', 385.00,
   'Bell Laboratories', 'Materials Rack 1', 25, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null, null, null, null, null, null, null,
   'TOOLS_ACCESSORIES', 'Tamper-resistant station for exterior rodent baiting. Keyed lid.',
   now() - interval '19 months'),

  ('e0000000-0000-4000-8000-000000000014', 'Glue Board Trap', 'MATERIAL', 'pcs', 65.00,
   'Pestech Supplies Davao', 'Materials Rack 1', 80, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null, null, null, null, null, null, null,
   'SUPPLIES', 'Non-toxic monitoring board for indoor rodent and crawling-insect counts.',
   now() - interval '19 months'),

  ('e0000000-0000-4000-8000-000000000015', 'Nitrile Gloves (Box of 100)', 'MATERIAL', 'boxes', 480.00,
   'Davao Safety Supply', 'Materials Rack 2', 10, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null, null, null, null, null, null, null,
   'PROTECTIVE_GEAR', 'Powder-free, chemical resistant. Issued per technician per week.',
   now() - interval '16 months'),

  ('e0000000-0000-4000-8000-000000000016', 'Respirator Cartridge (Organic Vapour)', 'MATERIAL', 'pcs', 950.00,
   'Davao Safety Supply', 'Materials Rack 2', 12, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null, null, null, null, null, null, null,
   'PROTECTIVE_GEAR', 'Replace after 40 hours of use or on first breakthrough of odour.',
   now() - interval '16 months'),

  ('e0000000-0000-4000-8000-000000000017', 'Disposable Coverall', 'MATERIAL', 'pcs', 320.00,
   'Davao Safety Supply', 'Materials Rack 2', 20, 'ACTIVE', 'Main Warehouse',
   null, null, null, null, null, null, null, null, null, null, null,
   'PROTECTIVE_GEAR', 'Type 5/6 coverall for fumigation and soil-treatment work.',
   now() - interval '12 months'),

  -- One disabled item, so the greyed-out row and the blocked Stock In are
  -- visible without anyone having to disable something first.
  ('e0000000-0000-4000-8000-000000000018', 'Chlorpyrifos 480 EC (withdrawn)', 'CHEMICAL', 'L', 1950.00,
   'Legacy supplier', 'Chemical Store B', null, 'DISABLED', 'Main Warehouse',
   'INSECTICIDE', now() - interval '2 months', 'High',
   'Withdrawn from use. Held pending licensed disposal — do not issue.', now() - interval '30 months',
   null, null, null, null, null, null, null, null, now() - interval '30 months');

-- ---------------------------------------------------------------------------
commit;
