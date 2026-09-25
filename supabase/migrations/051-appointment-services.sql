-- ---------------------------------------------------------------------------
-- Migration 051 - A visit can carry more than one service.
--
-- Run after 050-visit-references-and-report-service.sql.
--
-- A technician often does two things on one visit — a termite treatment and a
-- rodent baiting round — and the report could only name one. The service
-- performed is now a list, ticked on the report (Report tab, and the
-- technician's visit flow).
--
-- Same shape as the crew in migration 041:
--
--   appointment_services     every service on the visit, in the order ticked,
--                            with the name as it was when filed (a snapshot,
--                            so renaming or deleting a service never rewrites
--                            a past report).
--
--   appointments.service_id  the FIRST service, as before.
--   appointments.service_type
--                            every name, joined: "Termite Control, Rodent
--                            Control". It was already the name-as-booked
--                            snapshot, and every list, dashboard, search and
--                            the printed form read it — so all of them show the
--                            whole list without a change.
--
-- submit_appointment_report() takes p_service_ids uuid[] in place of 050's
-- p_service_id. Null leaves the visit's services alone; a list replaces them.
-- The "record the treatment" rule is unchanged from 050: the visit must have a
-- service, or notes, or (from old builds) ticked methods.
--
-- Safe to run more than once. Re-running 050 restores the single-service
-- function; re-run 051 after it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The list.
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_services (
  appointment_id uuid    not null references public.appointments(id) on delete cascade,
  position       integer not null,
  -- Null once the service is deleted from the catalog; service_name keeps
  -- what the report said.
  service_id     uuid    references public.services(id) on delete set null,
  service_name   text    not null,
  primary key (appointment_id, position)
);

comment on table public.appointment_services is
  'Every service performed on a visit, in order. Position 0 mirrors appointments.service_id; the names joined make appointments.service_type.';

create index if not exists appointment_services_service_idx
  on public.appointment_services (service_id);

-- Everything filed before this migration had at most one service.
insert into public.appointment_services (appointment_id, position, service_id, service_name)
select a.id, 0, a.service_id, a.service_type
from public.appointments a
where nullif(trim(coalesce(a.service_type, '')), '') is not null
  and not exists (select 1 from public.appointment_services s where s.appointment_id = a.id);

-- Readable by anyone signed in, like the crew table (041): the rows say which
-- services a visit had, nothing a signed-in user cannot already see on the
-- appointment itself. Writes go through submit_appointment_report only.
alter table public.appointment_services enable row level security;

drop policy if exists "Appointment service read" on public.appointment_services;
create policy "Appointment service read" on public.appointment_services
for select using (public.has_role_table_session());

grant select on public.appointment_services to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. submit_appointment_report, from 050, with p_service_ids.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text);
drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid);
drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid[]);

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
  p_service_ids uuid[] default null
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
declare current_service text;
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

  -- 051: the services performed, ticked on the report. Replaces the list.
  if p_service_ids is not null and cardinality(p_service_ids) > 0 then
    if exists (
      select 1 from unnest(p_service_ids) as ids(id)
      where ids.id is null or not exists (select 1 from public.services s where s.id = ids.id)
    ) then
      raise exception 'One of those services no longer exists. Choose again.';
    end if;

    delete from public.appointment_services where appointment_id = p_appointment_id;

    -- In the order ticked; a service ticked twice is kept once, where it first appeared.
    insert into public.appointment_services (appointment_id, position, service_id, service_name)
    select p_appointment_id, (row_number() over (order by chosen.first_position))::integer - 1, chosen.id, chosen.name
    from (
      select s.id, s.name, min(ids.ord) as first_position
      from unnest(p_service_ids) with ordinality as ids(id, ord)
      join public.services s on s.id = ids.id
      group by s.id, s.name
    ) chosen;

    update public.appointments a
      set service_id = (select x.service_id from public.appointment_services x
                        where x.appointment_id = p_appointment_id order by x.position limit 1),
          service_type = (select string_agg(x.service_name, ', ' order by x.position)
                          from public.appointment_services x where x.appointment_id = p_appointment_id)
      where a.id = p_appointment_id
      returning a.service_type into current_service;
  end if;

  if nullif(trim(coalesce(current_service, '')), '') is null
     and cardinality(methods) = 0
     and nullif(trim(coalesce(p_treatment_performed, '')), '') is null then
    raise exception 'Record the treatment: tick the services performed.';
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

grant execute on function public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select a.reference, a.service_type, s.position, s.service_name
--   from public.appointments a
--   left join public.appointment_services s on s.appointment_id = a.id
--   order by a.reference, s.position;
--
--   Every visit with a service has a position-0 row matching service_id.
-- ---------------------------------------------------------------------------
