-- ---------------------------------------------------------------------------
-- Reset the test data: a clean slate after Sprint Retro #3.
--
-- NOT a migration (it deletes data): run it by hand in the Supabase SQL
-- Editor, once, when you want to start testing again from nothing.
--
-- Deletes: every visit, report, photo record, quote, invoice, payment,
--   contract, plan, absence, notification, stock movement and client
--   document; the test clients; the test services (derick, Primitive
--   Control, Mechanical Pest Control).
-- Keeps: every user account and session, the seven realistic clients, the
--   real services and their materials and prices, the inventory items and
--   their current stock (each chemical's stock becomes one opening batch),
--   the default rates, and the activity log (it cannot be deleted).
-- Resets the reference numbers (TPC-V, TPC-Q, TPC-INV, TPC-R, TPC-K, TPC-B)
--   to start again at 00001.
--
-- Files already uploaded stay in Storage but nothing points at them any more.
-- One transaction: if any part fails, nothing changes.
-- ---------------------------------------------------------------------------

begin;

-- No cascade: if anything else pointed at these, this stops instead of
-- reaching further.
truncate table
  public.appointment_extras,
  public.appointment_report_attachments,
  public.appointment_reports,
  public.appointment_services,
  public.appointment_status_history,
  public.appointment_technicians,
  public.notifications,
  public.invoice_lines,
  public.payments,
  public.invoices,
  public.quote_lines,
  public.contracts,
  public.appointments,
  public.appointment_plans,
  public.quotes,
  public.inventory_movements,
  public.inventory_batches,
  public.technician_absences,
  public.client_documents;

-- Test clients; the seven realistic ones stay.
delete from public.clients
where name not in ('Arawan Logistics Warehouse', 'Barangay Ulas Hall', 'Dabaw Fresh Supermart', 'Holy Cross Learning Center', 'Juan Dela Cruz', 'Kadayawan Suites Hotel', 'Maria Santos');

-- Test services.
delete from public.service_materials where service_id in (select id from public.services where name in ('derick', 'Primitive Control', 'Mechanical Pest Control'));
delete from public.services where name in ('derick', 'Primitive Control', 'Mechanical Pest Control');

-- Reference numbers start again at 00001.
alter sequence public.appointment_reference_seq restart with 1;
alter sequence public.quote_reference_seq restart with 1;
alter sequence public.invoice_reference_seq restart with 1;
alter sequence public.payment_reference_seq restart with 1;
alter sequence public.contract_reference_seq restart with 1;
alter sequence public.inventory_batch_reference_seq restart with 1;

-- Each chemical's current stock becomes its opening batch (055).
select public.ensure_item_batches(i.id) from public.inventory i where i.type = 'CHEMICAL';

commit;

-- Check: what is left. stock_mismatches must be 0.
select
  (select count(*) from public.clients) as clients,
  (select count(*) from public.appointments) as visits,
  (select count(*) from public.quotes) as quotes,
  (select count(*) from public.payments) as payments,
  (select count(*) from public.invoices) as invoices,
  (select count(*) from public.contracts) as contracts,
  (select count(*) from public.services) as services,
  (select count(*) from public.inventory) as items,
  (select count(*) from public.inventory_batches) as batches,
  (select count(*) from public.admins) + (select count(*) from public.staff) + (select count(*) from public.technicians) as accounts,
  (select count(*) from public.inventory i
     where i.type = 'CHEMICAL'
       and i.quantity <> coalesce((select sum(b.quantity) from public.inventory_batches b where b.item_id = i.id), 0)) as stock_mismatches;
