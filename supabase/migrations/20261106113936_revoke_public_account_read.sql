-- Close the rest of the password leak on the account tables.
--
-- On the live project admins, staff and technicians also carried a SELECT
-- grant to PUBLIC (every role, the app's public key included) from an early
-- hand-run script, so 20261106105423 taking SELECT away from anon and
-- authenticated still left password and password_hash readable through it.
-- A database built from the files never had this grant; this makes sure
-- neither does. The column SELECT grants to anon and authenticated (the
-- columns the app reads) are untouched, and the owner still sees every column
-- in the Supabase dashboard.

revoke all on table public.admins, public.staff, public.technicians from public;
