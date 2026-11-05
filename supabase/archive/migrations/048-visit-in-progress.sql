-- ---------------------------------------------------------------------------
-- Migration 048 - "In progress": a technician starts a visit on site.
--
-- Run after 047-service-profiles-and-safeguards.sql.
--
-- The technician's phone flow has a "Start visit" button. Until now a visit
-- went straight from Confirmed to Completed, so the office could not tell who
-- was on site right now, and nothing recorded how long a job actually took.
--
--   1. appointments.started_at - when the visit was started. Set once, by
--      start_visit(); never cleared, so the time on site survives the visit
--      being completed (or, rarely, moved back to Confirmed by the office).
--
--   2. 'In progress' joins the allowed statuses (the check constraint from
--      migration 020). The transition trigger from migration 027 needs no
--      change: it only guards leaving Completed and Cancelled, and an
--      in-progress visit completes through submit_appointment_report exactly
--      like a confirmed one.
--
--   3. update_appointment() is recreated from the migration 047 definition
--      with 'In progress' added to its status list. Without that, the office
--      editing an in-progress visit (fixing the price, adding a note) would be
--      refused with "Invalid appointment status". Nothing else changes.
--      THIS FILE IS NOW THE SOURCE OF TRUTH FOR update_appointment():
--      re-running 047 (or 041) restores the old status list, so re-run 048
--      after either.
--
--   4. start_visit(appointment) - the one way a visit becomes In progress.
--      A technician may only start a visit they are on (lead or crew), on its
--      own day in the business's time zone (Asia/Manila), and only from
--      Pending, Confirmed or Reschedule. Starting an already-started visit is
--      a no-op that returns the row, so a double tap is harmless.
--
-- Mirrors APPOINTMENT_STATUSES / APPOINTMENT_STATUS_TRANSITIONS in
-- src/utils/constants.js. Changing one side needs a change on the other.
-- ---------------------------------------------------------------------------

-- 1. When the visit was started.
alter table public.appointments
  add column if not exists started_at timestamptz;

comment on column public.appointments.started_at is
  'When a technician started the visit on site (start_visit). Set once; kept after completion so time on site can be measured.';

-- 2. The status list.
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'In progress', 'Completed', 'Cancelled'));

-- 3. update_appointment, as in 047, with 'In progress' allowed.
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
  p_price numeric,
  p_service_id uuid default null
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
  -- 048: 'In progress' added.
  if p_status not in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'In progress', 'Completed', 'Cancelled') then
    raise exception 'Invalid appointment status.';
  end if;
  if p_price is not null and p_price < 0 then raise exception 'Price cannot be negative.'; end if;
  if p_price is not null and p_price > 999999.99 then
    raise exception 'Price cannot be more than 999,999.99.';
  end if;

  select * into existing_row from public.appointments where id = p_appointment_id;
  if existing_row.id is null then raise exception 'Appointment not found.'; end if;

  if (existing_row.scheduled_at is distinct from p_scheduled_at
      or existing_row.duration_minutes is distinct from p_duration_minutes)
     and existing_row.status <> 'Reschedule' then
    raise exception 'Change the status to Reschedule before moving or resizing the appointment.';
  end if;

  if existing_row.scheduled_at is distinct from p_scheduled_at
     and p_scheduled_at < now() - interval '5 minutes' then
    raise exception 'Appointments cannot be moved into the past.';
  end if;
  if p_service_id is not null and not exists (select 1 from public.services where id = p_service_id) then
    p_service_id := null;
  end if;

  perform public.assert_technicians_available(p_appointment_id, p_technician_ids, p_scheduled_at, p_duration_minutes);

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
      price = p_price,
      service_id = p_service_id
  where id = p_appointment_id
  returning * into updated;
  return updated;
end;
$$;

grant execute on function public.update_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, text, text, numeric, uuid) to anon, authenticated;

-- 4. Start a visit.
drop function if exists public.start_visit(uuid);

create or replace function public.start_visit(p_appointment_id uuid)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare existing_row public.appointments;
declare started public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;

  select * into existing_row from public.appointments where id = p_appointment_id;
  if existing_row.id is null then raise exception 'Appointment not found.'; end if;

  if public.current_account_role() = 'TECHNICIAN' and not public.is_assigned_to_appointment(p_appointment_id) then
    raise exception 'You can only start a visit you are assigned to.';
  end if;

  -- A double tap, or a second crew member arriving: already started.
  if existing_row.status = 'In progress' then
    return existing_row;
  end if;

  if existing_row.status not in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule') then
    raise exception 'A % visit cannot be started.', lower(existing_row.status);
  end if;

  if (existing_row.scheduled_at at time zone 'Asia/Manila')::date <> (now() at time zone 'Asia/Manila')::date then
    raise exception 'A visit can only be started on its scheduled day.';
  end if;

  update public.appointments
  set status = 'In progress',
      started_at = coalesce(started_at, now())
  where id = p_appointment_id
  returning * into started;
  return started;
end;
$$;

grant execute on function public.start_visit(uuid) to anon, authenticated;
