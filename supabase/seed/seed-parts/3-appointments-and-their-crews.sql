-- ===========================================================================
-- Torres Pest Control — demo data, part 3 of 5: appointments and their crews
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
  if not exists (select 1 from public.inventory where name = 'Solfac EW 050') then
    raise exception 'Part 2 has not been run: the demo inventory is missing. Run the parts in order, 1 to 5.';
  end if;
end $guard$;

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
commit;
