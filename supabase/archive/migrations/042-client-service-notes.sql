-- ---------------------------------------------------------------------------
-- Migration 042 - Service notes on the client profile.
--
-- Run after 041-appointment-technician-team-and-terms.sql.
--
-- Company clients carry standing instructions that belong to the account, not
-- to any one visit: which gate to use, who signs, the hours the warehouse can
-- be treated in, the areas that are off limits. Until now the only place to
-- put that was the notes box on an appointment, which meant it had to be
-- retyped for every booking and was invisible while the profile was open.
--
-- The column is on every client rather than only on commercial ones. A check
-- constraint tying it to classification would fire on the day a residential
-- client's classification is corrected, deleting text somebody wrote on
-- purpose. The form shows the field for company classifications and keeps it
-- visible for anyone who already has notes — see ClientForm.jsx.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.clients add column if not exists service_notes text;

comment on column public.clients.service_notes is
  'Standing service instructions for this client: access, contacts, restrictions. Shown on every booking.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--   select column_name from information_schema.columns
--     where table_name = 'clients' and column_name = 'service_notes';
--   -> expect 1 row
-- ---------------------------------------------------------------------------
