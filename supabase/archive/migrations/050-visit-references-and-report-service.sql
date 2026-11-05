-- ---------------------------------------------------------------------------
-- Migration 050 - Visit reference numbers, and the service filed on the report.
--
-- Run after 049-delivery-expiry.sql.
--
-- Two changes:
--
--   1. An appointment had no human-readable identifier. The printed service
--      report and the inventory history showed the first eight characters of
--      its uuid ("3F9A1C2E"), which is neither memorable nor guaranteed unique.
--      Appointments now get a reference in the same family as migration 032
--      (TPC-A / TPC-S / TPC-T for accounts) and 033 (TPC-C for clients):
--
--        TPC-V-00001   the first visit ever booked
--        TPC-V-00002   the next one
--
--      Five digits rather than four: there will be far more visits than
--      clients. Existing appointments are backfilled in created_at order.
--
--   2. Treatment methods are retired from the app. The service report now
--      records WHICH SERVICE was performed instead, chosen in the Report tab
--      (and in the technician's visit flow) rather than in Overview.
--
--      submit_appointment_report() gains p_service_id. When given, it sets
--      appointments.service_id and snapshots the service's CURRENT NAME into
--      appointments.service_type, exactly as create_appointment /
--      update_appointment do (migration 047) — so renaming or deleting a
--      service later still never rewrites history. The name is read from the
--      services table, not trusted from the caller. When null, the
--      appointment's service is left as it is.
--
--      The "record the treatment" rule used to accept ticked methods or the
--      free-text notes. It now accepts the visit's service or the notes.
--      Ticked methods are still accepted, so a report filed by an older build
--      of the app keeps working, and treatment_methods / the treatment_methods
--      table are left in place: old reports keep what was ticked on them.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Appointment references.
-- ---------------------------------------------------------------------------

create sequence if not exists public.appointment_reference_seq as bigint start 1;

alter table public.appointments add column if not exists reference text;

-- Backfill, oldest appointment first.
do $$
declare
  target record;
begin
  for target in
    select id from public.appointments where reference is null order by created_at, id
  loop
    update public.appointments
      set reference = 'TPC-V-' || lpad(nextval('public.appointment_reference_seq')::text, 5, '0')
      where id = target.id;
  end loop;
end $$;

-- New appointments get one automatically. Set after the backfill so the
-- existing rows keep the numbers assigned above.
alter table public.appointments
  alter column reference set default 'TPC-V-' || lpad(nextval('public.appointment_reference_seq')::text, 5, '0');

-- A reference identifies exactly one visit.
create unique index if not exists appointments_reference_key on public.appointments (reference);

-- The column default calls nextval(), so booking a visit needs the sequence.
grant usage, select on sequence public.appointment_reference_seq to anon, authenticated;

comment on column public.appointments.reference is
  'Human-readable visit number, TPC-V-00001. Issued by a sequence on insert; never reused.';

-- ---------------------------------------------------------------------------
-- 2. submit_appointment_report, from migration 038, with p_service_id.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text);
drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid);

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
  p_technician_signature_path text default null,
  p_service_id uuid default null
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
declare current_service text;
declare chosen_service_name text;
declare signed boolean;
declare tech_signed boolean;
declare confirmed boolean;
declare methods text[];
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;

  methods := coalesce(p_treatment_methods, '{}');

  select status, service_type into previous_status, current_service
  from public.appointments where id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  -- 050: the service performed, chosen on the report.
  if p_service_id is not null then
    select name into chosen_service_name from public.services where id = p_service_id;
    if chosen_service_name is null then
      raise exception 'That service no longer exists. Choose another.';
    end if;
    update public.appointments
      set service_id = p_service_id,
          service_type = chosen_service_name
      where id = p_appointment_id;
    current_service := chosen_service_name;
  end if;

  -- The work done must be recorded one way or another: the visit's service,
  -- the free-text notes, or (from older builds) ticked methods.
  if nullif(trim(coalesce(current_service, '')), '') is null
     and cardinality(methods) = 0
     and nullif(trim(coalesce(p_treatment_performed, '')), '') is null then
    raise exception 'Record the treatment: choose the service performed, or describe it in the notes.';
  end if;

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

grant execute on function public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select reference, scheduled_at, created_at from public.appointments order by reference;
--
--   Every appointment should have a TPC-V number, in the order they were
--   booked. Then reload PostgREST's schema cache (Settings > API, or
--   `notify pgrst, 'reload schema';`) so the app sees the new parameter.
-- ---------------------------------------------------------------------------
