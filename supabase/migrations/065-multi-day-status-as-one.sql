-- ---------------------------------------------------------------------------
-- Migration 065 - A multi-day job's days change status together.
--
-- Run after 052-appointment-plans.sql (any time after 064).
--
-- A multi-day job (052) is one job split across days. Signing its report
-- already completes every day, but a status set by hand on one day (the
-- appointment Overview's status, through update_appointment) changed only
-- that day: Day 1 marked Completed left Day 2 open, and cancelling one day
-- left the rest booked.
--
-- A trigger now carries a day's new status to the job's other days:
--
--   Completed    every day not cancelled (closing each, day_done_at)
--   Cancelled    the days AFTER it that are still open, with the same reason:
--                cancelling Day 1 cancels the job, cancelling Day 2 ends the
--                job there. Forward only, so finish_job_here and
--                cancel_plan_remaining (which cancel the later days) keep
--                the day they finish on; a day on site is never cancelled
--   any other    every day still open (not completed, not on site now); a
--                day cancelled on its own stays cancelled, unless the job
--                itself is coming back from Cancelled
--   In progress  is not carried: a technician starts one day on site
--
-- It runs once per change (pg_trigger_depth), so the days it updates do not
-- set it off again. Plan-wide changes the office already makes as one
-- (update_plan_future, cancel_plan_remaining, finish_job_here) are unaffected.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create or replace function public.sync_multi_day_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare plan_kind text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.plan_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'In progress' then return new; end if;

  select p.kind into plan_kind from public.appointment_plans p where p.id = new.plan_id;
  if plan_kind is distinct from 'MULTI_DAY' then return new; end if;

  if new.status = 'Completed' then
    update public.appointments a
      set status = 'Completed', day_done_at = coalesce(a.day_done_at, now())
      where a.plan_id = new.plan_id and a.id <> new.id
        and a.status not in ('Completed', 'Cancelled');
  elsif new.status = 'Cancelled' then
    update public.appointments a
      set status = 'Cancelled', cancellation_reason = coalesce(new.cancellation_reason, a.cancellation_reason)
      where a.plan_id = new.plan_id and a.id <> new.id
        and a.scheduled_at > new.scheduled_at
        and a.status not in ('Completed', 'Cancelled', 'In progress');
  else
    update public.appointments a
      set status = new.status
      where a.plan_id = new.plan_id and a.id <> new.id
        and a.status is distinct from new.status
        and a.status not in ('Completed', 'In progress')
        and (a.status <> 'Cancelled' or old.status = 'Cancelled');
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_sync_multi_day_status on public.appointments;
create trigger appointments_sync_multi_day_status
after update of status on public.appointments
for each row execute function public.sync_multi_day_status();

notify pgrst, 'reload schema';
