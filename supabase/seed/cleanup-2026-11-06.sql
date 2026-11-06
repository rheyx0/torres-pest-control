-- ---------------------------------------------------------------------------
-- One-off cleanup from the Nov 6, 2026 system check. NOT a migration: it
-- deletes data. Run it once in the Supabase SQL Editor (it runs as the owner,
-- which the deletes below need).
--
-- It removes:
--   1. Six visits left Pending since October that never happened:
--      TPC-V-00006, 00008, 00024, 00036, 00037, 00045 (no report, stock,
--      invoice or follow-up hangs on any of them; 00024 is one day of a
--      recurring plan, whose other days stay).
--   2. The test client "QA Claude Client" (TPC-C-0021), made by an automated
--      test session, with everything booked or billed for it: its 11 visits
--      (TPC-V-00060 among them), 3 quotations, 1 contract, 3 invoices,
--      6 payments, 2 plans and 2 document records. The stock its visits used
--      goes back on the shelf (and into the same batch) before the stock
--      records are removed, so stock levels end where they would have been.
--      Its two uploaded files are removed afterwards by
--      supabase/seed/delete-orphan-files.mjs, which SQL cannot do.
--
-- NOT removed (decide separately): the test accounts qaclaudestaff and
-- qaclaudetech, the service "QA Claude Spray", and the item "QA Claude Chem"
-- (a real visit, TPC-V-00067, used it).
--
-- Safe: everything runs in one transaction and checks first. If any of the
-- six old visits has gained a report, stock or an invoice since Nov 6, it
-- stops and nothing is deleted. Running it a second time finds nothing.
-- ---------------------------------------------------------------------------

begin;

create temp table cleanup_client on commit drop as
select id from public.clients where name = 'QA Claude Client' and reference = 'TPC-C-0021';

create temp table cleanup_visits on commit drop as
select a.id, a.reference, (a.client_id in (select id from cleanup_client)) as test_client
from public.appointments a
where a.reference in ('TPC-V-00006', 'TPC-V-00008', 'TPC-V-00024', 'TPC-V-00036', 'TPC-V-00037', 'TPC-V-00045', 'TPC-V-00060')
   or a.client_id in (select id from cleanup_client);

-- The six real-client visits must still be untouched Pending visits.
do $check$
begin
  if exists (
    select 1 from public.appointments a join cleanup_visits c on c.id = a.id
    where not c.test_client
      and (a.status not in ('Pending', 'Confirmed') or a.invoice_id is not null
           or exists (select 1 from public.appointment_reports r where r.appointment_id = a.id)
           or exists (select 1 from public.inventory_movements m where a.id in (m.appointment_id, m.for_appointment_id))
           or exists (select 1 from public.appointments f where f.follow_up_of = a.id))
  ) then
    raise exception 'One of the old visits has changed since Nov 6 (status, report, stock, invoice or follow-up). Nothing was deleted.';
  end if;
end;
$check$;

-- Stock records of those visits: checkouts made for them, what they drew, and returns.
create temp table cleanup_moves on commit drop as
select m.id, m.item_id, m.batch_id, coalesce(m.quantity_delta, 0) as delta, m.checkout_id
from public.inventory_movements m
where m.appointment_id in (select id from cleanup_visits)
   or m.for_appointment_id in (select id from cleanup_visits)
   or m.checkout_id in (select id from public.inventory_movements where for_appointment_id in (select id from cleanup_visits));

-- Nothing outside the cleanup may draw on those checkouts.
do $check_custody$
begin
  if exists (select 1 from public.inventory_movements m
             where m.checkout_id in (select id from cleanup_moves) and m.id not in (select id from cleanup_moves)) then
    raise exception 'A visit outside the cleanup used stock from one of its checkouts. Nothing was deleted.';
  end if;
end;
$check_custody$;

-- Put the stock back: undo each record's effect on the shelf and its batch.
update public.inventory i set quantity = i.quantity - s.delta
from (select item_id, sum(delta) delta from cleanup_moves group by item_id having sum(delta) <> 0) s
where i.id = s.item_id;
update public.inventory_batches b set quantity = b.quantity - s.delta
from (select batch_id, sum(delta) delta from cleanup_moves where batch_id is not null group by batch_id having sum(delta) <> 0) s
where b.id = s.batch_id;

-- Records that point at a checkout first, then the checkouts themselves.
delete from public.inventory_movements where id in (select id from cleanup_moves where checkout_id is not null);
delete from public.inventory_movements where id in (select id from cleanup_moves);

-- The test client's billing: payments first (they point at everything else),
-- then invoices with their lines.
delete from public.payments where client_id in (select id from cleanup_client);
delete from public.invoices where client_id in (select id from cleanup_client);

-- The visits (reports, crews, services, history and notifications go with them).
delete from public.appointments where id in (select id from cleanup_visits);

delete from public.contracts where client_id in (select id from cleanup_client);
delete from public.quotes where client_id in (select id from cleanup_client);
-- Plans and document records go with the client.
delete from public.clients where id in (select id from cleanup_client);

-- What was done.
select 'visits removed' as what, count(*)::text as how_many from cleanup_visits
union all select 'stock records removed', count(*)::text from cleanup_moves
union all select 'test client still there', count(*)::text from public.clients where name = 'QA Claude Client'
union all select 'stock items whose shelf no longer matches their batches', count(*)::text from (
  select i.id from public.inventory i left join public.inventory_batches b on b.item_id = i.id
  where i.type = 'CHEMICAL' group by i.id, i.quantity having abs(coalesce(sum(b.quantity), 0) - i.quantity) > 0.0001) x;

commit;
