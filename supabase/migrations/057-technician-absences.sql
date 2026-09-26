-- ---------------------------------------------------------------------------
-- Migration 057 - A technician who is out cannot be booked.
--
-- Run after 056-technician-unavailable.sql.
--
-- "Technician unavailable" (056) moved the absent technician's visits, but
-- recorded nothing else: once the visits were covered, Juan looked free for
-- the days he was off, and the next booking — or the next cover — could put
-- him straight back on.
--
--   technician_absences     who is out, from and to (Asia/Manila dates, both
--                           included), and why.
--
--   assert_technicians_available()   (from 041) now also refuses a technician
--                           who is out on the visit's date. It is the one
--                           check behind every way a crew is set —
--                           create_appointment, update_appointment,
--                           book_appointments, update_plan_future,
--                           add_plan_visit, reassign_visits — so none of them
--                           can book around an absence. A technician already
--                           on a visit at that very time is not refused, so an
--                           existing visit can still be edited in place.
--
--   mark_technician_out()   records the absence and, in the same
--                           transaction, reassigns their visits in those
--                           dates through reassign_visits() (056). It refuses
--                           to leave any of those visits with them. An absence
--                           touching or overlapping one already recorded for
--                           the same technician is merged into it.
--
--   end_absence()           they are back early: the absence ends the day
--                           before, or is removed if they never left.
--
-- Safe to run more than once. 057 is now the source of truth for
-- assert_technicians_available; re-running 041 restores the version that
-- ignores absences — re-run 057 after it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Absences.
-- ---------------------------------------------------------------------------

create table if not exists public.technician_absences (
  id            uuid        primary key default gen_random_uuid(),
  -- Plain uuid, like appointments.technician_id: accounts live in three role
  -- tables (migration 011), so there is no single table to point at.
  technician_id uuid        not null,
  starts_on     date        not null,
  ends_on       date        not null,
  reason        text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint technician_absences_dates_check check (ends_on >= starts_on)
);

create index if not exists technician_absences_lookup_idx
  on public.technician_absences (technician_id, starts_on, ends_on);

comment on table public.technician_absences is
  'A technician out of work from starts_on to ends_on (Asia/Manila dates, both included). Nobody can book them in that time.';

alter table public.technician_absences enable row level security;

drop policy if exists "Technician absence read" on public.technician_absences;
create policy "Technician absence read" on public.technician_absences
for select using (public.has_role_table_session());

grant select on public.technician_absences to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The booking check, from 041, with absences.
-- ---------------------------------------------------------------------------

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
  away public.technician_absences;
  first_day date;
  last_day date;
begin
  if p_technician_ids is null then return; end if;

  -- The visit's days as the business counts them. The end is taken a minute
  -- early so a visit ending at midnight does not reach into the next day.
  first_day := (p_scheduled_at at time zone 'Asia/Manila')::date;
  last_day := ((p_scheduled_at + make_interval(mins => greatest(coalesce(p_duration_minutes, 60), 1) - 1)) at time zone 'Asia/Manila')::date;

  foreach candidate in array p_technician_ids loop
    if candidate is null then continue; end if;

    if not public.account_is_active(candidate) then
      raise exception 'Technician or Staff account is not active.';
    end if;

    -- 057: out that day. Someone already on this very visit at this very time
    -- is not refused, so the visit can still be edited in place.
    select * into away from public.technician_absences ab
    where ab.technician_id = candidate
      and ab.starts_on <= last_day
      and ab.ends_on >= first_day
    order by ab.starts_on
    limit 1;

    if away.id is not null and not (
      p_appointment_id is not null and exists (
        select 1 from public.appointments ap
        where ap.id = p_appointment_id
          and ap.scheduled_at = p_scheduled_at
          and (ap.technician_id = candidate or exists (
            select 1 from public.appointment_technicians at
            where at.appointment_id = ap.id and at.technician_id = candidate))
      )
    ) then
      -- "Juan is out (Sick) until Oct 02."
      raise exception '% is out% until %.',
        coalesce((select t.name from public.technicians t where t.id = candidate), 'That technician'),
        coalesce(' (' || nullif(trim(coalesce(away.reason, '')), '') || ')', ''),
        to_char(away.ends_on, 'Mon DD');
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

-- ---------------------------------------------------------------------------
-- 3. Marking someone out, and back.
-- ---------------------------------------------------------------------------

drop function if exists public.mark_technician_out(uuid, date, date, text, jsonb);

create function public.mark_technician_out(
  p_technician_id uuid,
  p_starts_on     date,
  p_ends_on       date,
  p_reason        text default null,
  p_changes       jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  merged_start date := p_starts_on;
  merged_end date := p_ends_on;
  created uuid;
  left_with integer;
  technician_name text;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can mark a technician out.';
  end if;
  if p_starts_on is null or p_ends_on is null then raise exception 'Choose the days they are out.'; end if;
  if p_ends_on < p_starts_on then raise exception 'The last day out is before the first.'; end if;
  if p_ends_on < today then raise exception 'Those days have already passed.'; end if;

  select t.name into technician_name from public.technicians t where t.id = p_technician_id;
  if technician_name is null then raise exception 'That technician was not found.'; end if;

  -- Their visits in those days first, so the absence does not refuse the
  -- very changes that clear them.
  if p_changes is not null and jsonb_typeof(p_changes) = 'array' and jsonb_array_length(p_changes) > 0 then
    perform public.reassign_visits(p_technician_id, p_changes, p_reason);
  end if;

  select count(*) into left_with
  from public.appointments a
  where a.status in ('Pending', 'Confirmed', 'Reschedule')
    and (a.scheduled_at at time zone 'Asia/Manila')::date between p_starts_on and p_ends_on
    and (a.technician_id = p_technician_id or exists (
      select 1 from public.appointment_technicians at
      where at.appointment_id = a.id and at.technician_id = p_technician_id));
  if left_with > 0 then
    raise exception '% still has % visit% in those days. Choose who covers each one.',
      technician_name, left_with, case when left_with = 1 then '' else 's' end;
  end if;

  -- One absence per stretch: fold in any that overlap or touch this one.
  select least(p_starts_on, coalesce(min(ab.starts_on), p_starts_on)),
         greatest(p_ends_on, coalesce(max(ab.ends_on), p_ends_on))
    into merged_start, merged_end
  from public.technician_absences ab
  where ab.technician_id = p_technician_id
    and ab.starts_on <= p_ends_on + 1
    and ab.ends_on >= p_starts_on - 1;

  delete from public.technician_absences ab
  where ab.technician_id = p_technician_id
    and ab.starts_on <= p_ends_on + 1
    and ab.ends_on >= p_starts_on - 1;

  insert into public.technician_absences (technician_id, starts_on, ends_on, reason, created_by)
  values (p_technician_id, merged_start, merged_end, nullif(trim(coalesce(p_reason, '')), ''), public.current_account_id())
  returning id into created;

  return created;
end;
$$;

grant execute on function public.mark_technician_out(uuid, date, date, text, jsonb) to anon, authenticated;

-- Back to work on p_back_on: the absence ends the day before, or goes away
-- entirely if they are back by its first day.
drop function if exists public.end_absence(uuid, date);

create function public.end_absence(p_absence_id uuid, p_back_on date)
returns void
language plpgsql security definer set search_path = public
as $$
declare target public.technician_absences;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can change an absence.';
  end if;
  select * into target from public.technician_absences ab where ab.id = p_absence_id for update;
  if target.id is null then raise exception 'That absence was not found.'; end if;
  if p_back_on is null then raise exception 'Choose the day they are back.'; end if;

  if p_back_on <= target.starts_on then
    delete from public.technician_absences ab where ab.id = target.id;
  elsif p_back_on <= target.ends_on then
    update public.technician_absences ab set ends_on = p_back_on - 1 where ab.id = target.id;
  end if;
end;
$$;

grant execute on function public.end_absence(uuid, date) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select t.name, ab.starts_on, ab.ends_on, ab.reason
--   from public.technician_absences ab
--   left join public.technicians t on t.id = ab.technician_id
--   order by ab.starts_on;
-- ---------------------------------------------------------------------------
