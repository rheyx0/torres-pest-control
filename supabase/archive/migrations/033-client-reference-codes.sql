-- ---------------------------------------------------------------------------
-- Migration 033 - Client reference numbers.
--
-- Run after 032-account-reference-codes.sql.
--
-- The counterpart to migration 032, for the other side of the business. A
-- client has no human-readable identifier today — only a name, and names
-- repeat. Two "Juan Dela Cruz" rows are indistinguishable in a dropdown, on a
-- service form, or over the phone.
--
--   TPC-C-0001   Juan Dela Cruz
--   TPC-C-0002   Arawan Logistics Center
--   TPC-C-0003   Juan Dela Cruz      <- same name, now unambiguous
--
-- Four digits rather than the three used for staff: there will be far more
-- clients than employees.
--
-- Existing clients are backfilled in created_at order, oldest first.
--
-- Note on grants: unlike the account tables, `clients` is granted table-wide
-- (migration 001, "grant select, insert, update, delete on clients"), so the
-- new column is readable without a fresh grant. The sequence still needs one,
-- because the column default calls nextval() on every insert.
-- ---------------------------------------------------------------------------

create sequence if not exists public.client_reference_seq as bigint start 1;

alter table public.clients add column if not exists reference text;

-- Backfill, oldest client first.
do $$
declare
  target record;
begin
  for target in
    select id from public.clients where reference is null order by created_at, id
  loop
    update public.clients
      set reference = 'TPC-C-' || lpad(nextval('public.client_reference_seq')::text, 4, '0')
      where id = target.id;
  end loop;
end $$;

-- New clients get one automatically. Set after the backfill so the existing
-- rows keep the numbers assigned above.
alter table public.clients
  alter column reference set default 'TPC-C-' || lpad(nextval('public.client_reference_seq')::text, 4, '0');

-- A code identifies exactly one client.
create unique index if not exists clients_reference_key on public.clients (reference);

-- The column default calls nextval(), so inserting a client needs the sequence.
grant usage, select on sequence public.client_reference_seq to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select reference, name, created_at from public.clients order by reference;
--
--   Every client should have a code, numbered in the order they were added.
-- ---------------------------------------------------------------------------
