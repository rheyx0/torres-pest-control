-- ===========================================================================
-- Torres Pest Control — demo data, part 4 of 5: service reports and notifications
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
  if not exists (select 1 from public.appointments where id = 'a0000000-0000-4000-8000-000000000013') then
    raise exception 'Part 3 has not been run: the demo appointments are missing. Run the parts in order, 1 to 5.';
  end if;
end $guard$;

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
commit;
