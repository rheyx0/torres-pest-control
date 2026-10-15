-- ---------------------------------------------------------------------------
-- Migration 081 - a completed visit frees its crew.
--
-- Run after 080-follow-up-order-and-non-chemical.sql.
--
-- assert_technicians_available (057) counted every visit that was not
-- Cancelled, so a job finished early still blocked its crew until the end of
-- its booked time. A Completed visit is done: it no longer holds anyone's
-- time. Its past time could not be booked anyway (047 refuses the past).
-- The app does the same (holdsCrewTime() in src/utils/scheduling.js).
--
-- This is now the source of truth for assert_technicians_available (from
-- 057; re-running 057 or 041 brings back the version that counts completed
-- visits, so re-run 081 after either). Only that one condition changes.
-- Safe to run more than once.
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
      and other.status not in ('Cancelled', 'Completed')
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

notify pgrst, 'reload schema';
