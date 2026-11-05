-- ---------------------------------------------------------------------------
-- Migration 038 - Technician signature on the service report.
--
-- Run after 037-fix-request-password-reset-staff-table.sql.
--
-- The printed service report carries a technician signature line, but until now
-- nothing could fill it: the only way to sign was to print the form and use a
-- pen. This stores the technician's signature the same way the customer's is
-- stored, so the report prints complete.
--
-- What this signature is, and is not:
--
--   It is the technician attesting to the work described in their own report.
--   `submitted_by` already records WHO filed it; this records that they signed
--   off on it, which is what a printed compliance copy is expected to show.
--
--   It is NOT a second confirmation of the service. Completion still turns on
--   the customer signature or an office completion note, exactly as migration
--   034 defined it. A technician cannot complete their own visit by signing.
--
-- The image goes in the existing `report-attachments` bucket alongside the
-- customer signature, so no storage or policy change is needed here. Only the
-- object key is stored, and for the same reason as migration 034 it lives on
-- appointment_reports rather than as an attachment row: that table has no
-- UPDATE grant, so a mis-signed signature could never be redone.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Where the technician's signature lives.
-- ---------------------------------------------------------------------------

alter table public.appointment_reports
  add column if not exists technician_signature_path text;
alter table public.appointment_reports
  add column if not exists technician_signed_at timestamptz;

comment on column public.appointment_reports.technician_signature_path is
  'Object key of the technician''s signature in the report-attachments bucket. Attestation of their own report, not a confirmation of the service.';
comment on column public.appointment_reports.technician_signed_at is
  'When the technician signed. Set from now() on the submit that carried the signature.';

-- ---------------------------------------------------------------------------
-- 2. Carry the signature through report submission.
--
--    As in migrations 034 and 035, the previous overload must be dropped first.
--    The new parameter has a default, so a 9-argument call would match both
--    definitions and Postgres would raise "function is not unique".
--
--    Everything else is carried over from the migration 035 definition
--    unchanged: the validation, the completion rule and the notification
--    fan-out all behave exactly as before.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[]);

create or replace function public.submit_appointment_report(
  p_appointment_id uuid,
  p_findings text,
  p_treatment_performed text,
  p_recommendations text,
  p_follow_up_date date,
  p_customer_name text default null,
  p_signature_path text default null,
  p_completion_note text default null,
  p_treatment_methods text[] default null,
  p_technician_signature_path text default null
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
declare signed boolean;
declare tech_signed boolean;
declare confirmed boolean;
declare methods text[];
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;

  methods := coalesce(p_treatment_methods, '{}');

  -- The work done must be recorded one way or the other: ticked methods, or
  -- the free-text box.
  if cardinality(methods) = 0 and nullif(trim(coalesce(p_treatment_performed, '')), '') is null then
    raise exception 'Record the treatment: tick at least one method, or describe it in the notes.';
  end if;

  select status into previous_status from public.appointments where id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  signed := nullif(trim(coalesce(p_signature_path, '')), '') is not null;
  tech_signed := nullif(trim(coalesce(p_technician_signature_path, '')), '') is not null;

  if signed and nullif(trim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'A customer name is required alongside the signature.';
  end if;

  -- Unchanged from migration 034: only the customer's signature or an office
  -- note completes a visit. tech_signed is deliberately absent here.
  confirmed := signed or nullif(trim(coalesce(p_completion_note, '')), '') is not null;

  actor_id := public.current_account_id();

  insert into public.appointment_reports (
    appointment_id, findings, treatment_performed, treatment_methods, recommendations,
    follow_up_date, submitted_by, customer_name, signature_path, signed_at, completion_note,
    technician_signature_path, technician_signed_at
  )
  values (
    p_appointment_id, trim(p_findings), nullif(trim(coalesce(p_treatment_performed, '')), ''),
    methods, nullif(trim(p_recommendations), ''), p_follow_up_date,
    actor_id,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_signature_path, '')), ''),
    case when signed then now() else null end,
    nullif(trim(coalesce(p_completion_note, '')), ''),
    nullif(trim(coalesce(p_technician_signature_path, '')), ''),
    case when tech_signed then now() else null end
  )
  on conflict (appointment_id) do update set
    findings            = excluded.findings,
    treatment_performed = excluded.treatment_performed,
    treatment_methods   = excluded.treatment_methods,
    recommendations     = excluded.recommendations,
    follow_up_date      = excluded.follow_up_date,
    submitted_by        = excluded.submitted_by,
    submitted_at        = now(),
    customer_name   = coalesce(excluded.customer_name,   appointment_reports.customer_name),
    signature_path  = coalesce(excluded.signature_path,  appointment_reports.signature_path),
    signed_at       = coalesce(excluded.signed_at,       appointment_reports.signed_at),
    completion_note = coalesce(excluded.completion_note, appointment_reports.completion_note),
    technician_signature_path = coalesce(excluded.technician_signature_path, appointment_reports.technician_signature_path),
    technician_signed_at      = coalesce(excluded.technician_signed_at,      appointment_reports.technician_signed_at)
  returning * into report_row;

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

grant execute on function public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Note on reports filed before this migration
--
--   They keep both new columns null, which is the same state as a report filed
--   today and not signed by the technician. The printed form falls back to the
--   blank ruled line, exactly as it did before.
-- ---------------------------------------------------------------------------
