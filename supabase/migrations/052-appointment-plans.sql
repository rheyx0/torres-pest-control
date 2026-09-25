-- ---------------------------------------------------------------------------
-- Migration 052 - Recurring plans and multi-day jobs.
--
-- Run after 051-appointment-services.sql.
--
-- Until now a frequency was only a label: booking "Monthly" created one visit,
-- and the next one appeared as a reminder once the first was finished. Nothing
-- showed the months ahead, dates drifted with every late visit, and a job too
-- long for one working day (6 AM - 7 PM) could not be booked at all.
--
-- Two kinds of plan, one table:
--
--   RECURRING   the same service repeated: Daily, Weekly, ... Annual. Every
--               visit is booked up front. Each is a full visit with its own
--               price, report and signature.
--
--   MULTI_DAY   one job split across consecutive days: "Day 1 of 3". Charged
--               once (the price sits on Day 1), and ONE report and ONE
--               signature, filed on the last day, complete every day of it.
--               Days before the last are closed with finish_job_day().
--
-- Everything is booked through book_appointments(), which also books a plain
-- one-off visit (p_kind null). It creates each visit with create_appointment()
-- (047), so every existing guard — past dates, price cap, technician clashes —
-- still applies, and a clash between two visits of the same series is caught
-- because the earlier ones are already in the table. One transaction: the
-- whole series lands or none of it does.
--
-- Also here:
--   - 'Daily' added to the frequencies (041's check constraint).
--   - set_appointment_services(), the service-list write from 051, shared by
--     booking, the report and plan edits.
--   - submit_appointment_report(), from 051, with the multi-day rules. 052 is
--     now its source of truth; re-running 051 or 050 restores the old one —
--     re-run 052 after either.
--   - A trigger that keeps a multi-day job's days in order.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Daily.
-- ---------------------------------------------------------------------------

alter table public.appointments drop constraint if exists appointments_service_frequency_check;
alter table public.appointments
  add constraint appointments_service_frequency_check
  check (service_frequency is null or service_frequency in (
    'One-time', 'Daily', 'Weekly', 'Every 2 weeks', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual'
  ));

-- ---------------------------------------------------------------------------
-- 2. Plans.
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_plans (
  id           uuid        primary key default gen_random_uuid(),
  kind         text        not null check (kind in ('RECURRING', 'MULTI_DAY')),
  client_id    uuid        not null references public.clients(id) on delete cascade,
  frequency    text,
  skip_sundays boolean     not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

comment on table public.appointment_plans is
  'A recurring series or a multi-day job. Its visits point here through appointments.plan_id.';

alter table public.appointments add column if not exists plan_id uuid references public.appointment_plans(id) on delete set null;
alter table public.appointments add column if not exists plan_position integer;
alter table public.appointments add column if not exists day_done_at timestamptz;

comment on column public.appointments.plan_position is
  'Order within the plan, 1-based, as booked. Display counts the live visits instead, so a cancelled one does not leave a gap.';
comment on column public.appointments.day_done_at is
  'A multi-day job''s day closed on site (finish_job_day), or every day once the job''s report is signed.';

create index if not exists appointments_plan_id_idx on public.appointments (plan_id) where plan_id is not null;

alter table public.appointment_plans enable row level security;

drop policy if exists "Appointment plan read" on public.appointment_plans;
create policy "Appointment plan read" on public.appointment_plans
for select using (public.has_role_table_session());

grant select on public.appointment_plans to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Shared helpers. Internal: not callable through the API.
-- ---------------------------------------------------------------------------

create or replace function public.assert_office()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can change a plan.';
  end if;
end;
$$;

-- The visit's service list, as 051 wrote it inside the report: the list in
-- order, the first as service_id, the names joined as service_type.
create or replace function public.set_appointment_services(p_appointment_id uuid, p_service_ids uuid[])
returns text
language plpgsql security definer set search_path = public
as $$
declare joined text;
begin
  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    select service_type into joined from public.appointments where id = p_appointment_id;
    return joined;
  end if;

  if exists (
    select 1 from unnest(p_service_ids) as ids(id)
    where ids.id is null or not exists (select 1 from public.services s where s.id = ids.id)
  ) then
    raise exception 'One of those services no longer exists. Choose again.';
  end if;

  delete from public.appointment_services where appointment_id = p_appointment_id;

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
    returning a.service_type into joined;
  return joined;
end;
$$;

-- The last live (not cancelled) day of a multi-day job: where its report goes.
create or replace function public.plan_last_day(p_plan_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.appointments
  where plan_id = p_plan_id and status <> 'Cancelled'
  order by scheduled_at desc, plan_position desc
  limit 1;
$$;

revoke all on function public.assert_office() from public, anon, authenticated;
revoke all on function public.set_appointment_services(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.plan_last_day(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Booking: one visit, a recurring series, or a multi-day job.
--
--    p_visits is [{scheduled_at, duration_minutes}, ...], in the order they
--    happen. The dates are worked out in the app (utils/plans.js), shown to
--    the office, adjusted, and only then sent — so this function books exactly
--    what was on screen rather than recomputing it.
-- ---------------------------------------------------------------------------

drop function if exists public.book_appointments(text, jsonb, uuid, text, uuid[], text, uuid[], text, text, numeric, boolean);

create function public.book_appointments(
  p_kind              text,
  p_visits            jsonb,
  p_client_id         uuid,
  p_pest_concern      text,
  p_service_ids       uuid[],
  p_service_location  text,
  p_technician_ids    uuid[],
  p_notes             text,
  p_service_frequency text,
  p_price             numeric,
  p_skip_sundays      boolean default true
)
returns setof public.appointments
language plpgsql security definer set search_path = public
as $$
declare
  new_plan_id    uuid;
  visit          record;
  created        public.appointments;
  position_no    integer := 0;
  visit_count    integer;
  first_service  uuid;
  service_names  text;
  visit_price    numeric;
  visit_frequency text;
  previous_end   timestamptz;
begin
  perform public.assert_office();

  if p_kind is not null and p_kind not in ('RECURRING', 'MULTI_DAY') then
    raise exception 'Unknown plan type.';
  end if;
  if p_visits is null or jsonb_typeof(p_visits) <> 'array' then
    raise exception 'The visits must be a list.';
  end if;
  visit_count := jsonb_array_length(p_visits);
  if visit_count = 0 then raise exception 'Add at least one visit.'; end if;
  if visit_count > 60 then raise exception 'A plan can hold at most 60 visits.'; end if;
  if p_kind is null and visit_count > 1 then
    raise exception 'Several visits need a recurring plan or a multi-day job.';
  end if;
  if p_kind is not null and visit_count < 2 then
    raise exception 'A plan needs at least two visits.';
  end if;
  if p_kind = 'RECURRING' and coalesce(p_service_frequency, 'One-time') = 'One-time' then
    raise exception 'Choose how often the service repeats.';
  end if;

  -- The services: the first is service_id, the names joined are service_type.
  if p_service_ids is not null and cardinality(p_service_ids) > 0 then
    if exists (
      select 1 from unnest(p_service_ids) as ids(id)
      where ids.id is null or not exists (select 1 from public.services s where s.id = ids.id)
    ) then
      raise exception 'One of those services no longer exists. Choose again.';
    end if;
    first_service := p_service_ids[1];
    select string_agg(s.name, ', ' order by ids.ord) into service_names
    from unnest(p_service_ids) with ordinality as ids(id, ord)
    join public.services s on s.id = ids.id;
  end if;

  if p_kind is not null then
    insert into public.appointment_plans (kind, client_id, frequency, skip_sundays, created_by)
    values (
      p_kind, p_client_id,
      case when p_kind = 'RECURRING' then p_service_frequency end,
      coalesce(p_skip_sundays, true),
      public.current_account_id()
    )
    returning id into new_plan_id;
  end if;

  for visit in
    select (entry->>'scheduled_at')::timestamptz as scheduled_at,
           (entry->>'duration_minutes')::integer as duration_minutes
    from jsonb_array_elements(p_visits) as entry
    order by (entry->>'scheduled_at')::timestamptz
  loop
    position_no := position_no + 1;

    -- A multi-day job's days follow one another; they never overlap.
    if p_kind = 'MULTI_DAY' and previous_end is not null and visit.scheduled_at < previous_end then
      raise exception 'Day % starts before Day % ends.', position_no, position_no - 1;
    end if;
    previous_end := visit.scheduled_at + make_interval(mins => visit.duration_minutes);

    -- Recurring: every visit is charged. Multi-day: the job is charged once,
    -- on Day 1, so totals and revenue count it once.
    visit_price := case when p_kind = 'MULTI_DAY' and position_no > 1 then null else p_price end;
    visit_frequency := case when p_kind = 'MULTI_DAY' then 'One-time' else p_service_frequency end;

    select * into created from public.create_appointment(
      p_client_id, visit.scheduled_at, visit.duration_minutes,
      p_pest_concern, service_names, p_service_location,
      p_technician_ids, p_notes, visit_frequency, visit_price, first_service
    );

    if new_plan_id is not null then
      update public.appointments set plan_id = new_plan_id, plan_position = position_no where id = created.id;
    end if;
    if p_service_ids is not null and cardinality(p_service_ids) > 0 then
      perform public.set_appointment_services(created.id, p_service_ids);
    end if;

    return query select * from public.appointments where id = created.id;
  end loop;
end;
$$;

grant execute on function public.book_appointments(text, jsonb, uuid, text, uuid[], text, uuid[], text, text, numeric, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A multi-day job's days stay in order.
--
--    Moving Day 2 before Day 1 would put the report on the wrong day and read
--    as nonsense on the calendar. Enforced here so every write path — the drag,
--    the form, a manual fix — obeys it.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_plan_day_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare plan_kind text;
begin
  if new.plan_id is null or new.scheduled_at is not distinct from old.scheduled_at then
    return new;
  end if;
  select kind into plan_kind from public.appointment_plans where id = new.plan_id;
  if plan_kind is distinct from 'MULTI_DAY' then return new; end if;

  if exists (
    select 1 from public.appointments other
    where other.plan_id = new.plan_id and other.id <> new.id and other.status <> 'Cancelled'
      and (
        (other.plan_position < new.plan_position and other.scheduled_at >= new.scheduled_at)
        or (other.plan_position > new.plan_position and other.scheduled_at <= new.scheduled_at)
      )
  ) then
    raise exception 'A day of a multi-day job cannot move past the day before or after it.';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_enforce_plan_day_order on public.appointments;
create trigger appointments_enforce_plan_day_order
before update of scheduled_at on public.appointments
for each row execute function public.enforce_plan_day_order();

-- ---------------------------------------------------------------------------
-- 6. submit_appointment_report, from 051, with the multi-day rules.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text);
drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid);
drop function if exists public.submit_appointment_report(uuid, text, text, text, date, text, text, text, text[], text, uuid[]);

create function public.submit_appointment_report(
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
declare job_plan uuid;
declare job_kind text;
declare signed boolean;
declare tech_signed boolean;
declare confirmed boolean;
declare methods text[];
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;

  methods := coalesce(p_treatment_methods, '{}');

  select a.status, a.service_type, a.plan_id, p.kind
    into previous_status, current_service, job_plan, job_kind
  from public.appointments a
  left join public.appointment_plans p on p.id = a.plan_id
  where a.id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  -- 052: a multi-day job has one report, on its last day.
  if job_kind = 'MULTI_DAY' and public.plan_last_day(job_plan) is distinct from p_appointment_id then
    raise exception 'This job''s report is filed on its last day.';
  end if;

  -- 051: the services performed, ticked on the report. Replaces the list.
  if p_service_ids is not null and cardinality(p_service_ids) > 0 then
    current_service := public.set_appointment_services(p_appointment_id, p_service_ids);
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
    if job_kind = 'MULTI_DAY' then
      -- 052: the signature completes the whole job, every live day of it.
      update public.appointments
        set status = 'Completed', day_done_at = coalesce(day_done_at, now())
        where plan_id = job_plan and status <> 'Cancelled';
    else
      update public.appointments set status = 'Completed' where id = p_appointment_id;
    end if;
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

-- ---------------------------------------------------------------------------
-- 7. On site: close a day of a multi-day job, or finish the job early.
--    The assigned crew or the office.
-- ---------------------------------------------------------------------------

create or replace function public.assert_can_work_visit(p_appointment_id uuid)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() = 'TECHNICIAN' and not public.is_assigned_to_appointment(p_appointment_id) then
    raise exception 'You can only do that on a visit you are assigned to.';
  end if;
end;
$$;

revoke all on function public.assert_can_work_visit(uuid) from public, anon, authenticated;

drop function if exists public.finish_job_day(uuid);

create function public.finish_job_day(p_appointment_id uuid)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare target public.appointments;
declare job_kind text;
begin
  perform public.assert_can_work_visit(p_appointment_id);

  select a.* into target from public.appointments a where a.id = p_appointment_id;
  if target.id is null then raise exception 'Appointment not found.'; end if;
  select kind into job_kind from public.appointment_plans where id = target.plan_id;
  if job_kind is distinct from 'MULTI_DAY' then raise exception 'Only a day of a multi-day job is closed this way.'; end if;
  if target.status in ('Cancelled', 'Completed') then raise exception 'This day is already closed.'; end if;
  if public.plan_last_day(target.plan_id) = p_appointment_id then
    raise exception 'This is the job''s last day: file the report to finish it.';
  end if;

  update public.appointments set day_done_at = now() where id = p_appointment_id returning * into target;
  return target;
end;
$$;

grant execute on function public.finish_job_day(uuid) to anon, authenticated;

-- Ends a multi-day job on this day: the days after it are cancelled, so this
-- becomes the last day and takes the report.
drop function if exists public.finish_job_here(uuid);

create function public.finish_job_here(p_appointment_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare target public.appointments;
declare job_kind text;
declare cancelled_count integer;
begin
  perform public.assert_can_work_visit(p_appointment_id);

  select a.* into target from public.appointments a where a.id = p_appointment_id;
  if target.id is null then raise exception 'Appointment not found.'; end if;
  select kind into job_kind from public.appointment_plans where id = target.plan_id;
  if job_kind is distinct from 'MULTI_DAY' then raise exception 'Only a multi-day job can be finished early.'; end if;
  if target.status = 'Cancelled' then raise exception 'This day is cancelled.'; end if;

  update public.appointments
    set status = 'Cancelled', cancellation_reason = 'Job finished early'
    where plan_id = target.plan_id and scheduled_at > target.scheduled_at
      and status not in ('Completed', 'Cancelled', 'In progress');
  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

grant execute on function public.finish_job_here(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Office plan changes.
-- ---------------------------------------------------------------------------

-- Cancel every visit still to come. Visits already done, cancelled or being
-- worked on right now are left as they are.
drop function if exists public.cancel_plan_remaining(uuid);

create function public.cancel_plan_remaining(p_plan_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare cancelled_count integer;
begin
  perform public.assert_office();
  update public.appointments
    set status = 'Cancelled', cancellation_reason = 'Plan cancelled'
    where plan_id = p_plan_id and scheduled_at > now()
      and status not in ('Completed', 'Cancelled', 'In progress');
  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

grant execute on function public.cancel_plan_remaining(uuid) to anon, authenticated;

-- One more day (or visit) after the plan's last live one: same client,
-- service, crew and notes; no price, since a multi-day job is charged once.
drop function if exists public.add_plan_visit(uuid, timestamptz, integer);

create function public.add_plan_visit(p_plan_id uuid, p_scheduled_at timestamptz, p_duration_minutes integer)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare last_visit public.appointments;
declare crew uuid[];
declare services uuid[];
declare created public.appointments;
begin
  perform public.assert_office();

  select * into last_visit from public.appointments
  where plan_id = p_plan_id and status <> 'Cancelled'
  order by scheduled_at desc limit 1;
  if last_visit.id is null then raise exception 'That plan has no visits left to follow.'; end if;
  if p_scheduled_at < last_visit.scheduled_at + make_interval(mins => last_visit.duration_minutes) then
    raise exception 'The new day must start after the current last day ends.';
  end if;
  if last_visit.status = 'Completed' then
    raise exception 'This job is already completed.';
  end if;

  select array_agg(technician_id order by is_lead desc, assigned_at) into crew
  from public.appointment_technicians where appointment_id = last_visit.id;
  select array_agg(service_id order by position) into services
  from public.appointment_services where appointment_id = last_visit.id and service_id is not null;

  select * into created from public.create_appointment(
    last_visit.client_id, p_scheduled_at, p_duration_minutes,
    last_visit.pest_concern, last_visit.service_type, last_visit.service_location,
    crew, last_visit.notes, last_visit.service_frequency, null, last_visit.service_id
  );

  update public.appointments
    set plan_id = p_plan_id,
        plan_position = (select coalesce(max(plan_position), 0) + 1 from public.appointments where plan_id = p_plan_id)
    where id = created.id;
  if services is not null then perform public.set_appointment_services(created.id, services); end if;

  select * into created from public.appointments where id = created.id;
  return created;
end;
$$;

grant execute on function public.add_plan_visit(uuid, timestamptz, integer) to anon, authenticated;

-- Change every visit from p_from_appointment_id on: a new start time (recurring
-- only; a multi-day job's hours come from how it was split), a new crew, or a
-- new service list. Null leaves that part as it is. Visits already done,
-- cancelled or in progress are skipped.
drop function if exists public.update_plan_future(uuid, uuid, text, uuid[], uuid[]);

create function public.update_plan_future(
  p_plan_id uuid,
  p_from_appointment_id uuid,
  p_start_time text default null,
  p_technician_ids uuid[] default null,
  p_service_ids uuid[] default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare plan_kind text;
declare from_start timestamptz;
declare visit public.appointments;
declare new_start timestamptz;
declare crew uuid[];
declare changed integer := 0;
begin
  perform public.assert_office();

  select kind into plan_kind from public.appointment_plans where id = p_plan_id;
  if plan_kind is null then raise exception 'Plan not found.'; end if;
  if plan_kind = 'MULTI_DAY' and p_start_time is not null then
    raise exception 'A multi-day job''s hours come from how it was split; move a single day instead.';
  end if;
  select scheduled_at into from_start from public.appointments where id = p_from_appointment_id and plan_id = p_plan_id;
  if from_start is null then raise exception 'That visit is not part of this plan.'; end if;

  for visit in
    select * from public.appointments
    where plan_id = p_plan_id and scheduled_at >= from_start
      and status not in ('Completed', 'Cancelled', 'In progress')
    order by scheduled_at
  loop
    new_start := case
      when p_start_time is null then visit.scheduled_at
      else ((visit.scheduled_at at time zone 'Asia/Manila')::date + p_start_time::time) at time zone 'Asia/Manila'
    end;
    if new_start <> visit.scheduled_at and new_start < now() - interval '5 minutes' then
      raise exception 'Visits cannot be moved into the past.';
    end if;

    select coalesce(p_technician_ids, array_agg(technician_id order by is_lead desc, assigned_at)) into crew
    from public.appointment_technicians where appointment_id = visit.id;

    perform public.assert_technicians_available(visit.id, crew, new_start, visit.duration_minutes);

    if new_start <> visit.scheduled_at then
      update public.appointments set scheduled_at = new_start where id = visit.id;
    end if;
    if p_technician_ids is not null then
      perform public.set_appointment_technicians(visit.id, p_technician_ids);
    end if;
    if p_service_ids is not null and cardinality(p_service_ids) > 0 then
      perform public.set_appointment_services(visit.id, p_service_ids);
    end if;
    changed := changed + 1;
  end loop;

  return changed;
end;
$$;

grant execute on function public.update_plan_future(uuid, uuid, text, uuid[], uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select p.kind, p.frequency, a.plan_position, a.reference, a.scheduled_at, a.status, a.price
--   from public.appointment_plans p
--   join public.appointments a on a.plan_id = p.id
--   order by p.created_at, a.scheduled_at;
-- ---------------------------------------------------------------------------
