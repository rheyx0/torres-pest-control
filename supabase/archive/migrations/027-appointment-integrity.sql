-- Migration 027 - Appointment status transitions, per-technician overlap, and
-- the service type / service location / cancellation reason fields.
--
-- Run after migrations 001-026. Everything lives in this one file on purpose:
-- migration 024 replaced 022's create_appointment/update_appointment and silently
-- dropped its per-technician overlap check, its account_is_active() guard, and its
-- "must be Reschedule before moving" gate. Splitting these changes across files is
-- what caused that regression.

alter table public.appointments add column if not exists service_type text;
alter table public.appointments add column if not exists service_location text;
alter table public.appointments add column if not exists cancellation_reason text;

-- ---------------------------------------------------------------------------
-- Status transitions
--
-- Enforced by a trigger rather than inside update_appointment so that every
-- write path is covered. submit_appointment_report() sets status = 'Completed'
-- with a bare UPDATE, which previously let a report revive a cancelled
-- appointment.
--
--   Pending / Scheduled / Confirmed / Reschedule -> any status
--   Completed                                    -> final
--   Cancelled                                    -> Reschedule only (reopen)
--
-- A same-status update is always allowed: ordinary edits re-send the current
-- status unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_appointment_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'Completed' then
      raise exception 'A completed appointment cannot change status.';
    end if;
    if old.status = 'Cancelled' and new.status <> 'Reschedule' then
      raise exception 'A cancelled appointment can only be reopened by setting its status to Reschedule.';
    end if;
  end if;

  if new.status <> 'Cancelled' then
    new.cancellation_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_enforce_status_transition on public.appointments;
create trigger appointments_enforce_status_transition
before update on public.appointments
for each row execute function public.enforce_appointment_status_transition();

-- ---------------------------------------------------------------------------
-- create_appointment / update_appointment
--
-- Old signatures are dropped explicitly: PostgREST resolves RPCs by argument
-- name, so leaving the 022/024 overloads in place alongside the new ones makes
-- resolution ambiguous.
-- ---------------------------------------------------------------------------

drop function if exists public.create_appointment(uuid, timestamptz, uuid, text);
drop function if exists public.create_appointment(uuid, timestamptz, integer, uuid, text);
drop function if exists public.create_appointment(uuid, timestamptz, integer, text, uuid, text);
drop function if exists public.update_appointment(uuid, timestamptz, uuid, text, text);
drop function if exists public.update_appointment(uuid, timestamptz, integer, uuid, text, text);
drop function if exists public.update_appointment(uuid, timestamptz, integer, text, uuid, text, text);

create or replace function public.create_appointment(
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_service_type text,
  p_service_location text,
  p_technician_id uuid,
  p_notes text
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
  if p_technician_id is not null and not public.account_is_active(p_technician_id) then
    raise exception 'Technician or Staff account is not active.';
  end if;
  if p_technician_id is not null and exists (
    select 1 from public.appointments other
    where other.technician_id = p_technician_id
      and other.status <> 'Cancelled'
      and other.scheduled_at < p_scheduled_at + make_interval(mins => p_duration_minutes)
      and other.scheduled_at + make_interval(mins => other.duration_minutes) > p_scheduled_at
  ) then raise exception 'That technician is already assigned during this time.'; end if;

  insert into public.appointments (
    client_id, scheduled_at, duration_minutes, pest_concern, service_type,
    service_location, technician_id, notes, created_by
  )
  select p_client_id, p_scheduled_at, p_duration_minutes,
         nullif(trim(p_pest_concern), ''), nullif(trim(p_service_type), ''),
         nullif(trim(p_service_location), ''), p_technician_id,
         nullif(trim(p_notes), ''), r.id
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  limit 1
  returning * into created;
  return created;
end;
$$;

grant execute on function public.create_appointment(uuid, timestamptz, integer, text, text, text, uuid, text) to anon, authenticated;

create or replace function public.update_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_service_type text,
  p_service_location text,
  p_technician_id uuid,
  p_status text,
  p_notes text,
  p_cancellation_reason text
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

  select * into existing_row from public.appointments where id = p_appointment_id;
  if existing_row.id is null then raise exception 'Appointment not found.'; end if;

  if (existing_row.scheduled_at is distinct from p_scheduled_at
      or existing_row.duration_minutes is distinct from p_duration_minutes)
     and existing_row.status <> 'Reschedule' then
    raise exception 'Change the status to Reschedule before moving or resizing the appointment.';
  end if;

  if p_technician_id is not null and not public.account_is_active(p_technician_id) then
    raise exception 'Technician or Staff account is not active.';
  end if;
  if p_technician_id is not null and exists (
    select 1 from public.appointments other
    where other.id <> p_appointment_id
      and other.technician_id = p_technician_id
      and other.status <> 'Cancelled'
      and other.scheduled_at < p_scheduled_at + make_interval(mins => p_duration_minutes)
      and other.scheduled_at + make_interval(mins => other.duration_minutes) > p_scheduled_at
  ) then raise exception 'That technician is already assigned during this time.'; end if;

  update public.appointments
  set scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      pest_concern = nullif(trim(p_pest_concern), ''),
      service_type = nullif(trim(p_service_type), ''),
      service_location = nullif(trim(p_service_location), ''),
      technician_id = p_technician_id,
      status = p_status,
      notes = nullif(trim(p_notes), ''),
      cancellation_reason = case when p_status = 'Cancelled' then nullif(trim(p_cancellation_reason), '') end
  where id = p_appointment_id
  returning * into updated;
  return updated;
end;
$$;

grant execute on function public.update_appointment(uuid, timestamptz, integer, text, text, text, uuid, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
