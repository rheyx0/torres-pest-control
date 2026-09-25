-- ---------------------------------------------------------------------------
-- Migration 053 - "Don't renew" for a recurring plan.
--
-- Run after 052-appointment-plans.sql.
--
-- A recurring plan with two visits or fewer left reminds the office to renew
-- it (plansEnding() in src/utils/plans.js). That reminder only went quiet once
-- something was booked after the plan, or the plan was cancelled — so a
-- contract that simply ran its course, and that the client chose not to
-- continue, was flagged "Renew" forever.
--
-- appointment_plans.renewal_declined_at records the office's decision. While
-- it is set the plan never reminds; clearing it brings the reminder back. The
-- visits themselves are untouched: the ones still booked go ahead as planned.
--
-- set_plan_renewal(plan, renew) is the only write, office-only like every
-- other plan change (assert_office, 052), and refused for a multi-day job,
-- which is one job and has nothing to renew.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.appointment_plans add column if not exists renewal_declined_at timestamptz;
alter table public.appointment_plans add column if not exists renewal_declined_by uuid;

comment on column public.appointment_plans.renewal_declined_at is
  'Set when the office decided not to renew this recurring plan; it no longer shows a renewal reminder. Null = remind as usual.';

drop function if exists public.set_plan_renewal(uuid, boolean);

create function public.set_plan_renewal(p_plan_id uuid, p_renew boolean)
returns public.appointment_plans
language plpgsql security definer set search_path = public
as $$
declare plan_row public.appointment_plans;
begin
  perform public.assert_office();

  select * into plan_row from public.appointment_plans where id = p_plan_id;
  if plan_row.id is null then raise exception 'Plan not found.'; end if;
  if plan_row.kind <> 'RECURRING' then
    raise exception 'Only a recurring plan can be renewed.';
  end if;

  update public.appointment_plans
    set renewal_declined_at = case when p_renew then null else now() end,
        renewal_declined_by = case when p_renew then null else public.current_account_id() end
    where id = p_plan_id
    returning * into plan_row;

  return plan_row;
end;
$$;

grant execute on function public.set_plan_renewal(uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select id, frequency, renewal_declined_at from public.appointment_plans
--   where kind = 'RECURRING' order by created_at;
-- ---------------------------------------------------------------------------
