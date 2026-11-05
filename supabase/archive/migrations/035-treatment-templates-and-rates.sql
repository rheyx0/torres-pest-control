-- ---------------------------------------------------------------------------
-- Migration 035 - Treatment method checklist and standard application rates.
--
-- Run after 034-service-completion-confirmation.sql.
--
-- Two problems, one migration.
--
--   1. "Treatment performed" was an empty box. Two technicians doing the same
--      job wrote it two different ways, in two languages, and nothing about it
--      was countable or comparable afterwards. Methods become a checklist.
--
--   2. Nothing recorded how much of a chemical was correct. inventory already
--      carries chemical_type, safety_level, hazard_rating and expiration_date
--      but no dosage, so a technician typing 4 instead of 0.4 had nothing to
--      check against.
--
-- The rate is deliberately ADVISORY, not enforced. A hard limit would block the
-- technician who genuinely used more on a bad infestation, and they would work
-- around it by under-reporting — which corrupts the stock figures, the one
-- number that has to stay true.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The ticked methods.
--
--    treatment_performed is NOT replaced. It stays as the free-text notes box
--    for anything unusual, so every report already filed keeps its text and
--    still prints.
-- ---------------------------------------------------------------------------

alter table public.appointment_reports
  add column if not exists treatment_methods text[] not null default '{}';

comment on column public.appointment_reports.treatment_methods is
  'Ticked treatment methods. Values mirror TREATMENT_METHODS in src/utils/constants.js.';

-- ---------------------------------------------------------------------------
-- 2. Standard application rate, per inventory item.
--
--    All nullable: every existing item keeps working with these empty, and an
--    item with no rate simply shows no guidance.
-- ---------------------------------------------------------------------------

alter table public.inventory add column if not exists standard_rate numeric;
alter table public.inventory add column if not exists rate_unit     text;
alter table public.inventory add column if not exists rate_note     text;

alter table public.inventory
  drop constraint if exists inventory_standard_rate_check;
alter table public.inventory
  add constraint inventory_standard_rate_check
  check (standard_rate is null or standard_rate > 0);

comment on column public.inventory.standard_rate is
  'Advisory amount per rate_unit. Never enforced — guidance shown at stock-out.';
comment on column public.inventory.rate_unit is
  'What standard_rate is measured against, e.g. "L water", "harborage point", "m2".';
comment on column public.inventory.rate_note is
  'Free text for dilution or mixing instructions, e.g. "0.03% dilution".';

-- ---------------------------------------------------------------------------
-- 3. Carry the methods through the report submission.
--
--    As in migration 034, the previous overload has to go first: the new
--    parameter has a default, so an 8-argument call would match both
--    definitions and Postgres would raise "function is not unique".
-- ---------------------------------------------------------------------------

drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text);

create or replace function public.submit_appointment_report(
  p_appointment_id uuid,
  p_findings text,
  p_treatment_performed text,
  p_recommendations text,
  p_follow_up_date date,
  p_customer_name text default null,
  p_signature_path text default null,
  p_completion_note text default null,
  p_treatment_methods text[] default null
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
declare signed boolean;
declare confirmed boolean;
declare methods text[];
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;

  methods := coalesce(p_treatment_methods, '{}');

  -- The work done must be recorded one way or the other: ticked methods, or
  -- the free-text box. Previously only the text box existed and was required.
  if cardinality(methods) = 0 and nullif(trim(coalesce(p_treatment_performed, '')), '') is null then
    raise exception 'Record the treatment: tick at least one method, or describe it in the notes.';
  end if;

  select status into previous_status from public.appointments where id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  signed := nullif(trim(coalesce(p_signature_path, '')), '') is not null;

  if signed and nullif(trim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'A customer name is required alongside the signature.';
  end if;

  confirmed := signed or nullif(trim(coalesce(p_completion_note, '')), '') is not null;

  actor_id := public.current_account_id();

  insert into public.appointment_reports (
    appointment_id, findings, treatment_performed, treatment_methods, recommendations,
    follow_up_date, submitted_by, customer_name, signature_path, signed_at, completion_note
  )
  values (
    p_appointment_id, trim(p_findings), nullif(trim(coalesce(p_treatment_performed, '')), ''),
    methods, nullif(trim(p_recommendations), ''), p_follow_up_date,
    actor_id,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_signature_path, '')), ''),
    case when signed then now() else null end,
    nullif(trim(coalesce(p_completion_note, '')), '')
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
    completion_note = coalesce(excluded.completion_note, appointment_reports.completion_note)
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

grant execute on function public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Note on the relaxed requirement
--
--   Before this migration treatment_performed was mandatory. It no longer is on
--   its own — a report is valid when the methods are ticked instead. Reports
--   filed earlier are untouched: they have their text and an empty method list,
--   which is a perfectly valid combination.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
