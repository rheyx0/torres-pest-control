-- ---------------------------------------------------------------------------
-- Migration 034 - Customer signature and formal completion confirmation.
--
-- Run after 033-client-reference-codes.sql.
--
-- Until now submit_appointment_report set status = 'Completed' unconditionally,
-- so "Completed" proved nothing: it only meant somebody pressed the button.
-- This makes completion a deliberate act backed by evidence.
--
--   Report saved, no signature  -> report stored, status UNCHANGED (a draft)
--   Report saved + signature    -> status becomes Completed
--   Report saved + a written
--     reason from the office    -> status becomes Completed, reason on record
--
-- The signature image itself goes in the existing `report-attachments` bucket,
-- which already accepts image/png up to 5MB (migration 028) — no storage change
-- is needed. Only the object key is stored here.
--
-- Deliberately NOT filed as an appointment_report_attachments row: that table
-- has no UPDATE grant and technicians have no delete permission, so a
-- mis-signed signature could never be redone. Keeping the path on the report
-- lets the customer re-sign right up until the report is submitted.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The record of who confirmed, and how.
-- ---------------------------------------------------------------------------

alter table public.appointment_reports add column if not exists customer_name   text;
alter table public.appointment_reports add column if not exists signature_path  text;
alter table public.appointment_reports add column if not exists signed_at       timestamptz;
alter table public.appointment_reports add column if not exists completion_note text;

comment on column public.appointment_reports.customer_name is
  'Printed name of the person who signed. A signature image alone identifies nobody.';
comment on column public.appointment_reports.completion_note is
  'Why this service was completed without a customer signature. Office use.';

-- ---------------------------------------------------------------------------
-- 2. Completion becomes conditional.
--
--    Replaces the migration 028 definition. Validation and the notification
--    fan-out are carried over unchanged; the new part is that the status update
--    only runs when the visit has actually been confirmed.
-- ---------------------------------------------------------------------------

-- The 5-argument version from migration 028 must go before the new one is
-- created. Because the three new parameters have defaults, a 5-argument call
-- would match BOTH definitions and Postgres would raise "function is not
-- unique" rather than picking one.
drop function if exists public.submit_appointment_report(uuid, text, text, text, date);

create or replace function public.submit_appointment_report(
  p_appointment_id uuid,
  p_findings text,
  p_treatment_performed text,
  p_recommendations text,
  p_follow_up_date date,
  p_customer_name text default null,
  p_signature_path text default null,
  p_completion_note text default null
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
declare signed boolean;
declare confirmed boolean;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;
  if nullif(trim(p_treatment_performed), '') is null then raise exception 'Treatment performed is required.'; end if;

  select status into previous_status from public.appointments where id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  signed := nullif(trim(coalesce(p_signature_path, '')), '') is not null;

  -- A signature without a name is not a confirmation — nobody could say who
  -- signed it.
  if signed and nullif(trim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'A customer name is required alongside the signature.';
  end if;

  confirmed := signed or nullif(trim(coalesce(p_completion_note, '')), '') is not null;

  actor_id := public.current_account_id();

  insert into public.appointment_reports (
    appointment_id, findings, treatment_performed, recommendations, follow_up_date,
    submitted_by, customer_name, signature_path, signed_at, completion_note
  )
  values (
    p_appointment_id, trim(p_findings), trim(p_treatment_performed),
    nullif(trim(p_recommendations), ''), p_follow_up_date,
    actor_id,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_signature_path, '')), ''),
    case when signed then now() else null end,
    nullif(trim(coalesce(p_completion_note, '')), '')
  )
  on conflict (appointment_id) do update set
    findings            = excluded.findings,
    treatment_performed = excluded.treatment_performed,
    recommendations     = excluded.recommendations,
    follow_up_date      = excluded.follow_up_date,
    submitted_by        = excluded.submitted_by,
    submitted_at        = now(),
    -- A signature already on file is never cleared by a later edit of the
    -- report text; it is only replaced by a new one.
    customer_name   = coalesce(excluded.customer_name,   appointment_reports.customer_name),
    signature_path  = coalesce(excluded.signature_path,  appointment_reports.signature_path),
    signed_at       = coalesce(excluded.signed_at,       appointment_reports.signed_at),
    completion_note = coalesce(excluded.completion_note, appointment_reports.completion_note)
  returning * into report_row;

  -- The change that gives "Completed" its meaning: no confirmation, no
  -- completion. An unsigned report is a draft and the appointment keeps the
  -- status it had.
  if confirmed then
    update public.appointments set status = 'Completed' where id = p_appointment_id;
  end if;

  if confirmed and previous_status is distinct from 'Completed' then
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

grant execute on function public.submit_appointment_report(uuid, text, text, text, date, text, text, text) to anon, authenticated;

-- The new parameters default to null, so a client still posting only the five
-- original arguments keeps working — it just saves a draft instead of
-- completing the visit, which is the correct new behaviour anyway.

notify pgrst, 'reload schema';
