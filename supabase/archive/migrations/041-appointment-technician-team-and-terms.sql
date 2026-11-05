-- ---------------------------------------------------------------------------
-- Migration 041 - More than one technician per appointment, plus the service
-- terms the client's service history is reported on.
--
-- Run after 040-inventory-bulk-intake-and-stock-out-reasons.sql.
--
-- Two changes, in one file because they touch the same two functions and
-- splitting them is exactly how migration 024 lost 022's overlap check.
--
-- WHY A JOIN TABLE AND NOT A uuid[] COLUMN --------------------------------
--
--   appointments.technician_id is read by the RLS policy that decides what a
--   technician may see (migration 030), by two overlap checks, and by half a
--   dozen indexes and queries. An array column would have to be unnested in
--   every one of those places, and could not be indexed for the "is this
--   person on this job" question that the policy asks once per row.
--
--   So the crew lives in its own table, and appointments.technician_id stays —
--   now meaning the LEAD technician. Every existing query keeps working and
--   keeps returning something true; it just answers "who leads this job"
--   rather than "who is on it". A trigger keeps the two in step, so neither
--   can be updated into disagreeing with the other.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The crew.
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_technicians (
  appointment_id uuid    not null references public.appointments(id) on delete cascade,
  technician_id  uuid    not null,
  is_lead        boolean not null default false,
  assigned_at    timestamptz not null default now(),
  primary key (appointment_id, technician_id)
);

comment on table public.appointment_technicians is
  'Every technician assigned to an appointment. The row with is_lead mirrors appointments.technician_id.';

create index if not exists appointment_technicians_technician_idx
  on public.appointment_technicians (technician_id);

-- At most one lead per appointment. A partial unique index rather than a
-- constraint, because the rule only applies to the rows where is_lead is true.
create unique index if not exists appointment_technicians_one_lead_idx
  on public.appointment_technicians (appointment_id)
  where is_lead;

-- Everything booked before this migration had exactly one technician, who is
-- by definition the lead.
insert into public.appointment_technicians (appointment_id, technician_id, is_lead)
select a.id, a.technician_id, true
from public.appointments a
where a.technician_id is not null
on conflict (appointment_id, technician_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The lead column follows the crew table.
--
--    Any write to appointment_technicians re-derives appointments.technician_id
--    from it. That covers the paths that do not go through update_appointment
--    (a manual fix in the SQL editor, a future function), so the mirror cannot
--    silently rot.
-- ---------------------------------------------------------------------------

create or replace function public.sync_appointment_lead_technician()
returns trigger
language plpgsql
set search_path = public
as $$
declare target_appointment uuid;
begin
  target_appointment := coalesce(new.appointment_id, old.appointment_id);

  update public.appointments a
  set technician_id = (
    select at.technician_id
    from public.appointment_technicians at
    where at.appointment_id = target_appointment
    order by at.is_lead desc, at.assigned_at, at.technician_id
    limit 1
  )
  where a.id = target_appointment
    and a.technician_id is distinct from (
      select at.technician_id
      from public.appointment_technicians at
      where at.appointment_id = target_appointment
      order by at.is_lead desc, at.assigned_at, at.technician_id
      limit 1
    );

  return coalesce(new, old);
end;
$$;

drop trigger if exists appointment_technicians_sync_lead on public.appointment_technicians;
create trigger appointment_technicians_sync_lead
after insert or update or delete on public.appointment_technicians
for each row execute function public.sync_appointment_lead_technician();

-- ---------------------------------------------------------------------------
-- 3. Row-level security follows the crew, not just the lead.
--
--    can_read_appointment(technician_id) from migration 030 is kept and still
--    works, but on its own it would now hide a job from the second technician
--    on it — which is the whole point of the change. The policies move to a
--    function that takes the appointment id so it can look at the crew table.
-- ---------------------------------------------------------------------------

create or replace function public.is_assigned_to_appointment(p_appointment_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.appointment_technicians at
    where at.appointment_id = p_appointment_id
      and at.technician_id = public.current_account_id()
  );
$$;

grant execute on function public.is_assigned_to_appointment(uuid) to anon, authenticated;

create or replace function public.can_read_appointment_row(p_appointment_id uuid, p_technician_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.current_account_role() = 'TECHNICIAN'
      then (p_technician_id is not null and p_technician_id = public.current_account_id())
        or public.is_assigned_to_appointment(p_appointment_id)
    else public.has_role_table_session()
  end;
$$;

grant execute on function public.can_read_appointment_row(uuid, uuid) to anon, authenticated;

drop policy if exists "Appointment read scope" on public.appointments;
create policy "Appointment read scope" on public.appointments
for select using (public.can_read_appointment_row(id, technician_id));

drop policy if exists "Appointment report read scope" on public.appointment_reports;
create policy "Appointment report read scope" on public.appointment_reports
for select using (exists (
  select 1 from public.appointments a
  where a.id = appointment_reports.appointment_id
    and public.can_read_appointment_row(a.id, a.technician_id)
));

drop policy if exists "Report attachment read scope" on public.appointment_report_attachments;
create policy "Report attachment read scope" on public.appointment_report_attachments
for select using (exists (
  select 1 from public.appointments a
  where a.id = appointment_report_attachments.appointment_id
    and public.can_read_appointment_row(a.id, a.technician_id)
));

-- The crew table itself is readable by anyone signed in: staff and admin need
-- the whole roster to dispatch, and a technician already sees the appointments
-- they are on. Writes go through the functions below, which are security
-- definer, so no insert/update policy is granted here.
alter table public.appointment_technicians enable row level security;

drop policy if exists "Appointment technician read" on public.appointment_technicians;
create policy "Appointment technician read" on public.appointment_technicians
for select using (public.has_role_table_session());

grant select on public.appointment_technicians to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Service terms.
--
--    The client's service history is reported as Date / Frequency / Price /
--    Last appointment, and neither frequency nor price existed anywhere in the
--    schema. Both belong to the visit rather than to the client: a quarterly
--    maintenance contract and a one-off fumigation for the same client carry
--    different terms, and the price of a visit must stay what it was on the
--    day, not follow a rate card that changes later.
-- ---------------------------------------------------------------------------

alter table public.appointments add column if not exists service_frequency text;
alter table public.appointments add column if not exists price numeric;

comment on column public.appointments.service_frequency is
  'How often this service recurs. Mirrors SERVICE_FREQUENCIES in src/utils/constants.js.';
comment on column public.appointments.price is
  'Agreed price for this visit, in PHP. Recorded per visit so history keeps the figure of the day.';

alter table public.appointments drop constraint if exists appointments_price_check;
alter table public.appointments
  add constraint appointments_price_check check (price is null or price >= 0);

alter table public.appointments drop constraint if exists appointments_service_frequency_check;
alter table public.appointments
  add constraint appointments_service_frequency_check
  check (service_frequency is null or service_frequency in (
    'One-time', 'Weekly', 'Every 2 weeks', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual'
  ));

-- ---------------------------------------------------------------------------
-- 5. create_appointment / update_appointment.
--
--    The 027 signatures are dropped explicitly: PostgREST resolves an RPC by
--    argument name, so leaving the old overloads beside the new ones makes the
--    call ambiguous and every booking fails with PGRST203.
--
--    p_technician_ids is ordered. The first entry is the lead, which is what
--    keeps appointments.technician_id meaningful for the calendar's colour
--    coding and for every report that already prints one name.
-- ---------------------------------------------------------------------------

drop function if exists public.create_appointment(uuid, timestamptz, integer, text, text, text, uuid, text);
drop function if exists public.update_appointment(uuid, timestamptz, integer, text, text, text, uuid, text, text, text);

-- Shared by both: every technician on the job must be free for the whole
-- window, not just the lead. Checks the crew table, so a clash with somebody
-- else's second technician is caught too.
create or replace function public.assert_technicians_available(
  p_appointment_id uuid,
  p_technician_ids uuid[],
  p_scheduled_at timestamptz,
  p_duration_minutes integer
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  candidate uuid;
  clash_name text;
begin
  if p_technician_ids is null then return; end if;

  foreach candidate in array p_technician_ids loop
    if candidate is null then continue; end if;

    if not public.account_is_active(candidate) then
      raise exception 'Technician or Staff account is not active.';
    end if;

    select coalesce(t.name, 'That technician') into clash_name
    from public.appointments other
    left join public.technicians t on t.id = candidate
    where other.id is distinct from p_appointment_id
      and other.status <> 'Cancelled'
      and other.scheduled_at < p_scheduled_at + make_interval(mins => p_duration_minutes)
      and other.scheduled_at + make_interval(mins => other.duration_minutes) > p_scheduled_at
      and (
        other.technician_id = candidate
        or exists (
          select 1 from public.appointment_technicians at
          where at.appointment_id = other.id and at.technician_id = candidate
        )
      )
    limit 1;

    if clash_name is not null then
      raise exception '% is already assigned during this time.', clash_name;
    end if;
  end loop;
end;
$$;

grant execute on function public.assert_technicians_available(uuid, uuid[], timestamptz, integer) to anon, authenticated;

-- Replaces the crew of one appointment with exactly p_technician_ids, first
-- entry leading. Duplicates in the input are ignored rather than rejected: the
-- same person picked twice in a multi-select is a slip, not a booking error.
create or replace function public.set_appointment_technicians(
  p_appointment_id uuid,
  p_technician_ids uuid[]
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.appointment_technicians at
  where at.appointment_id = p_appointment_id
    and (p_technician_ids is null or not (at.technician_id = any (p_technician_ids)));

  if p_technician_ids is null then
    update public.appointments set technician_id = null where id = p_appointment_id;
    return;
  end if;

  -- Clear the old lead before writing the new one: appointment_technicians_one_lead_idx
  -- allows a single is_lead row per appointment, and swapping the lead between two
  -- people who are both staying on the job would otherwise collide mid-statement.
  update public.appointment_technicians
  set is_lead = false
  where appointment_id = p_appointment_id and is_lead;

  insert into public.appointment_technicians (appointment_id, technician_id, is_lead)
  select p_appointment_id, entry.technician_id, entry.position = 1
  from (
    select distinct on (ids.technician_id) ids.technician_id, ids.position
    from unnest(p_technician_ids) with ordinality as ids(technician_id, position)
    where ids.technician_id is not null
    order by ids.technician_id, ids.position
  ) entry
  on conflict (appointment_id, technician_id)
  do update set is_lead = excluded.is_lead;

  if not exists (select 1 from public.appointment_technicians at where at.appointment_id = p_appointment_id) then
    update public.appointments set technician_id = null where id = p_appointment_id;
  end if;
end;
$$;

grant execute on function public.set_appointment_technicians(uuid, uuid[]) to anon, authenticated;

create or replace function public.create_appointment(
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_service_type text,
  p_service_location text,
  p_technician_ids uuid[],
  p_notes text,
  p_service_frequency text,
  p_price numeric
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare created public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Duration must be between 1 minute and 24 hours.';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and status = 'ACTIVE') then
    raise exception 'Active client not found.';
  end if;
  if p_price is not null and p_price < 0 then raise exception 'Price cannot be negative.'; end if;

  perform public.assert_technicians_available(null, p_technician_ids, p_scheduled_at, p_duration_minutes);

  insert into public.appointments (
    client_id, scheduled_at, duration_minutes, pest_concern, service_type,
    service_location, technician_id, notes, created_by, service_frequency, price
  )
  select p_client_id, p_scheduled_at, p_duration_minutes,
         nullif(trim(p_pest_concern), ''), nullif(trim(p_service_type), ''),
         nullif(trim(p_service_location), ''),
         (select ids.technician_id
          from unnest(coalesce(p_technician_ids, array[]::uuid[])) with ordinality as ids(technician_id, position)
          where ids.technician_id is not null
          order by ids.position limit 1),
         nullif(trim(p_notes), ''), r.id,
         nullif(trim(p_service_frequency), ''), p_price
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  limit 1
  returning * into created;

  perform public.set_appointment_technicians(created.id, p_technician_ids);

  select * into created from public.appointments where id = created.id;
  return created;
end;
$$;

grant execute on function public.create_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, numeric) to anon, authenticated;

create or replace function public.update_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_service_type text,
  p_service_location text,
  p_technician_ids uuid[],
  p_status text,
  p_notes text,
  p_cancellation_reason text,
  p_service_frequency text,
  p_price numeric
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare updated public.appointments;
declare existing_row public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Duration must be between 1 minute and 24 hours.';
  end if;
  if p_status not in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'Completed', 'Cancelled') then
    raise exception 'Invalid appointment status.';
  end if;
  if p_price is not null and p_price < 0 then raise exception 'Price cannot be negative.'; end if;

  select * into existing_row from public.appointments where id = p_appointment_id;
  if existing_row.id is null then raise exception 'Appointment not found.'; end if;

  if (existing_row.scheduled_at is distinct from p_scheduled_at
      or existing_row.duration_minutes is distinct from p_duration_minutes)
     and existing_row.status <> 'Reschedule' then
    raise exception 'Change the status to Reschedule before moving or resizing the appointment.';
  end if;

  perform public.assert_technicians_available(p_appointment_id, p_technician_ids, p_scheduled_at, p_duration_minutes);

  -- The crew is written first so the sync trigger's technician_id is in place
  -- before this statement sets the rest of the row; the update then re-asserts
  -- the lead from the same ordered input, and the two cannot disagree.
  perform public.set_appointment_technicians(p_appointment_id, p_technician_ids);

  update public.appointments
  set scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      pest_concern = nullif(trim(p_pest_concern), ''),
      service_type = nullif(trim(p_service_type), ''),
      service_location = nullif(trim(p_service_location), ''),
      technician_id = (select ids.technician_id
                       from unnest(coalesce(p_technician_ids, array[]::uuid[])) with ordinality as ids(technician_id, position)
                       where ids.technician_id is not null
                       order by ids.position limit 1),
      status = p_status,
      notes = nullif(trim(p_notes), ''),
      cancellation_reason = case when p_status = 'Cancelled' then nullif(trim(p_cancellation_reason), '') end,
      service_frequency = nullif(trim(p_service_frequency), ''),
      price = p_price
  where id = p_appointment_id
  returning * into updated;
  return updated;
end;
$$;

grant execute on function public.update_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, text, text, numeric) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   select a.id, a.technician_id as lead,
--          array_agg(at.technician_id order by at.is_lead desc) as crew
--   from public.appointments a
--   left join public.appointment_technicians at on at.appointment_id = a.id
--   group by a.id
--   limit 5;
--     -> lead must be the first element of crew on every row
--
--   The RLS change cannot be checked from the SQL editor: the policies read
--   the x-session-token request header, which is absent there, so every helper
--   returns null and you see zero rows. Check it from the app — sign in as the
--   SECOND technician on a two-technician appointment and confirm the visit
--   appears in their calendar.
-- ---------------------------------------------------------------------------
