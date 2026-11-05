-- Migration 022 - Store appointment duration and prevent overlapping technician bookings.

alter table public.appointments
  add column if not exists duration_minutes integer not null default 60;

alter table public.appointments
  add column if not exists pest_concern text;

alter table public.appointments
  drop constraint if exists appointments_duration_minutes_check;

alter table public.appointments
  add constraint appointments_duration_minutes_check
  check (duration_minutes between 1 and 1440);

drop function if exists public.create_appointment(uuid, timestamptz, uuid, text);
drop function if exists public.create_appointment(uuid, timestamptz, integer, uuid, text);
drop function if exists public.update_appointment(uuid, timestamptz, uuid, text, text);
drop function if exists public.update_appointment(uuid, timestamptz, integer, uuid, text, text);

create or replace function public.create_appointment(
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
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
  if not exists (select 1 from public.clients where id = p_client_id and status = 'ACTIVE') then raise exception 'Active client not found.'; end if;
  if p_technician_id is not null and not public.account_is_active(p_technician_id) then raise exception 'Technician or Staff account is not active.'; end if;
  if p_technician_id is not null and exists (
    select 1 from public.appointments
    where technician_id = p_technician_id and status <> 'Cancelled'
      and scheduled_at < p_scheduled_at + make_interval(mins => p_duration_minutes)
      and scheduled_at + make_interval(mins => duration_minutes) > p_scheduled_at
  ) then raise exception 'That technician is already assigned during this time.'; end if;

  insert into public.appointments (client_id, scheduled_at, duration_minutes, pest_concern, technician_id, notes, created_by)
  select p_client_id, p_scheduled_at, p_duration_minutes, nullif(trim(p_pest_concern), ''), p_technician_id, nullif(trim(p_notes), ''), r.id
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  limit 1
  returning * into created;
  return created;
end;
$$;

grant execute on function public.create_appointment(uuid, timestamptz, integer, text, uuid, text) to anon, authenticated;

create or replace function public.update_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_technician_id uuid,
  p_status text,
  p_notes text
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare updated public.appointments;
declare current_status text;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Duration must be between 1 minute and 24 hours.';
  end if;
  if p_status not in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'Completed', 'Cancelled') then raise exception 'Invalid appointment status.'; end if;
  select status into current_status from public.appointments where id = p_appointment_id;
  if current_status is null then raise exception 'Appointment not found.'; end if;
  if exists (select 1 from public.appointments where id = p_appointment_id and (scheduled_at is distinct from p_scheduled_at or duration_minutes is distinct from p_duration_minutes))
     and current_status <> 'Reschedule' then
    raise exception 'Change the status to Reschedule before moving or resizing the appointment.';
  end if;
  if p_technician_id is not null and not public.account_is_active(p_technician_id) then raise exception 'Technician or Staff account is not active.'; end if;
  if p_technician_id is not null and exists (
    select 1 from public.appointments
    where id <> p_appointment_id and technician_id = p_technician_id and status <> 'Cancelled'
      and scheduled_at < p_scheduled_at + make_interval(mins => p_duration_minutes)
      and scheduled_at + make_interval(mins => duration_minutes) > p_scheduled_at
  ) then raise exception 'That technician is already assigned during this time.'; end if;

  update public.appointments set scheduled_at = p_scheduled_at, duration_minutes = p_duration_minutes,
    pest_concern = nullif(trim(p_pest_concern), ''),
    technician_id = p_technician_id, status = p_status, notes = nullif(trim(p_notes), '')
  where id = p_appointment_id returning * into updated;
  if updated.id is null then raise exception 'Appointment not found.'; end if;
  return updated;
end;
$$;

grant execute on function public.update_appointment(uuid, timestamptz, integer, text, uuid, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
