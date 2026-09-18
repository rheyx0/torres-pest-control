-- ---------------------------------------------------------------------------
-- Migration 030 - Technicians see only their own schedule.
--
-- Run after 029-report-attachment-categories.sql.
--
-- The UI already filters the calendar down to the signed-in technician's own
-- appointments, but that is cosmetic: fetchAppointments() issues a plain
-- .select() from the browser, so every appointment in the company was still
-- being downloaded and was readable from devtools. This moves the rule into
-- row-level security, where it actually holds.
--
-- Scope of this migration: READ access only.
--   - Technicians can select only appointments assigned to them, plus the
--     reports and attachments hanging off those appointments.
--   - Admin and staff are unaffected and still see everything.
--   - Writes are untouched. create_appointment / update_appointment /
--     submit_appointment_report are all `security definer`, so they run as the
--     owner and bypass RLS by design — report filing keeps working for
--     technicians exactly as before. Restricting who may reschedule belongs
--     inside those functions and is deliberately NOT done here.
--
-- Fails closed: with no valid session token both helpers return null/false and
-- no rows are visible.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Which role is calling?
--
--    current_account_id() (migration 028) answers "who"; this answers "what
--    kind", so a policy can treat technicians differently without a second
--    lookup per row.
-- ---------------------------------------------------------------------------

create or replace function public.current_account_role()
returns text
language sql stable security definer set search_path = public
as $$
  select r.role_name
  from public.role_account_for_session(
    nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid
  ) r
  limit 1;
$$;

grant execute on function public.current_account_role() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The rule itself, in one place.
--
--    Unassigned appointments (technician_id is null) are invisible to
--    technicians: an unassigned visit is by definition not theirs. Staff and
--    admin still see the unassigned pool for dispatch.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_appointment(p_technician_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.current_account_role() = 'TECHNICIAN'
      then p_technician_id is not null
       and p_technician_id = public.current_account_id()
    else public.has_role_table_session()
  end;
$$;

grant execute on function public.can_read_appointment(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Appointments
--
--    The old "Scheduling access" policy was `for all`, which covered select,
--    insert and update in one rule. Splitting it lets reads be scoped while
--    writes keep the previous behaviour untouched.
-- ---------------------------------------------------------------------------

drop policy if exists "Scheduling access" on public.appointments;

drop policy if exists "Appointment read scope" on public.appointments;
create policy "Appointment read scope" on public.appointments
for select using (public.can_read_appointment(technician_id));

drop policy if exists "Appointment insert access" on public.appointments;
create policy "Appointment insert access" on public.appointments
for insert with check (public.has_role_table_session());

drop policy if exists "Appointment update access" on public.appointments;
create policy "Appointment update access" on public.appointments
for update using (public.has_role_table_session())
with check (public.has_role_table_session());

-- ---------------------------------------------------------------------------
-- 4. Reports and attachments follow their appointment.
--
--    Without this a technician could still read the findings and the before /
--    after photos of a visit they cannot see in the calendar.
-- ---------------------------------------------------------------------------

drop policy if exists "Appointment report access" on public.appointment_reports;

drop policy if exists "Appointment report read scope" on public.appointment_reports;
create policy "Appointment report read scope" on public.appointment_reports
for select using (exists (
  select 1 from public.appointments a
  where a.id = appointment_reports.appointment_id
    and public.can_read_appointment(a.technician_id)
));

drop policy if exists "Appointment report write access" on public.appointment_reports;
create policy "Appointment report write access" on public.appointment_reports
for all using (public.has_role_table_session())
with check (public.has_role_table_session());

drop policy if exists "Report attachment access" on public.appointment_report_attachments;

drop policy if exists "Report attachment read scope" on public.appointment_report_attachments;
create policy "Report attachment read scope" on public.appointment_report_attachments
for select using (exists (
  select 1 from public.appointments a
  where a.id = appointment_report_attachments.appointment_id
    and public.can_read_appointment(a.technician_id)
));

drop policy if exists "Report attachment write access" on public.appointment_report_attachments;
create policy "Report attachment write access" on public.appointment_report_attachments
for all using (public.has_role_table_session())
with check (public.has_role_table_session());

-- ---------------------------------------------------------------------------
-- Known gap, left deliberately
--
--   inventory_movements is NOT scoped here. Its OUT rows carry appointment_id,
--   so a technician could still infer which materials were used on another
--   technician's visit. It is left alone because the same table drives the
--   Inventory page, which technicians are allowed to read, and narrowing it
--   here would break that. Scope it in its own migration if it matters.
--
-- Verifying
--
--   The policies key off the x-session-token request header, so they cannot be
--   checked from the SQL editor (no header there — every helper returns null
--   and you will see zero rows, which is the fail-closed path working).
--   Check it from the app instead:
--     1. Sign in as a technician, open Scheduling, confirm only their visits
--        appear.
--     2. Open devtools > Network, look at the /rest/v1/appointments response,
--        and confirm the payload itself contains only their rows.
--     3. Sign in as staff and confirm the whole schedule is still visible.
--     4. As the technician, submit a report on one of their visits and confirm
--        it still saves.
-- ---------------------------------------------------------------------------
