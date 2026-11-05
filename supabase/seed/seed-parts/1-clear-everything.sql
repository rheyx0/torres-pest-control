-- ===========================================================================
-- Torres Pest Control — demo data, part 1 of 5: clear everything, then the clients
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
commit;
