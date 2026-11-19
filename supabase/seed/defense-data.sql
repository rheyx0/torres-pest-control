-- ---------------------------------------------------------------------------
-- Torres Pest Control — records for the system defense (Nov 20, 2026).
--
-- ADDS data; deletes nothing. Run it once, on the live project (Supabase SQL
-- Editor) or the local database (psql). Running it a second time does nothing:
-- it stops if its first client is already there.
--
-- Eight new clients, each one a story the panel can open:
--   Lorna Villanueva (home, termites)   inspection → quotation with a 12-month
--       warranty and quarterly checkups → down payment → treatment and report
--       → invoice paid in full → a free warranty checkup booked.
--   Kusina ni Lola Restaurant           monthly pest control contract (6 visits)
--       with a down payment; two visits done (site activity High → Medium),
--       four booked; one invoice settled by the down payment, one OVERDUE.
--   Ramon Garcia (home, bed bugs)       quotation, down payment by check
--       (cleared), treatment, invoice PARTLY PAID, paid follow-up booked.
--   Samal View Pension House            a quotation SENT and waiting for an
--       answer (fumigation, VAT added), and a DRAFT.
--   San Isidro Chapel                   mosquito misting done, invoice UNPAID.
--   Mintal Rice Mill                    3-day rodent control job: Day 1 done
--       yesterday, Day 2 today, Day 3 tomorrow; 6-month warranty.
--   Bajada Dental Clinic                pest control TODAY under its quotation.
--   Toril Central Elementary School     inspection TODAY.
--   Cabantian Townhomes HOA             inspection tomorrow, no technician yet
--                                       (shows under Unassigned).
-- Plus: a chemical delivery (Stock In with lot numbers and expiry), the stock
-- each finished visit used (drawn through the real stock functions, so batches
-- and the shelf stay equal), and one technician out sick for two days.
--
-- Dates are counted from the defense day (Nov 20, 2026, or today if later), so
-- "today" on the Today page is the defense day.
--
-- Technicians: it uses Karl Hameed, Herald Bandalan, jeff baluyot and pestTech
-- when they exist, else any active technicians (on the local database, the
-- demo technician). Services and stock items it needs are created if missing.
-- Stock functions run as the primary admin, through a session this script
-- opens and closes itself.
-- ---------------------------------------------------------------------------

begin;

-- Helpers live in their own schema for the length of this script (dropped at the end).
create schema if not exists defense_seed;

-- A visit with its services (in order) and crew (first = lead). -------------
create or replace function defense_seed.visit(
  p_client uuid, p_at timestamptz, p_minutes int, p_status text, p_services uuid[], p_techs uuid[],
  p_price numeric, p_concern text, p_location text, p_frequency text, p_notes text,
  p_quote uuid, p_plan uuid, p_pos int, p_creator uuid
) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_names text;
  i int;
begin
  select string_agg(s.name, ', ' order by array_position(p_services, s.id)) into v_names
  from public.services s where s.id = any(p_services);
  -- A lead technician cannot have two visits starting at the same minute: move it 30 minutes on.
  while p_techs[1] is not null and exists (select 1 from public.appointments a where a.technician_id = p_techs[1] and a.scheduled_at = p_at) loop
    p_at := p_at + interval '30 minutes';
  end loop;
  insert into public.appointments (client_id, scheduled_at, duration_minutes, status, pest_concern, service_type, service_id,
                                   service_location, service_frequency, price, notes, quote_id, plan_id, plan_position, created_by)
  values (p_client, p_at, p_minutes, p_status, p_concern, v_names, p_services[1],
          p_location, p_frequency, p_price, p_notes, p_quote, p_plan, p_pos, p_creator)
  returning id into v_id;
  for i in 1..coalesce(array_length(p_services, 1), 0) loop
    insert into public.appointment_services (appointment_id, position, service_id, service_name)
    select v_id, i - 1, s.id, s.name from public.services s where s.id = p_services[i];
  end loop;
  for i in 1..coalesce(array_length(p_techs, 1), 0) loop
    insert into public.appointment_technicians (appointment_id, technician_id, is_lead)
    values (v_id, p_techs[i], i = 1) on conflict do nothing;
  end loop;
  return v_id;
end;
$$;

-- A finished visit's report. -----------------------------------------------
create or replace function defense_seed.report(
  p_visit uuid, p_by uuid, p_at timestamptz, p_findings text, p_treatment text, p_recommend text,
  p_follow_up date, p_customer text, p_activity text, p_issues text
) returns void language plpgsql as $$
begin
  insert into public.appointment_reports (appointment_id, findings, treatment_performed, recommendations,
                                          follow_up_date, customer_name, submitted_by, submitted_at)
  values (p_visit, p_findings, p_treatment, p_recommend, p_follow_up, p_customer, p_by, p_at);
  update public.appointments set activity_level = p_activity, open_issues = p_issues where id = p_visit;
end;
$$;

-- Get or create a stock item. ------------------------------------------------
create or replace function defense_seed.item(p_name text, p_type text, p_unit text, p_cost numeric, p_chem text, p_reorder numeric, p_supplier text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.inventory where lower(name) = lower(p_name) and type::text = p_type order by status, created_at limit 1;
  if v_id is null then
    insert into public.inventory (name, type, unit, cost, quantity, chemical_type, reorder_level, status, supplier,
                                  storage_location, price_mode, markup_percent, material_category)
    values (p_name, p_type::inventory_type, p_unit, p_cost, 0, p_chem::chemical_type, p_reorder, 'ACTIVE', p_supplier,
            case when p_type = 'CHEMICAL' then 'Chemical room A' else 'Supply shelf B' end, 'MARKUP', 40,
            case when p_type = 'MATERIAL' then 'SUPPLIES'::material_category end)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Get or create a service. ---------------------------------------------------
create or replace function defense_seed.service(p_name text, p_price numeric, p_mode text, p_rate numeric, p_min numeric, p_follow numeric, p_category text, p_minutes int)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.services where lower(name) = lower(p_name) order by is_active desc, created_at limit 1;
  if v_id is null then
    insert into public.services (name, default_price, pricing_mode, area_rate, minimum_charge, follow_up_price, category,
                                 default_duration_minutes, deposit_percent, is_active, sort_order)
    values (p_name, p_price, p_mode, p_rate, p_min, p_follow, p_category, p_minutes, 0, true, 20)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

do $defense$
declare
  d date := greatest((now() at time zone 'Asia/Manila')::date, date '2026-11-20');   -- the defense day
  tz text := 'Asia/Manila';
  admin_id uuid; admin_name text; v_token uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; techs uuid[];
  -- services
  s_insp uuid; s_check uuid; s_follow uuid; s_termite uuid; s_gpc uuid; s_bedbug uuid; s_rodent uuid; s_mosq uuid; s_fumi uuid;
  -- items
  i_termidor uuid; i_demand uuid; i_gel uuid; i_racumin uuid; i_kothrine uuid; i_glue uuid; i_station uuid;
  -- clients
  c_lorna uuid; c_kusina uuid; c_ramon uuid; c_samal uuid; c_chapel uuid; c_mintal uuid; c_dental uuid; c_toril uuid; c_hoa uuid;
  -- records
  q uuid; q2 uuid; v uuid; v2 uuid; insp uuid; plan uuid; k uuid; inv uuid; total numeric; dep numeric;
begin
  if exists (select 1 from public.clients where lower(email) = 'lorna.villanueva@example.com') then
    raise notice 'The defense records are already there. Nothing was added.';
    return;
  end if;

  -- Who does the work -----------------------------------------------------------
  select id, name into admin_id, admin_name from public.admins where status <> 'INACTIVE' order by is_primary desc nulls last, created_at limit 1;
  if admin_id is null then raise exception 'No active admin account.'; end if;

  select coalesce(array_agg(id order by ord), '{}') into techs from (
    select id, coalesce(array_position(array['Karl Hameed', 'Herald Bandalan', 'jeff baluyot', 'pestTech'], name), 100) ord, created_at
    from public.technicians where status <> 'INACTIVE'
    order by 2, created_at limit 4) x;
  if array_length(techs, 1) is null then raise exception 'No active technician account.'; end if;
  t1 := techs[1];
  t2 := coalesce(techs[2], t1);
  t3 := coalesce(techs[3], t2);
  t4 := coalesce(techs[4], t3);

  -- A session for the stock functions, as the admin.
  insert into public.sessions (user_id, user_role, expires_at) values (admin_id, 'ADMIN', now() + interval '1 hour') returning sessions.token into v_token;
  perform set_config('request.headers', json_build_object('x-session-token', v_token)::text, true);

  -- Services and stock items ------------------------------------------------------
  select id into s_insp from public.services where system_key = 'INSPECTION';
  select id into s_check from public.services where system_key = 'CHECKUP';
  select id into s_follow from public.services where system_key = 'FOLLOW_UP';
  s_insp := coalesce(s_insp, defense_seed.service('Inspection', 0, 'FLAT', null, null, null, 'NON_CHEMICAL', 60));
  s_follow := coalesce(s_follow, defense_seed.service('Follow-up Visit', 1500, 'FLAT', null, null, null, 'NON_CHEMICAL', 60));
  s_termite := defense_seed.service('Termite Soil Treatment', null, 'AREA', 150, 5000, 2500, 'CHEMICAL', 240);
  s_gpc := defense_seed.service('General Pest Control', 3500, 'FLAT', null, null, 1500, 'CHEMICAL', 120);
  s_bedbug := defense_seed.service('Bed Bug Treatment', 6500, 'FLAT', null, null, 2000, 'CHEMICAL', 180);
  s_rodent := defense_seed.service('Rodent Control', 4500, 'FLAT', null, null, 1500, 'CHEMICAL', 180);
  s_mosq := defense_seed.service('Mosquito Misting', 2800, 'FLAT', null, null, 1000, 'CHEMICAL', 90);
  s_fumi := defense_seed.service('Fumigation', 18000, 'FLAT', null, null, null, 'CHEMICAL', 480);

  i_termidor := defense_seed.item('Termidor SC', 'CHEMICAL', 'L', 6800, 'INSECTICIDE', 2, 'BASF Philippines');
  i_demand := defense_seed.item('Demand CS 2.5', 'CHEMICAL', 'L', 3500, 'INSECTICIDE', 2, 'Syngenta Philippines');
  i_gel := defense_seed.item('Maxforce Forte Gel Bait', 'CHEMICAL', 'g', 18.5, 'INSECTICIDE', 300, 'Bayer Philippines');
  i_racumin := defense_seed.item('Racumin Paste', 'CHEMICAL', 'kg', 1250, 'RODENTICIDE', 2, 'Bayer Philippines');
  i_kothrine := defense_seed.item('Aqua K-Othrine', 'CHEMICAL', 'L', 500, 'INSECTICIDE', 5, 'Bayer Philippines');
  i_glue := defense_seed.item('Glue Board Trap', 'MATERIAL', 'pcs', 65, null, 20, 'Davao Pest Supplies');
  i_station := defense_seed.item('Protecta LP Bait Station', 'MATERIAL', 'pcs', 385, null, 10, 'Davao Pest Supplies');

  -- A delivery 75 days before the defense (lot numbers and expiry on each chemical).
  perform public.stock_in_batch(jsonb_build_array(
    jsonb_build_object('item_id', i_termidor, 'amount', 10, 'unit_cost', 6800, 'lot_number', 'TS-2608-114', 'expiration_date', d + 600),
    jsonb_build_object('item_id', i_demand, 'amount', 6, 'unit_cost', 3500, 'lot_number', 'DCS-2607-052', 'expiration_date', d + 420),
    jsonb_build_object('item_id', i_gel, 'amount', 1500, 'unit_cost', 18.5, 'lot_number', 'MXF-2608-310', 'expiration_date', d + 300),
    jsonb_build_object('item_id', i_racumin, 'amount', 6, 'unit_cost', 1250, 'lot_number', 'RCP-2606-077', 'expiration_date', d + 500),
    jsonb_build_object('item_id', i_kothrine, 'amount', 20, 'unit_cost', 500, 'lot_number', 'AKO-2608-219', 'expiration_date', d + 450),
    jsonb_build_object('item_id', i_glue, 'amount', 100, 'unit_cost', 65),
    jsonb_build_object('item_id', i_station, 'amount', 40, 'unit_cost', 385)
  ), d - 75, 'PO-2026-0905', 'Davao Main Office', null);

  -- Clients ------------------------------------------------------------------------
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, service_notes, status) values
    ('Lorna Villanueva', 'lorna.villanueva@example.com', '09171234501', 'Blk 4 Lot 12, Matina Crossing, Davao City', 'RESIDENTIAL', 'Facebook', 'Termites in the kitchen cabinets and door frames', 'Has a dog; keep it inside during treatment.', 'ACTIVE')
    returning id into c_lorna;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, service_notes, status) values
    ('Kusina ni Lola Restaurant', 'kusinanilola.ops@example.com', '09181234502', 'J.P. Laurel Ave, Bajada, Davao City', 'COMMERCIAL', 'Referral', 'Cockroaches in the kitchen and storage', 'Treat after closing (9 PM) or before 7 AM opening.', 'ACTIVE')
    returning id into c_kusina;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, status) values
    ('Ramon Garcia', 'ramon.garcia@example.com', '09191234503', '23 Lanang Heights, Lanang, Davao City', 'RESIDENTIAL', 'Phone Call', 'Bed bugs in two bedrooms', 'ACTIVE')
    returning id into c_ramon;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, status) values
    ('Samal View Pension House', 'samalview.frontdesk@example.com', '09201234504', 'Km 7 Lanang, Davao City', 'HOSPITALITY', 'Website Contact Form', 'Wood-boring insects in the guest rooms', 'ACTIVE')
    returning id into c_samal;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, status) values
    ('San Isidro Chapel', 'sanisidro.chapel@example.com', '09211234505', 'Purok 3, Catalunan Grande, Davao City', 'RELIGIOUS_INSTITUTION', 'Walk-in', 'Mosquitoes during evening masses', 'ACTIVE')
    returning id into c_chapel;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, service_notes, status) values
    ('Mintal Rice Mill', 'mintal.ricemill@example.com', '09221234506', 'Mintal, Tugbok District, Davao City', 'AGRICULTURAL', 'Referral', 'Rats in the rice warehouse', 'Large warehouse; the job takes three days.', 'ACTIVE')
    returning id into c_mintal;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, status) values
    ('Bajada Dental Clinic', 'bajada.dental@example.com', '09231234507', '2F Plaza de Luisa, Bajada, Davao City', 'MEDICAL_FACILITY', 'Google Business Profile', 'Ants and cockroaches in the clinic', 'ACTIVE')
    returning id into c_dental;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, status) values
    ('Toril Central Elementary School', 'toril.ces@example.com', '09241234508', 'Poblacion, Toril, Davao City', 'EDUCATIONAL', 'Email', 'Termite damage on the classroom ceilings', 'ACTIVE')
    returning id into c_toril;
  insert into public.clients (name, email, phone, address, classification, source, pest_concern, status) values
    ('Cabantian Townhomes HOA', 'cabantian.hoa@example.com', '09251234509', 'Cabantian Rd, Buhangin, Davao City', 'RESIDENTIAL', 'Facebook', 'Rats around the clubhouse and garbage area', 'ACTIVE')
    returning id into c_hoa;

  -- 1. Lorna Villanueva: inspection → quotation with warranty → treatment → paid --------
  insp := defense_seed.visit(c_lorna, ((d - 45) + time '09:00') at time zone tz, 60, 'Completed', array[s_insp], array[t1],
    0, 'Termites in the kitchen cabinets and door frames', 'Kitchen and living room', 'One-time', null, null, null, null, admin_id);
  perform defense_seed.report(insp, t1, ((d - 45) + time '10:00') at time zone tz,
    'Active subterranean termite mud tubes on the kitchen cabinets and two door frames. About 120 sqm affected around the house perimeter.',
    'Inspection only.', 'Soil treatment around the perimeter and under the kitchen slab.', null, 'Lorna Villanueva', 'HIGH', 'Mud tubes on the kitchen cabinets');
  update public.appointments set inspection_area_sqm = 120, recommended_service_ids = array[s_termite] where id = insp;

  insert into public.quotes (client_id, status, valid_until, payment_terms, area_sqm, discount_type, discount_value, vat_mode, vat_rate,
                             deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount, notes,
                             created_by, created_at, sent_at, decided_at, decided_by, inspection_id, warranty_months, checkup_frequency)
  values (c_lorna, 'APPROVED', d - 13, 'NET_15', 120, 'AMOUNT', 0, 'NONE', 12, 'PERCENT', 50, 18000, 0, 0, 18000, 9000,
          'Soil treatment for the whole house perimeter. Warranty 12 months with quarterly checkups.',
          admin_id, ((d - 44) + time '10:00') at time zone tz, ((d - 44) + time '10:30') at time zone tz,
          ((d - 42) + time '15:00') at time zone tz, admin_id, insp, 12, 'QUARTERLY')
  returning id into q;
  insert into public.quote_lines (quote_id, position, kind, service_id, description, quantity, unit, unit_price, amount) values
    (q, 0, 'SERVICE', s_termite, 'Termite Soil Treatment (120 sqm)', 120, 'sqm', 150, 18000);
  insert into public.payments (client_id, quote_id, kind, amount, paid_on, method, reference_no, received_by, received_by_name, notes)
  values (c_lorna, q, 'DEPOSIT', 9000, d - 40, 'GCASH', '7012345678901', admin_id, admin_name, '50% down payment');

  v := defense_seed.visit(c_lorna, ((d - 35) + time '08:00') at time zone tz, 240, 'Completed', array[s_termite], array[t1, t2],
    18000, 'Termites in the kitchen cabinets and door frames', 'House perimeter and kitchen slab', 'One-time', null, q, null, null, admin_id);
  perform defense_seed.report(v, t1, ((d - 35) + time '12:30') at time zone tz,
    'Mud tubes removed. Termite activity confirmed along the north wall and under the kitchen.',
    'Trenched and treated the house perimeter and drilled-and-treated the kitchen slab with Termidor SC.',
    'Keep the soil around the house dry. Do not disturb the treated trench for 30 days.', null, 'Lorna Villanueva', 'MEDIUM', null);
  perform public.stock_out_batch(v, jsonb_build_array(jsonb_build_object('item_id', i_termidor, 'amount', 4)), d - 35);

  insert into public.invoices (client_id, quote_id, status, issued_on, payment_terms, due_on, discount_type, discount_value, vat_mode, vat_rate,
                               subtotal, discount_amount, vat_amount, total, deposit_applied, amount_due, created_by, created_by_name, created_at)
  values (c_lorna, q, 'ISSUED', d - 34, 'NET_15', d - 19, 'AMOUNT', 0, 'NONE', 12, 18000, 0, 0, 18000, 9000, 9000, admin_id, admin_name, ((d - 34) + time '09:00') at time zone tz)
  returning id into inv;
  insert into public.invoice_lines (invoice_id, position, kind, service_id, appointment_id, description, quantity, unit, unit_price, amount) values
    (inv, 0, 'SERVICE', s_termite, v, 'Termite Soil Treatment (120 sqm)', 120, 'sqm', 150, 18000),
    (inv, 1, 'MATERIAL', null, v, 'Termidor SC (included)', 4, 'L', 0, 0);
  update public.appointments set invoice_id = inv where id = v;
  insert into public.payments (client_id, invoice_id, kind, amount, paid_on, method, reference_no, received_by, received_by_name)
  values (c_lorna, inv, 'PAYMENT', 9000, d - 25, 'BANK_TRANSFER', 'BDO-TRF-55120', admin_id, admin_name);

  -- First quarterly checkup, free, inside the warranty's first period.
  perform set_config('app.warranty_link', 'on', true);
  v2 := defense_seed.visit(c_lorna, ((d + 5) + time '09:00') at time zone tz, 60, 'Confirmed', array[s_check], array[t1],
    0, 'Warranty checkup', 'House perimeter and kitchen', 'One-time', 'Quarterly warranty checkup.', null, null, null, admin_id);
  update public.appointments set warranty_kind = 'CHECKUP', warranty_quote_id = q where id = v2;
  perform set_config('app.warranty_link', '', true);

  -- 2. Kusina ni Lola: monthly contract ------------------------------------------------
  insert into public.appointment_plans (kind, client_id, frequency, skip_sundays, created_by, created_at)
  values ('RECURRING', c_kusina, 'Monthly', true, admin_id, ((d - 52) + time '10:00') at time zone tz) returning id into plan;
  insert into public.contracts (client_id, plan_id, title, service_ids, service_names, frequency, visit_count, starts_on, price_per_visit,
                                billing_schedule, payment_terms, inclusions, cancellation_terms, status, activated_at, created_by, created_at,
                                deposit_type, deposit_value, deposit_amount)
  values (c_kusina, plan, 'Monthly kitchen pest control', array[s_gpc], 'General Pest Control', 'Monthly', 6, d - 50, 3500,
          'PER_VISIT', 'NET_15', 'Gel baiting, crack-and-crevice spray and glue boards in the kitchen, storage and dining area.',
          'Either side may cancel with 30 days written notice. Visits already done are billed.',
          'ACTIVE', ((d - 52) + time '11:00') at time zone tz, admin_id, ((d - 53) + time '14:00') at time zone tz,
          'AMOUNT', 3500, 3500)
  returning id into k;
  insert into public.payments (client_id, contract_id, kind, amount, paid_on, method, received_by, received_by_name, notes)
  values (c_kusina, k, 'DEPOSIT', 3500, d - 52, 'CASH', admin_id, admin_name, 'Contract down payment');

  v := defense_seed.visit(c_kusina, ((d - 50) + time '07:00') at time zone tz, 120, 'Completed', array[s_gpc], array[t2],
    3500, 'Cockroaches in the kitchen and storage', 'Kitchen, storage and dining area', 'Monthly', null, null, plan, 1, admin_id);
  perform defense_seed.report(v, t2, ((d - 50) + time '09:00') at time zone tz,
    'Heavy German cockroach activity behind the stoves and under the sink. Droppings in the dry storage.',
    'Gel baiting in cracks and hinges, residual spray in the storage room, 6 glue boards placed.',
    'Seal the gap behind the sink. Keep food in closed containers overnight.', null, 'Lola Reyes (owner)', 'HIGH', 'Gap behind the sink not sealed yet');
  perform public.stock_out_batch(v, jsonb_build_array(
    jsonb_build_object('item_id', i_gel, 'amount', 60), jsonb_build_object('item_id', i_demand, 'amount', 0.5),
    jsonb_build_object('item_id', i_glue, 'amount', 6)), d - 50);
  insert into public.invoices (client_id, contract_id, status, issued_on, payment_terms, due_on, discount_type, discount_value, vat_mode, vat_rate,
                               subtotal, discount_amount, vat_amount, total, deposit_applied, amount_due, created_by, created_by_name, created_at)
  values (c_kusina, k, 'ISSUED', d - 49, 'NET_15', d - 34, 'AMOUNT', 0, 'NONE', 12, 3500, 0, 0, 3500, 3500, 0, admin_id, admin_name, ((d - 49) + time '09:00') at time zone tz)
  returning id into inv;
  insert into public.invoice_lines (invoice_id, position, kind, service_id, appointment_id, description, quantity, unit, unit_price, amount) values
    (inv, 0, 'SERVICE', s_gpc, v, 'General Pest Control — visit 1 of 6', 1, 'visit', 3500, 3500);
  update public.appointments set invoice_id = inv where id = v;

  v := defense_seed.visit(c_kusina, ((d - 20) + time '07:00') at time zone tz, 120, 'Completed', array[s_gpc], array[t2],
    3500, 'Cockroaches in the kitchen and storage', 'Kitchen, storage and dining area', 'Monthly', null, null, plan, 2, admin_id);
  perform defense_seed.report(v, t2, ((d - 20) + time '09:00') at time zone tz,
    'Fewer cockroaches; a few nymphs near the dishwashing area. Glue boards caught 14.',
    'Gel baiting refreshed, glue boards replaced.', 'Sink gap now sealed. Continue monthly visits.', null, 'Lola Reyes (owner)', 'MEDIUM', null);
  perform public.stock_out_batch(v, jsonb_build_array(
    jsonb_build_object('item_id', i_gel, 'amount', 40), jsonb_build_object('item_id', i_glue, 'amount', 6)), d - 20);
  insert into public.invoices (client_id, contract_id, status, issued_on, payment_terms, due_on, discount_type, discount_value, vat_mode, vat_rate,
                               subtotal, discount_amount, vat_amount, total, deposit_applied, amount_due, created_by, created_by_name, created_at)
  values (c_kusina, k, 'ISSUED', d - 19, 'NET_15', d - 4, 'AMOUNT', 0, 'NONE', 12, 3500, 0, 0, 3500, 0, 3500, admin_id, admin_name, ((d - 19) + time '09:00') at time zone tz)
  returning id into inv;
  insert into public.invoice_lines (invoice_id, position, kind, service_id, appointment_id, description, quantity, unit, unit_price, amount) values
    (inv, 0, 'SERVICE', s_gpc, v, 'General Pest Control — visit 2 of 6', 1, 'visit', 3500, 3500);
  update public.appointments set invoice_id = inv where id = v;

  perform defense_seed.visit(c_kusina, ((d + 10) + time '07:00') at time zone tz, 120, 'Confirmed', array[s_gpc], array[t2],
    3500, 'Cockroaches in the kitchen and storage', 'Kitchen, storage and dining area', 'Monthly', null, null, plan, 3, admin_id);
  perform defense_seed.visit(c_kusina, ((d + 40) + time '07:00') at time zone tz, 120, 'Pending', array[s_gpc], array[t2],
    3500, 'Cockroaches in the kitchen and storage', 'Kitchen, storage and dining area', 'Monthly', null, null, plan, 4, admin_id);
  perform defense_seed.visit(c_kusina, ((d + 70) + time '07:00') at time zone tz, 120, 'Pending', array[s_gpc], array[t2],
    3500, 'Cockroaches in the kitchen and storage', 'Kitchen, storage and dining area', 'Monthly', null, null, plan, 5, admin_id);
  perform defense_seed.visit(c_kusina, ((d + 101) + time '07:00') at time zone tz, 120, 'Pending', array[s_gpc], array[t2],
    3500, 'Cockroaches in the kitchen and storage', 'Kitchen, storage and dining area', 'Monthly', null, null, plan, 6, admin_id);

  -- 3. Ramon Garcia: bed bugs, check down payment, partly paid, follow-up booked ----------
  insert into public.quotes (client_id, status, valid_until, payment_terms, discount_type, discount_value, vat_mode, vat_rate,
                             deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount,
                             created_by, created_at, sent_at, decided_at, decided_by)
  values (c_ramon, 'APPROVED', d + 10, 'NET_15', 'AMOUNT', 0, 'NONE', 12, 'PERCENT', 30, 6500, 0, 0, 6500, 1950,
          admin_id, ((d - 20) + time '13:00') at time zone tz, ((d - 20) + time '13:30') at time zone tz, ((d - 18) + time '10:00') at time zone tz, admin_id)
  returning id into q;
  insert into public.quote_lines (quote_id, position, kind, service_id, description, quantity, unit, unit_price, amount) values
    (q, 0, 'SERVICE', s_bedbug, 'Bed Bug Treatment (2 bedrooms)', 1, 'job', 6500, 6500);
  insert into public.payments (client_id, quote_id, kind, amount, paid_on, method, check_number, check_bank, check_date, check_status, check_status_on, received_by, received_by_name)
  values (c_ramon, q, 'DEPOSIT', 1950, d - 17, 'CHECK', '0004512', 'BPI', d - 17, 'CLEARED', d - 15, admin_id, admin_name);

  v := defense_seed.visit(c_ramon, ((d - 14) + time '09:00') at time zone tz, 180, 'Completed', array[s_bedbug], array[t3],
    6500, 'Bed bugs in two bedrooms', 'Master bedroom and guest room', 'One-time', null, q, null, null, admin_id);
  perform defense_seed.report(v, t3, ((d - 14) + time '12:00') at time zone tz,
    'Live bed bugs and eggs on both mattresses and the bed frames.',
    'Residual spray on bed frames, mattress seams and baseboards in both rooms.',
    'Wash bedding in hot water. A follow-up in two weeks treats the newly hatched bugs.', d + 2, 'Ramon Garcia', 'HIGH', 'Eggs may hatch within 2 weeks');
  perform public.stock_out_batch(v, jsonb_build_array(jsonb_build_object('item_id', i_demand, 'amount', 0.75)), d - 14);
  insert into public.invoices (client_id, quote_id, status, issued_on, payment_terms, due_on, discount_type, discount_value, vat_mode, vat_rate,
                               subtotal, discount_amount, vat_amount, total, deposit_applied, amount_due, created_by, created_by_name, created_at)
  values (c_ramon, q, 'ISSUED', d - 13, 'NET_15', d + 2, 'AMOUNT', 0, 'NONE', 12, 6500, 0, 0, 6500, 1950, 4550, admin_id, admin_name, ((d - 13) + time '09:00') at time zone tz)
  returning id into inv;
  insert into public.invoice_lines (invoice_id, position, kind, service_id, appointment_id, description, quantity, unit, unit_price, amount) values
    (inv, 0, 'SERVICE', s_bedbug, v, 'Bed Bug Treatment (2 bedrooms)', 1, 'job', 6500, 6500);
  update public.appointments set invoice_id = inv where id = v;
  insert into public.payments (client_id, invoice_id, kind, amount, paid_on, method, reference_no, received_by, received_by_name, notes)
  values (c_ramon, inv, 'PAYMENT', 2000, d - 8, 'GCASH', '7019988776655', admin_id, admin_name, 'Partial payment');

  v2 := defense_seed.visit(c_ramon, ((d + 2) + time '09:00') at time zone tz, 60, 'Confirmed', array[s_follow], array[t3],
    2000, 'Bed bugs in two bedrooms', 'Master bedroom and guest room', 'One-time', 'Follow-up of the bed bug treatment.', q, null, null, admin_id);
  update public.appointments set follow_up_of = v where id = v2;

  -- 4. Samal View Pension House: a quotation waiting for an answer, and a draft ------------
  insert into public.quotes (client_id, status, valid_until, payment_terms, discount_type, discount_value, vat_mode, vat_rate,
                             deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount, notes, created_by, created_at, sent_at)
  values (c_samal, 'SENT', d + 27, 'NET_30', 'PERCENT', 5, 'ADDED', 12, 'PERCENT', 50, 18000, 900, 2052, 19152, 9576,
          'Fumigation of the 12 guest rooms. Rooms must be closed for 24 hours.', admin_id, ((d - 3) + time '14:00') at time zone tz, ((d - 3) + time '15:00') at time zone tz)
  returning id into q;
  insert into public.quote_lines (quote_id, position, kind, service_id, description, quantity, unit, unit_price, amount) values
    (q, 0, 'SERVICE', s_fumi, 'Fumigation (12 guest rooms)', 1, 'job', 18000, 18000);
  insert into public.quotes (client_id, status, valid_until, payment_terms, discount_type, discount_value, vat_mode, vat_rate,
                             deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount, notes, created_by, created_at)
  values (c_samal, 'DRAFT', d + 30, 'DUE_ON_RECEIPT', 'AMOUNT', 0, 'ADDED', 12, 'NONE', 0, 2800, 0, 336, 3136, 0,
          'Garden misting, to send with the fumigation answer.', admin_id, ((d - 1) + time '16:00') at time zone tz)
  returning id into q2;
  insert into public.quote_lines (quote_id, position, kind, service_id, description, quantity, unit, unit_price, amount) values
    (q2, 0, 'SERVICE', s_mosq, 'Mosquito Misting (garden)', 1, 'job', 2800, 2800);

  -- 5. San Isidro Chapel: misting done, invoice unpaid ------------------------------------
  v := defense_seed.visit(c_chapel, ((d - 6) + time '16:00') at time zone tz, 90, 'Completed', array[s_mosq], array[t4],
    2800, 'Mosquitoes during evening masses', 'Churchyard and garden', 'One-time', null, null, null, null, admin_id);
  perform defense_seed.report(v, t4, ((d - 6) + time '17:30') at time zone tz,
    'Breeding sites in two clogged gutters and flower pots.', 'Misting of the churchyard, garden and gutters.',
    'Clear the gutters and empty standing water weekly.', null, 'Fr. Jun Tan', 'MEDIUM', null);
  perform public.stock_out_batch(v, jsonb_build_array(jsonb_build_object('item_id', i_kothrine, 'amount', 2)), d - 6);
  insert into public.invoices (client_id, status, issued_on, payment_terms, due_on, discount_type, discount_value, vat_mode, vat_rate,
                               subtotal, discount_amount, vat_amount, total, deposit_applied, amount_due, created_by, created_by_name, created_at)
  values (c_chapel, 'ISSUED', d - 5, 'NET_15', d + 10, 'AMOUNT', 0, 'NONE', 12, 2800, 0, 0, 2800, 0, 2800, admin_id, admin_name, ((d - 5) + time '09:00') at time zone tz)
  returning id into inv;
  insert into public.invoice_lines (invoice_id, position, kind, service_id, appointment_id, description, quantity, unit, unit_price, amount) values
    (inv, 0, 'SERVICE', s_mosq, v, 'Mosquito Misting', 1, 'job', 2800, 2800);
  update public.appointments set invoice_id = inv where id = v;

  -- 6. Mintal Rice Mill: 3-day rodent job (yesterday, today, tomorrow) --------------------
  insert into public.quotes (client_id, status, valid_until, payment_terms, discount_type, discount_value, vat_mode, vat_rate,
                             deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount, notes,
                             created_by, created_at, sent_at, decided_at, decided_by, warranty_months, checkup_frequency)
  values (c_mintal, 'APPROVED', d + 5, 'NET_30', 'AMOUNT', 0, 'NONE', 12, 'PERCENT', 50, 13500, 0, 0, 13500, 6750,
          'Three-day rodent control of the rice warehouse. Warranty 6 months with monthly checkups.',
          admin_id, ((d - 12) + time '10:00') at time zone tz, ((d - 12) + time '10:30') at time zone tz, ((d - 11) + time '09:00') at time zone tz, admin_id, 6, 'MONTHLY')
  returning id into q;
  insert into public.quote_lines (quote_id, position, kind, service_id, description, quantity, unit, unit_price, amount) values
    (q, 0, 'SERVICE', s_rodent, 'Rodent Control — warehouse, 3 days', 3, 'day', 4500, 13500);
  insert into public.payments (client_id, quote_id, kind, amount, paid_on, method, reference_no, received_by, received_by_name, notes)
  values (c_mintal, q, 'DEPOSIT', 6750, d - 10, 'BANK_TRANSFER', 'LBP-TRF-88213', admin_id, admin_name, '50% down payment');
  insert into public.appointment_plans (kind, client_id, created_by, created_at) values ('MULTI_DAY', c_mintal, admin_id, ((d - 10) + time '11:00') at time zone tz)
  returning id into plan;
  v := defense_seed.visit(c_mintal, ((d - 1) + time '08:00') at time zone tz, 480, 'Confirmed', array[s_rodent], array[t1, t2],
    13500, 'Rats in the rice warehouse', 'Warehouse A and B', 'One-time', 'Day 1 of 3.', q, plan, 1, admin_id);
  update public.appointments set day_done_at = ((d - 1) + time '16:00') at time zone tz where id = v;
  perform public.stock_out_batch(v, jsonb_build_array(
    jsonb_build_object('item_id', i_racumin, 'amount', 1.5), jsonb_build_object('item_id', i_station, 'amount', 12)), d - 1);
  perform defense_seed.visit(c_mintal, (d + time '08:00') at time zone tz, 480, 'Confirmed', array[s_rodent], array[t1, t2],
    null, 'Rats in the rice warehouse', 'Warehouse A and B', 'One-time', 'Day 2 of 3.', q, plan, 2, admin_id);
  perform defense_seed.visit(c_mintal, ((d + 1) + time '08:00') at time zone tz, 480, 'Confirmed', array[s_rodent], array[t1, t2],
    null, 'Rats in the rice warehouse', 'Warehouse A and B', 'One-time', 'Day 3 of 3.', q, plan, 3, admin_id);

  -- 7. Bajada Dental Clinic: pest control today, under its quotation ----------------------
  insert into public.quotes (client_id, status, valid_until, payment_terms, discount_type, discount_value, vat_mode, vat_rate,
                             deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount,
                             created_by, created_at, sent_at, decided_at, decided_by)
  values (c_dental, 'APPROVED', d + 20, 'DUE_ON_RECEIPT', 'AMOUNT', 0, 'NONE', 12, 'NONE', 0, 3500, 0, 0, 3500, 0,
          admin_id, ((d - 7) + time '10:00') at time zone tz, ((d - 7) + time '10:15') at time zone tz, ((d - 6) + time '11:00') at time zone tz, admin_id)
  returning id into q;
  insert into public.quote_lines (quote_id, position, kind, service_id, description, quantity, unit, unit_price, amount) values
    (q, 0, 'SERVICE', s_gpc, 'General Pest Control (clinic)', 1, 'visit', 3500, 3500);
  perform defense_seed.visit(c_dental, (d + time '13:00') at time zone tz, 120, 'Confirmed', array[s_gpc], array[t3],
    3500, 'Ants and cockroaches in the clinic', 'Clinic, pantry and waiting area', 'One-time', 'Clinic closes at 12 for lunch; start at 1 PM.', q, null, null, admin_id);

  -- 8. Toril Central Elementary School: inspection today ----------------------------------
  perform defense_seed.visit(c_toril, (d + time '15:30') at time zone tz, 60, 'Confirmed', array[s_insp], array[t3],
    0, 'Termite damage on the classroom ceilings', 'Building 2, classrooms 4 to 7', 'One-time', 'Ask for Mr. Dela Peña, school property custodian.', null, null, null, admin_id);

  -- 9. Cabantian Townhomes HOA: inspection tomorrow, no technician yet ---------------------
  perform defense_seed.visit(c_hoa, ((d + 1) + time '10:00') at time zone tz, 60, 'Pending', array[s_insp], array[]::uuid[],
    0, 'Rats around the clubhouse and garbage area', 'Clubhouse and garbage area', 'One-time', null, null, null, null, admin_id);

  -- A technician out sick for two days ------------------------------------------------
  if t4 is distinct from t1 then
    insert into public.technician_absences (technician_id, starts_on, ends_on, reason, created_by) values (t4, d + 3, d + 4, 'Sick', admin_id);
  end if;

  -- Close the session -----------------------------------------------------------------
  delete from public.sessions where sessions.token = v_token;
  perform set_config('request.headers', '', true);
  raise notice 'Defense records added (defense day %).', d;
end;
$defense$;

-- What was added.
select c.reference, c.name,
       (select count(*) from public.appointments a where a.client_id = c.id) as visits,
       (select count(*) from public.quotes x where x.client_id = c.id) as quotes,
       (select count(*) from public.invoices x where x.client_id = c.id) as invoices,
       (select count(*) from public.payments x where x.client_id = c.id) as payments
from public.clients c
where c.email like '%@example.com' and c.name in ('Lorna Villanueva', 'Kusina ni Lola Restaurant', 'Ramon Garcia', 'Samal View Pension House',
  'San Isidro Chapel', 'Mintal Rice Mill', 'Bajada Dental Clinic', 'Toril Central Elementary School', 'Cabantian Townhomes HOA')
order by c.reference;

drop schema defense_seed cascade;

commit;
