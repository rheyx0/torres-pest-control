-- Migration 028 - Report attachments (Story 6) and completion notifications (Story 7).
--
-- Run after 027-appointment-integrity.sql.
--
-- Attachments follow the same shape as client_documents from migration 001:
-- metadata rows here, file bytes in a private Storage bucket, access through
-- short-lived signed URLs minted on demand.

-- ---------------------------------------------------------------------------
-- 1. Who is calling?
--
--    Wraps the session-token lookup the other functions do inline, so RLS
--    policies can scope rows to one account instead of "any signed-in user".
-- ---------------------------------------------------------------------------

create or replace function public.current_account_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select r.id
  from public.role_account_for_session(
    nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid
  ) r
  limit 1;
$$;

grant execute on function public.current_account_id() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Report attachments
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_report_attachments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  name text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text not null unique,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);

create index if not exists appointment_report_attachments_appointment_idx
  on public.appointment_report_attachments (appointment_id);

alter table public.appointment_report_attachments enable row level security;

drop policy if exists "Report attachment access" on public.appointment_report_attachments;
create policy "Report attachment access" on public.appointment_report_attachments
for all using (public.has_role_table_session()) with check (public.has_role_table_session());

grant select, insert, delete on public.appointment_report_attachments to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Notifications
--
--    One row per recipient, so read_at is per-person rather than shared.
--    Rows are written only by submit_appointment_report (security definer);
--    INSERT is deliberately NOT granted to anon/authenticated so a client
--    cannot forge a notification. Recipients may read and mark their own read.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  appointment_id uuid references public.appointments(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, read_at, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Own notifications readable" on public.notifications;
create policy "Own notifications readable" on public.notifications
for select using (recipient_id = public.current_account_id());

drop policy if exists "Own notifications updatable" on public.notifications;
create policy "Own notifications updatable" on public.notifications
for update using (recipient_id = public.current_account_id())
with check (recipient_id = public.current_account_id());

grant select, update on public.notifications to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notify on completion
--
--    Replaces the 025 definition. Same signature, plus the notification fan-out
--    to every active admin and staff account other than the submitter. Only
--    fires when the appointment was not already Completed, so editing a report
--    does not re-notify.
-- ---------------------------------------------------------------------------

create or replace function public.submit_appointment_report(
  p_appointment_id uuid,
  p_findings text,
  p_treatment_performed text,
  p_recommendations text,
  p_follow_up_date date
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;
  if nullif(trim(p_treatment_performed), '') is null then raise exception 'Treatment performed is required.'; end if;

  select status into previous_status from public.appointments where id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  actor_id := public.current_account_id();

  insert into public.appointment_reports (appointment_id, findings, treatment_performed, recommendations, follow_up_date, submitted_by)
  values (p_appointment_id, trim(p_findings), trim(p_treatment_performed), nullif(trim(p_recommendations), ''), p_follow_up_date, actor_id)
  on conflict (appointment_id) do update set findings = excluded.findings, treatment_performed = excluded.treatment_performed,
    recommendations = excluded.recommendations, follow_up_date = excluded.follow_up_date, submitted_by = excluded.submitted_by, submitted_at = now()
  returning * into report_row;

  update public.appointments set status = 'Completed' where id = p_appointment_id;

  if previous_status is distinct from 'Completed' then
    insert into public.notifications (recipient_id, appointment_id, message)
    select recipients.id, p_appointment_id,
           'Service completed for ' || coalesce(c.name, 'a client') || '.'
    from public.appointments appt
    join public.clients c on c.id = appt.client_id
    cross join (
      select id from public.admins where status = 'ACTIVE'
      union all
      select id from public.staff where status = 'ACTIVE'
    ) recipients
    where appt.id = p_appointment_id
      and recipients.id is distinct from actor_id;
  end if;

  return report_row;
end;
$$;

grant execute on function public.submit_appointment_report(uuid, text, text, text, date) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 5. Storage bucket for attachments
--
--    Private, like client-documents. If this section errors, everything above
--    has already committed and only uploads are affected - add the bucket and
--    its policies from the dashboard (Storage -> New bucket).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-attachments',
  'report-attachments',
  false,
  5242880,  -- 5MB, matching MAX_ATTACHMENT_BYTES in src/utils/constants.js
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  drop policy if exists "report attachments readable" on storage.objects;
  create policy "report attachments readable" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'report-attachments');

  drop policy if exists "report attachments insertable" on storage.objects;
  create policy "report attachments insertable" on storage.objects
    for insert to anon, authenticated
    with check (bucket_id = 'report-attachments');

  drop policy if exists "report attachments deletable" on storage.objects;
  create policy "report attachments deletable" on storage.objects
    for delete to anon, authenticated
    using (bucket_id = 'report-attachments');
exception when insufficient_privilege then
  raise notice 'Could not create storage.objects policies from SQL. Add them in the dashboard: Storage -> report-attachments -> Policies.';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Verify
-- ---------------------------------------------------------------------------
-- select id, public, file_size_limit from storage.buckets where id = 'report-attachments';
--   -> expect 1 row
-- select policyname from pg_policies where tablename = 'notifications';
--   -> expect the 2 "Own notifications ..." policies
