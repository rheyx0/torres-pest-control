-- ===========================================================================
-- Torres Pest Control — demo data
--
-- THIS SCRIPT DELETES DATA. Read the next twenty lines before running it.
--
-- WHAT IT WIPES
--   clients, client_documents, appointments, appointment_technicians,
--   appointment_reports, appointment_report_attachments, notifications,
--   inventory, inventory_movements.
--
-- WHAT IT KEEPS, UNTOUCHED
--   admins, staff, technicians, sessions — every account and every password.
--   treatment_methods, which is admin-managed reference data, not records.
--   Files already sitting in the Storage buckets. See "Storage" below.
--
-- WHERE IT LIVES, AND WHY NOT IN migrations/
--   A file in supabase/migrations/ is applied in numeric order on every
--   database, including production. A truncate has no business in that
--   sequence. This is run by hand, once, on a database you intend to reset.
--
-- BEFORE YOU RUN IT
--   Apply migrations 040, 041 and 042 first. This script writes to columns
--   they add (inventory_movements.stock_out_reason, appointments.price,
--   appointment_technicians, clients.service_notes) and will fail on a
--   database that is still on 039.
--
-- HOW TO RUN IT
--   Supabase dashboard → SQL Editor → paste → Run. It is one transaction:
--   any error rolls the whole thing back and your old data survives.
--   Afterwards, run `notify pgrst, 'reload schema';` if the app reports a
--   missing column (the last statement here already does).
--
-- ACCOUNTS
--   Technicians are not created here — the script reads whichever ACTIVE
--   technician accounts you already have and deals the work out among them
--   round-robin. It works with one technician and it works with six. Jobs
--   that are meant to be two-handed ask for a second technician and quietly
--   fall back to one where there is only one account to give.
--
-- STORAGE
--   No client_documents or appointment_report_attachments rows are seeded,
--   and no report signatures. Those rows are metadata pointing at objects in
--   the private buckets; inventing rows for files that do not exist would
--   produce a client profile whose documents all fail to open. Upload a
--   couple through the app instead — that exercises the real path.
--   Completed visits are therefore closed with a written completion note,
--   which is the same thing the office does when the customer signed a
--   printed form.
--
-- DATES
--   Everything is relative to the day you run it — roughly eight weeks of
--   history and three weeks of upcoming work — so the calendar has content
--   whenever you seed. Times are Asia/Manila and sit inside the 07:00–19:00
--   booking window the app enforces.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run without an account to hang the work on.
--
--    Rather than silently seeding appointments with no technician, which
--    looks like a broken calendar rather than an empty one.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.technicians where status = 'ACTIVE') then
    raise exception 'No ACTIVE technician accounts. Create at least one in the app before seeding.';
  end if;
  if not exists (select 1 from public.admins where status = 'ACTIVE')
     and not exists (select 1 from public.staff where status = 'ACTIVE') then
    raise exception 'No ACTIVE admin or staff account to record as the booker.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Clear the records.
--
--    One TRUNCATE so the foreign keys between these tables do not dictate a
--    delete order. CASCADE only reaches tables that reference the ones named,
--    and every such table is named — the account tables are not referenced by
--    any of them (technician_id has deliberately never been a foreign key),
--    so they cannot be caught by it.
-- ---------------------------------------------------------------------------

truncate table
  public.appointment_report_attachments,
  public.appointment_reports,
  public.appointment_technicians,
  public.notifications,
  public.inventory_movements,
  public.appointments,
  public.client_documents,
  public.clients,
  public.inventory
restart identity cascade;

-- Client codes are handed out by a sequence with a column default. Restarting
-- it keeps the seeded references (TPC-C-0001…) and the next client added in
-- the app (TPC-C-0014) in one unbroken run.
select setval('public.client_reference_seq', 13, true);

-- ---------------------------------------------------------------------------
-- 2. Clients
--
--    Davao City addresses and a spread of classifications, because the
--    classification drives both the filters and whether the profile offers a
--    Service Notes box. Households have no service notes: a standing
--    instruction is a company-account problem — one door, one person, nothing
--    to brief anybody on.
-- ---------------------------------------------------------------------------

insert into public.clients (
  id, reference, name, email, phone, address,
  classification, classification_other, pest_concern, source, service_notes, status, created_at
) values
  ('c0000000-0000-4000-8000-000000000001', 'TPC-C-0001', 'Juan Dela Cruz',
   'juan.delacruz@gmail.com', '09171234567',
   'Blk 7 Lot 12, Ulas Subdivision, Brgy. Ulas, Davao City',
   'RESIDENTIAL', null, 'Cockroaches', 'Referral', null, 'ACTIVE', now() - interval '18 months'),

  ('c0000000-0000-4000-8000-000000000002', 'TPC-C-0002', 'Maria Lourdes Sarmiento',
   'mlsarmiento@yahoo.com', '09283456712',
   '24 Sampaguita St., Matina Crossing, Davao City',
   'RESIDENTIAL', null, 'Termites', 'Facebook', null, 'ACTIVE', now() - interval '14 months'),

  ('c0000000-0000-4000-8000-000000000003', 'TPC-C-0003', 'Arawan Logistics Center',
   'admin@arawanlogistics.com.ph', '09189876543',
   'Km 18 Davao-Cotabato Rd, Brgy. Bato, Toril, Davao City',
   'WAREHOUSE_STORAGE', null, 'Rodents', 'Website Contact Form',
   'Gate 3 only — Gate 1 is for container trucks. Sign in with the guard and ask for the Warehouse Supervisor. '
   || 'No spraying inside the dry-goods racking bays; bait stations along the perimeter only. '
   || 'Service window is 06:00–08:00 before the pickers start.',
   'ACTIVE', now() - interval '22 months'),

  ('c0000000-0000-4000-8000-000000000004', 'TPC-C-0004', 'Kadayawan Suites Hotel',
   'engineering@kadayawansuites.ph', '09175551212',
   '118 San Pedro St., Poblacion District, Davao City',
   'HOSPITALITY', null, 'Bed Bugs', 'Referral',
   'Coordinate with Engineering before entering any guest floor — rooms must be blocked 24h in advance. '
   || 'Back-of-house and kitchen only between 14:00 and 16:00. Service invoices go to Finance, attention Ms. Rowena.',
   'ACTIVE', now() - interval '26 months'),

  ('c0000000-0000-4000-8000-000000000005', 'TPC-C-0005', 'Dabaw Fresh Supermart',
   'operations@dabawfresh.com', '09209988776',
   'J.P. Laurel Ave., Bajada, Davao City',
   'COMMERCIAL', null, 'Cockroaches', 'Phone Call',
   'Treatment after closing only, from 21:00. Wet market and meat section need food-safe products — '
   || 'no residual spraying over open display chillers. Store Manager must countersign the service form.',
   'ACTIVE', now() - interval '20 months'),

  ('c0000000-0000-4000-8000-000000000006', 'TPC-C-0006', 'Mindanao Fruits Packing Plant',
   'qa@mindanaofruits.com.ph', '09171119988',
   'Purok 5, Brgy. Calinan, Davao City',
   'AGRICULTURAL', null, 'Flies', 'Referral',
   'HACCP site: chemical list and MSDS must be handed to QA before every visit. '
   || 'Fumigation requires a 48-hour notice and a plant shutdown clearance. Full PPE inside the packing line, no exceptions.',
   'ACTIVE', now() - interval '16 months'),

  ('c0000000-0000-4000-8000-000000000007', 'TPC-C-0007', 'Holy Cross Learning Center',
   'admin@holycrosslc.edu.ph', '09277654321',
   '12 Bangkal Rd., Brgy. Bangkal, Davao City',
   'EDUCATIONAL', null, 'Ants', 'Walk-in',
   'Weekends and school holidays only — never during class hours. '
   || 'Canteen and clinic are priority areas. Leave the treatment record with the School Administrator.',
   'ACTIVE', now() - interval '11 months'),

  ('c0000000-0000-4000-8000-000000000008', 'TPC-C-0008', 'San Pedro Medical Clinic',
   'frontdesk@sanpedroclinic.ph', '09088765544',
   '2F Uyanguren Bldg., Ramon Magsaysay Ave., Davao City',
   'MEDICAL_FACILITY', null, 'Cockroaches', 'Email',
   'Low-odour products only; the clinic reopens at 08:00 the next morning. '
   || 'No treatment inside the treatment rooms or the pharmacy store — those are wiped down by their own staff.',
   'ACTIVE', now() - interval '9 months'),

  ('c0000000-0000-4000-8000-000000000009', 'TPC-C-0009', 'Ricardo Ompad',
   'rick.ompad@gmail.com', '09336667788',
   'Lot 4 Blk 9, Mintal, Tugbok District, Davao City',
   'RESIDENTIAL', null, 'Rodents', 'Walk-in', null, 'ACTIVE', now() - interval '7 months'),

  ('c0000000-0000-4000-8000-000000000010', 'TPC-C-0010', 'Davao Bayview Apartments',
   'property@bayviewdavao.ph', '09184443322',
   '77 Quimpo Blvd., Ecoland, Davao City',
   'COMMERCIAL', null, 'Rodents', 'Google Business Profile',
   'Common areas, garbage room and the basement car park are under contract — individual units are billed separately. '
   || 'Collect the key to the garbage room from the caretaker, Mang Berting.',
   'ACTIVE', now() - interval '13 months'),

  ('c0000000-0000-4000-8000-000000000011', 'TPC-C-0011', 'St. Joseph Parish Hall',
   'parishoffice@stjosephdavao.org', '09225558899',
   'Brgy. Talomo, Davao City',
   'RELIGIOUS_INSTITUTION', null, 'Termites', 'Referral',
   'Avoid Saturdays and Sundays entirely. The narra pews and the retablo are heritage pieces — '
   || 'no drilling without the Parish Priest present.',
   'ACTIVE', now() - interval '10 months'),

  ('c0000000-0000-4000-8000-000000000012', 'TPC-C-0012', 'Barangay Ulas Multi-Purpose Hall',
   'brgyulas.office@davaocity.gov.ph', '09171230099',
   'Brgy. Ulas Hall, Ulas, Davao City',
   'GOVERNMENT_OFFICE', null, 'General Pest Control', 'Walk-in',
   'Purchase order number must appear on the service form or Accounting will not release payment. '
   || 'Book through the Barangay Secretary; the hall is used for sessions every Tuesday.',
   'ACTIVE', now() - interval '5 months'),

  ('c0000000-0000-4000-8000-000000000013', 'TPC-C-0013', 'Lourdes Sari-Sari Store',
   null, '09399997766',
   'Purok 2, Brgy. Talomo Proper, Davao City',
   'COMMERCIAL', null, 'Ants', 'Walk-in', null, 'ARCHIVED', now() - interval '24 months');

-- ---------------------------------------------------------------------------
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
-- 4. Appointments
--
--    Eight weeks behind and three weeks ahead. `lead_slot` is not a technician
--    id — it is a position dealt round-robin across whichever ACTIVE technician
--    accounts this database has, so the script does not care how many there
--    are or what they are called.
--
--    Every appointment has its own timestamp. The database holds a unique
--    index on (technician_id, scheduled_at) for live appointments, and with a
--    single technician account every job here would otherwise land on them.
-- ---------------------------------------------------------------------------

with crew as (
  select array_agg(t.id order by t.created_at, t.id) as ids
  from public.technicians t
  where t.status = 'ACTIVE'
),
office as (
  select coalesce(
    (select a.id from public.admins a where a.status = 'ACTIVE' order by a.is_primary desc, a.created_at limit 1),
    (select s.id from public.staff  s where s.status = 'ACTIVE' order by s.created_at limit 1)
  ) as id
)
insert into public.appointments (
  id, client_id, scheduled_at, duration_minutes, pest_concern, service_type, service_location,
  technician_id, status, notes, created_by, service_frequency, price, cancellation_reason, created_at
)
select
  v.id, v.client_id,
  ((current_date + v.day_offset)::timestamp + v.start_at) at time zone 'Asia/Manila',
  v.duration, v.pest_concern, v.service_type, v.service_location,
  crew.ids[1 + (v.lead_slot % array_length(crew.ids, 1))],
  v.status, v.notes, office.id, v.frequency, v.price, v.cancellation_reason,
  ((current_date + v.day_offset)::timestamp + v.start_at) at time zone 'Asia/Manila' - interval '6 days'
from (values
  -- ---- history --------------------------------------------------------- --
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
   -56, time '09:00', 60, 'Cockroaches'::text, 'General Treatment'::text,
   'Blk 7 Lot 12, Ulas Subdivision, Brgy. Ulas, Davao City'::text,
   0, 'Completed'::text, 'Kitchen and comfort room only. Dog on the premises — keep the gate closed.'::text,
   'Quarterly'::text, 2500::numeric, null::text),

  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000004',
   -49, time '14:00', 180, 'Bed Bugs', 'Maintenance Contract',
   '118 San Pedro St., Poblacion District, Davao City',
   1, 'Completed', 'Monthly contract visit. Floors 3 and 4 back-of-house, laundry and kitchen.',
   'Monthly', 12500, null),

  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000005',
   -45, time '08:00', 120, 'Cockroaches', 'General Treatment',
   'J.P. Laurel Ave., Bajada, Davao City',
   2, 'Completed', 'After-hours service. Store Manager countersigned.',
   'Monthly', 8500, null),

  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003',
   -42, time '06:30' + interval '1 hour', 150, 'Rodents', 'Rodent Control',
   'Km 18 Davao-Cotabato Rd, Brgy. Bato, Toril, Davao City',
   0, 'Completed', 'Perimeter stations checked and re-baited. Two stations found tampered near Gate 3.',
   'Monthly', 9800, null),

  ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000006',
   -35, time '08:00', 300, 'Flies', 'Fumigation',
   'Purok 5, Brgy. Calinan, Davao City',
   1, 'Completed', 'Plant shutdown clearance issued by QA. Full crew, gas monitor on site.',
   'Quarterly', 18500, null),

  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002',
   -31, time '08:30', 240, 'Termites', 'Soil Poisoning',
   '24 Sampaguita St., Matina Crossing, Davao City',
   2, 'Completed', 'Full perimeter soil treatment with drill-and-inject at the extension slab.',
   'One-time', 38000, null),

  ('a0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000007',
   -28, time '09:00', 120, 'Ants', 'General Treatment',
   '12 Bangkal Rd., Brgy. Bangkal, Davao City',
   0, 'Completed', 'Saturday service, no classes. Canteen and clinic prioritised.',
   'Quarterly', 6500, null),

  ('a0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000008',
   -21, time '17:30', 90, 'Cockroaches', 'General Treatment',
   '2F Uyanguren Bldg., Ramon Magsaysay Ave., Davao City',
   1, 'Completed', 'Low-odour gel only. Treatment rooms and pharmacy skipped as agreed.',
   'Monthly', 5400, null),

  ('a0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000004',
   -18, time '14:00', 180, 'Bed Bugs', 'Maintenance Contract',
   '118 San Pedro St., Poblacion District, Davao City',
   2, 'Completed', 'Room 412 reported bites. Blocked 24h in advance and treated.',
   'Monthly', 12500, null),

  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000009',
   -14, time '10:00', 45, 'Rodents', 'Inspection',
   'Lot 4 Blk 9, Mintal, Tugbok District, Davao City',
   0, 'Completed', 'Walk-in enquiry. Inspection and quotation only, no treatment on this visit.',
   'One-time', 1200, null),

  ('a0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000010',
   -12, time '08:00', 120, 'Rodents', 'Rodent Control',
   '77 Quimpo Blvd., Ecoland, Davao City',
   1, 'Completed', 'Garbage room, basement car park and both stair cores.',
   'Monthly', 7200, null),

  ('a0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000005',
   -9, time '08:00', 120, 'Cockroaches', 'General Treatment',
   'J.P. Laurel Ave., Bajada, Davao City',
   2, 'Completed', 'Monthly contract visit. Drain treatment added at the wet market side.',
   'Monthly', 8500, null),

  ('a0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000011',
   -7, time '09:30', 120, 'Termites', 'Termite Control',
   'Brgy. Talomo, Davao City',
   0, 'Completed', 'Parish Priest present throughout. No drilling near the retablo.',
   'Semi-annual', 4800, null),

  -- A cancelled visit and one waiting to be moved, so both states exist on
  -- the calendar without anybody having to create them.
  ('a0000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000012',
   -20, time '13:00', 90, 'General Pest Control', 'General Treatment',
   'Brgy. Ulas Hall, Ulas, Davao City',
   1, 'Cancelled', 'Booked against PO 2024-0188.',
   'Quarterly', 5200, 'Barangay session moved into the hall. Rebooking once Accounting reissues the PO.'),

  ('a0000000-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000002',
   -3, time '10:00', 90, 'Termites', 'Follow-up Visit',
   '24 Sampaguita St., Matina Crossing, Davao City',
   2, 'Reschedule', '30-day check on the soil treatment. Client asked to move it — waiting on a new date.',
   'One-time', 1500, null),

  -- ---- upcoming -------------------------------------------------------- --
  ('a0000000-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000004',
   1, time '14:00', 180, 'Bed Bugs', 'Maintenance Contract',
   '118 San Pedro St., Poblacion District, Davao City',
   0, 'Confirmed', 'Monthly contract visit. Engineering notified.',
   'Monthly', 12500, null),

  ('a0000000-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000003',
   2, time '07:00', 150, 'Rodents', 'Rodent Control',
   'Km 18 Davao-Cotabato Rd, Brgy. Bato, Toril, Davao City',
   1, 'Confirmed', 'Before the pickers start. Replace the two tampered stations.',
   'Monthly', 9800, null),

  ('a0000000-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000001',
   3, time '09:00', 60, 'Cockroaches', 'General Treatment',
   'Blk 7 Lot 12, Ulas Subdivision, Brgy. Ulas, Davao City',
   2, 'Confirmed', 'Quarterly visit. Client prefers mornings.',
   'Quarterly', 2500, null),

  ('a0000000-0000-4000-8000-000000000019', 'c0000000-0000-4000-8000-000000000008',
   4, time '17:30', 90, 'Cockroaches', 'General Treatment',
   '2F Uyanguren Bldg., Ramon Magsaysay Ave., Davao City',
   0, 'Pending', 'Awaiting confirmation from the front desk.',
   'Monthly', 5400, null),

  ('a0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000007',
   6, time '09:00', 120, 'Ants', 'General Treatment',
   '12 Bangkal Rd., Brgy. Bangkal, Davao City',
   1, 'Pending', 'Saturday slot requested. Confirm the school is closed.',
   'Quarterly', 6500, null),

  ('a0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000006',
   8, time '08:00', 300, 'Flies', 'Fumigation',
   'Purok 5, Brgy. Calinan, Davao City',
   2, 'Confirmed', '48-hour notice already served. Shutdown clearance pending countersign.',
   'Quarterly', 18500, null),

  ('a0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000010',
   10, time '08:00', 120, 'Rodents', 'Rodent Control',
   '77 Quimpo Blvd., Ecoland, Davao City',
   0, 'Pending', 'Caretaker to be reminded about the garbage room key.',
   'Monthly', 7200, null),

  ('a0000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000005',
   13, time '08:00', 120, 'Cockroaches', 'General Treatment',
   'J.P. Laurel Ave., Bajada, Davao City',
   1, 'Confirmed', 'Monthly contract visit.',
   'Monthly', 8500, null),

  ('a0000000-0000-4000-8000-000000000024', 'c0000000-0000-4000-8000-000000000009',
   16, time '10:00', 60, 'Rodents', 'Follow-up Visit',
   'Lot 4 Blk 9, Mintal, Tugbok District, Davao City',
   2, 'Pending', 'Quotation accepted over the phone. Bait stations to be installed.',
   'One-time', 1500, null)
) as v(id, client_id, day_offset, start_at, duration, pest_concern, service_type, service_location,
       lead_slot, status, notes, frequency, price, cancellation_reason),
crew, office;

-- ---------------------------------------------------------------------------
-- 5. Who is on each job
--
--    The lead comes straight off the appointment. The second and third pair
--    are added only for the jobs that genuinely take a crew — a fumigation, a
--    full soil treatment, a hotel contract visit. ON CONFLICT DO NOTHING is
--    what makes the script work on a database with one technician: the extra
--    hand resolves to the same person and is dropped rather than duplicated.
-- ---------------------------------------------------------------------------

insert into public.appointment_technicians (appointment_id, technician_id, is_lead)
select a.id, a.technician_id, true
from public.appointments a
where a.technician_id is not null;

with crew as (
  select array_agg(t.id order by t.created_at, t.id) as ids
  from public.technicians t
  where t.status = 'ACTIVE'
)
insert into public.appointment_technicians (appointment_id, technician_id, is_lead)
select v.appointment_id, crew.ids[1 + ((v.lead_slot + v.extra) % array_length(crew.ids, 1))], false
from (values
  -- appointment,                                        lead_slot, extra hand
  ('a0000000-0000-4000-8000-000000000002'::uuid, 1, 1),  -- hotel contract visit
  ('a0000000-0000-4000-8000-000000000004'::uuid, 0, 1),  -- warehouse rodent round
  ('a0000000-0000-4000-8000-000000000005'::uuid, 1, 1),  -- fumigation
  ('a0000000-0000-4000-8000-000000000005'::uuid, 1, 2),  -- fumigation, third hand
  ('a0000000-0000-4000-8000-000000000006'::uuid, 2, 1),  -- soil treatment
  ('a0000000-0000-4000-8000-000000000009'::uuid, 2, 1),  -- hotel contract visit
  ('a0000000-0000-4000-8000-000000000016'::uuid, 0, 1),  -- upcoming hotel visit
  ('a0000000-0000-4000-8000-000000000021'::uuid, 2, 1),  -- upcoming fumigation
  ('a0000000-0000-4000-8000-000000000021'::uuid, 2, 2)   -- upcoming fumigation, third hand
) as v(appointment_id, lead_slot, extra),
crew
on conflict (appointment_id, technician_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Service reports on the completed visits
--
--    signature_path stays null on purpose — see "Storage" in the header. The
--    visit is closed by completion_note instead, which is exactly how the app
--    models "the customer signed the printed form" versus "the customer signed
--    on the tablet".
-- ---------------------------------------------------------------------------

insert into public.appointment_reports (
  appointment_id, findings, treatment_performed, treatment_methods, recommendations,
  follow_up_date, customer_name, completion_note, submitted_by, submitted_at
)
select
  v.appointment_id, v.findings, v.treatment_performed, v.methods, v.recommendations,
  case when v.follow_up_days is null then null
       else (current_date + v.follow_up_days) end,
  v.customer_name, v.completion_note,
  a.technician_id,
  a.scheduled_at + (a.duration_minutes || ' minutes')::interval + interval '25 minutes'
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid,
   'Light German cockroach activity under the kitchen sink and behind the refrigerator. No droppings found in the comfort room. Moisture from a slow leak under the sink trap is feeding the harbourage.'::text,
   'Gel bait placed at 14 points across the kitchen. Crack and crevice treatment behind and beneath the appliances.'::text,
   array['GEL_BAIT', 'CRACK_CREVICE', 'SANITATION_ADVICE']::text[],
   'Have the sink trap repaired — the treatment will not hold while that leak continues. Keep dry goods in sealed containers.'::text,
   28::int, 'Juan Dela Cruz'::text,
   'Customer signed the printed service form on site; hard copy filed at the office.'::text),

  ('a0000000-0000-4000-8000-000000000002',
   'No live bed bugs found on floors 3 and 4. Two cockroach hot spots in the laundry, one behind the dryer bank and one at the linen chute. Grease build-up under the kitchen range is significant.',
   'Residual spraying of the laundry and back-of-house corridors. Gel bait at the kitchen line. Monitoring boards placed at both hot spots.',
   array['RESIDUAL_SPRAY', 'GEL_BAIT', 'SANITATION_ADVICE'],
   'Deep-clean under the range before the next visit. Monitoring boards to be read on the next contract visit.',
   30, 'Rowena Bautista', 'Signed by the Duty Engineer on the printed form.'),

  ('a0000000-0000-4000-8000-000000000003',
   'Heavy cockroach activity at the wet market drain line and in the bakery prep area. Droppings along the base of the dry-goods shelving. No rodent evidence this visit.',
   'Residual spraying along drains and service voids. Gel bait in the bakery prep area. Crack and crevice work along the shelving base.',
   array['RESIDUAL_SPRAY', 'GEL_BAIT', 'CRACK_CREVICE'],
   'Drains need nightly flushing. Recommend moving to fortnightly service until the drain line is under control.',
   30, 'Arnel Bautista', 'Store Manager countersigned the printed service form.'),

  ('a0000000-0000-4000-8000-000000000004',
   'Eight of twenty-four perimeter stations showed feeding. Two stations near Gate 3 had been moved and one lid was forced. Rodent runs visible along the eastern fence line.',
   'All stations re-baited and secured. Two damaged stations flagged for replacement. Runs dusted along the fence line.',
   array['DUSTING', 'EXCLUSION', 'FOLLOW_UP_CHECK'],
   'Replace the two forced stations next visit. The gap under the Gate 3 roller shutter needs proofing — it is the likely entry point.',
   30, 'Eduardo Lim', 'Warehouse Supervisor signed the printed form at Gate 3.'),

  ('a0000000-0000-4000-8000-000000000005',
   'Fruit fly and house fly pressure concentrated at the reject bin bay and the wash line. Plant confirmed shut down and cleared before work started; gas monitor showed clear at re-entry.',
   'Full-plant fumigation of the packing line. Space fogging of the reject bay after airing out.',
   array['FUMIGATION', 'SPACE_FOGGING', 'SANITATION_ADVICE'],
   'The reject bins must be emptied and washed daily — the fumigation buys weeks, not months, while they sit full.',
   90, 'Engr. Dante Ramos', 'QA Manager signed the clearance and the printed service form.'),

  ('a0000000-0000-4000-8000-000000000006',
   'Active subterranean termite mud tubes on the western foundation wall and inside the extension slab expansion joint. Damage to the skirting board in the back bedroom is superficial.',
   'Full perimeter soil treatment by trenching and rodding. Drill-and-inject along the extension slab at 300mm centres.',
   array['SOIL_TREATMENT', 'INSPECTION_ONLY'],
   'Do not disturb the treated soil for at least six months. Have the damaged skirting replaced once the colony is confirmed dead.',
   30, 'Maria Lourdes Sarmiento', 'Customer signed the printed form; warranty certificate issued separately.'),

  ('a0000000-0000-4000-8000-000000000007',
   'Pharaoh ant trails in the canteen serving area and along the clinic window frames. No cockroach or rodent activity observed.',
   'Gel bait along the trails in the canteen. Crack and crevice treatment at the clinic window frames.',
   array['GEL_BAIT', 'CRACK_CREVICE', 'SANITATION_ADVICE'],
   'Do not spray over the gel placements — insecticide spray breaks up pharaoh ant colonies and makes them worse. Told the canteen staff.',
   90, 'Sr. Anecita Flores', 'School Administrator signed the printed service form.'),

  ('a0000000-0000-4000-8000-000000000008',
   'Small cockroach population confined to the pantry and the staff comfort room. Clinical areas clear. Waste bin at the back stair is the likely source.',
   'Gel bait in the pantry and comfort room. Crack and crevice treatment at the back stair landing.',
   array['GEL_BAIT', 'CRACK_CREVICE'],
   'Move the back-stair waste bin indoors overnight, or fit it with a self-closing lid.',
   30, 'Dr. Liza Mercado', 'Clinic Administrator signed the printed form.'),

  ('a0000000-0000-4000-8000-000000000009',
   'Room 412 inspected after a guest bite report. Live bed bugs and cast skins found at the headboard seam and in the bed frame joint. Adjoining rooms 411 and 413 clear.',
   'Room 412 treated: residual spraying of the frame and seams, dusting of the void behind the headboard. Adjoining rooms monitored.',
   array['RESIDUAL_SPRAY', 'DUSTING', 'FOLLOW_UP_CHECK'],
   'Keep 412 out of service for 24 hours. Re-inspect 412, 411 and 413 in fourteen days before returning them to sale.',
   14, 'Rowena Bautista', 'Duty Engineer signed the printed form; guest relations copied.'),

  ('a0000000-0000-4000-8000-000000000010',
   'Rodent droppings in the ceiling void above the kitchen and gnaw marks on the water line lagging. Entry appears to be at the eaves on the north side. No live sighting during inspection.',
   'Inspection only. Findings and a quotation for a baiting programme discussed with the owner on site.',
   array['INSPECTION_ONLY', 'SANITATION_ADVICE'],
   'Proof the eaves gap before baiting, otherwise the population simply re-enters. Quotation issued for four stations plus two monthly checks.',
   null, 'Ricardo Ompad', 'Inspection only; owner acknowledged the findings on the printed form.'),

  ('a0000000-0000-4000-8000-000000000011',
   'Rodent activity in the garbage room and along the basement car park drainage channel. Six of twelve stations fed on. Bin store door does not seal at the base.',
   'All stations re-baited. Glue boards placed in the garbage room for monitoring. Runs along the drainage channel dusted.',
   array['DUSTING', 'FOLLOW_UP_CHECK', 'EXCLUSION'],
   'Fit a brush seal to the bin store door. Until then the garbage room will keep re-populating from the car park.',
   30, 'Roberto Berting Sy', 'Building caretaker signed the printed service form.'),

  ('a0000000-0000-4000-8000-000000000012',
   'Cockroach numbers down markedly on the previous visit. Residual activity at the wet market drain line only. Dry-goods shelving now clear.',
   'Drain treatment at the wet market line. Gel bait refreshed at the bakery prep area.',
   array['RESIDUAL_SPRAY', 'GEL_BAIT', 'FOLLOW_UP_CHECK'],
   'The nightly drain flushing is working — keep it up. Reverting to monthly service is reasonable if the next visit is as clean.',
   30, 'Arnel Bautista', 'Store Manager countersigned the printed service form.'),

  ('a0000000-0000-4000-8000-000000000013',
   'Drywood termite frass beneath the choir loft joists. The narra pews and the retablo were inspected and are clear. Damage is limited to two joist ends at the south wall.',
   'Localised drill-and-inject to the affected joist ends. No work carried out near the retablo, as agreed.',
   array['SOIL_TREATMENT', 'INSPECTION_ONLY', 'SANITATION_ADVICE'],
   'Have a carpenter sister the two joist ends. Re-inspect the loft in six months; the rest of the hall is sound.',
   180, 'Fr. Ambrosio Deleon', 'Parish Priest signed the printed service form.')
) as v(appointment_id, findings, treatment_performed, methods, recommendations,
       follow_up_days, customer_name, completion_note)
join public.appointments a on a.id = v.appointment_id;

-- ---------------------------------------------------------------------------
-- 7. Notifications
--
--    Only the four most recent completions, to everyone in the office except
--    the technician who filed them. Seeding one per completed visit would put
--    fifty unread items behind the bell, which tells you nothing about whether
--    the bell works.
-- ---------------------------------------------------------------------------

insert into public.notifications (recipient_id, appointment_id, message, created_at, read_at)
select
  o.id,
  a.id,
  'Service report filed for ' || c.name || ' by the assigned technician.',
  r.submitted_at,
  -- The oldest two have been seen; the newest two are still unread.
  case when a.scheduled_at < now() - interval '10 days' then r.submitted_at + interval '3 hours' end
from public.appointments a
join public.clients c on c.id = a.client_id
join public.appointment_reports r on r.appointment_id = a.id
cross join (
  select id from public.admins where status = 'ACTIVE'
  union all
  select id from public.staff  where status = 'ACTIVE'
) o
where a.status = 'Completed'
  and a.scheduled_at > now() - interval '15 days'
  and o.id is distinct from a.technician_id;

-- ---------------------------------------------------------------------------
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

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Check it landed
--
--   select count(*) from public.clients;                  -- 13
--   select count(*) from public.appointments;             -- 24
--   select count(*) from public.appointment_reports;      -- 13
--   select count(*) from public.inventory;                -- 18
--   select count(*) from public.inventory_movements;      -- 54
--
--   Stock agrees with its own history (expect zero rows):
--     select i.name, i.quantity, sum(m.quantity_delta) as from_log
--     from public.inventory i
--     left join public.inventory_movements m on m.item_id = i.id
--     group by i.id, i.name, i.quantity
--     having i.quantity is distinct from coalesce(sum(m.quantity_delta), 0);
--
--   Every appointment's lead is the first of its crew (expect zero rows):
--     select a.id from public.appointments a
--     join public.appointment_technicians at
--       on at.appointment_id = a.id and at.is_lead
--     where a.technician_id is distinct from at.technician_id;
--
--   Accounts untouched:
--     select 'admins' t, count(*) from public.admins
--     union all select 'staff', count(*) from public.staff
--     union all select 'technicians', count(*) from public.technicians;
-- ===========================================================================
