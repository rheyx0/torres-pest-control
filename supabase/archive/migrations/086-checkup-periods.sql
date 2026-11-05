-- ---------------------------------------------------------------------------
-- Migration 086 - a warranty's checkups follow its Monthly / Quarterly rule.
--
-- Run after 085-repair-activity-log.sql.
--
-- Until now the checkup frequency only suggested dates: any number of
-- checkups could be booked on any days inside the warranty. Now:
--
--   - The warranty is split into checkup periods from the day it started:
--     1 month each (MONTHLY) or 3 months (QUARTERLY), as many as fit whole
--     (1 year Quarterly = 4, 1 year Monthly = 12; 7 months Quarterly = 2).
--     A period runs from the day after one step to the next step day, both
--     included: from Oct 15, Quarterly gives Oct 16 - Jan 15, Jan 16 -
--     Apr 15, Apr 16 - Jul 15 and Jul 16 - Oct 15.
--   - A checkup must fall inside a period, and each period takes one live
--     (not Cancelled) checkup. A cancelled checkup frees its period.
--   - A checkup moved to another date stays inside its own period.
--   - A warranty with no checkup frequency takes no checkups.
-- Re-treatments are not limited. utils/warranty.js (checkupPeriods,
-- checkupProblem) says the same in the app.
--
-- The rule is a trigger on appointments, so it holds for book_warranty_visits
-- (each new checkup is checked as it is marked, so two in one booking are
-- refused too), for date moves in the Overview, and for hand-run SQL.
-- Checkups booked before 086 are left as they are; only a change is checked.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

drop function if exists public.warranty_checkup_period(text, uuid, date);

-- The checkup period `p_day` falls in: index from 0 and its first and last
-- day; no row when the day is outside every period or the warranty has none.
create function public.warranty_checkup_period(p_source_type text, p_source_id uuid, p_day date)
returns table (period_index integer, starts_on date, ends_on date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_months integer;
  v_frequency text;
  v_step integer;
  v_start date;
  i integer;
  v_open date;
  v_close date;
begin
  if upper(p_source_type) = 'CONTRACT' then
    select c.warranty_months, c.checkup_frequency into v_months, v_frequency from public.contracts c where c.id = p_source_id;
  else
    select q.warranty_months, q.checkup_frequency into v_months, v_frequency from public.quotes q where q.id = p_source_id;
  end if;
  v_step := case upper(coalesce(v_frequency, '')) when 'MONTHLY' then 1 when 'QUARTERLY' then 3 end;
  if v_step is null or v_months is null or p_day is null then return; end if;
  select w.starts_on into v_start from public.warranty_window(p_source_type, p_source_id) w;
  if v_start is null then return; end if;
  for i in 0 .. (v_months / v_step) - 1 loop
    v_open := (v_start + make_interval(months => i * v_step))::date;
    v_close := (v_start + make_interval(months => (i + 1) * v_step))::date;
    if p_day > v_open and p_day <= v_close then
      return query select i, v_open + 1, v_close;
      return;
    end if;
  end loop;
end;
$$;

grant execute on function public.warranty_checkup_period(text, uuid, date) to anon, authenticated;

create or replace function public.guard_warranty_checkup_period()
returns trigger
language plpgsql security definer set search_path = public
as $guard$
declare
  v_type text;
  v_source uuid;
  v_frequency text;
  v_period record;
  v_old record;
  v_other text;
begin
  if new.warranty_kind is distinct from 'CHECKUP' or new.status = 'Cancelled' then
    return new;
  end if;
  -- Only a change is checked: marking a checkup, moving one, or bringing a
  -- cancelled one back.
  if tg_op = 'UPDATE'
     and old.warranty_kind is not distinct from new.warranty_kind
     and old.scheduled_at is not distinct from new.scheduled_at
     and old.status <> 'Cancelled' then
    return new;
  end if;

  v_type := case when new.warranty_contract_id is not null then 'CONTRACT' else 'QUOTE' end;
  v_source := coalesce(new.warranty_contract_id, new.warranty_quote_id);
  if v_type = 'CONTRACT' then
    select c.checkup_frequency into v_frequency from public.contracts c where c.id = v_source;
  else
    select q.checkup_frequency into v_frequency from public.quotes q where q.id = v_source;
  end if;
  if v_frequency is null then
    raise exception 'This warranty includes no checkups. Book a paid visit, or a warranty re-treatment if pests came back.';
  end if;

  select * into v_period
  from public.warranty_checkup_period(v_type, v_source, (new.scheduled_at at time zone 'Asia/Manila')::date);
  if v_period.period_index is null then
    raise exception 'A checkup must fall inside one of the warranty''s checkup periods; % is outside them.',
      to_char((new.scheduled_at at time zone 'Asia/Manila')::date, 'Mon DD, YYYY');
  end if;

  if tg_op = 'UPDATE' and old.warranty_kind = 'CHECKUP' and old.scheduled_at is distinct from new.scheduled_at then
    select * into v_old
    from public.warranty_checkup_period(v_type, v_source, (old.scheduled_at at time zone 'Asia/Manila')::date);
    if v_old.period_index is not null and v_old.period_index <> v_period.period_index then
      raise exception 'A checkup can move only inside its own period (% - %).',
        to_char(v_old.starts_on, 'Mon DD, YYYY'), to_char(v_old.ends_on, 'Mon DD, YYYY');
    end if;
  end if;

  select a.reference into v_other
  from public.appointments a
  cross join lateral public.warranty_checkup_period(v_type, v_source, (a.scheduled_at at time zone 'Asia/Manila')::date) p
  where a.id <> new.id
    and a.warranty_kind = 'CHECKUP'
    and a.status <> 'Cancelled'
    and coalesce(a.warranty_contract_id, a.warranty_quote_id) = v_source
    and p.period_index = v_period.period_index
  limit 1;
  if v_other is not null then
    raise exception 'This warranty already has its checkup for % - % (%). One checkup per period.',
      to_char(v_period.starts_on, 'Mon DD, YYYY'), to_char(v_period.ends_on, 'Mon DD, YYYY'), v_other;
  end if;
  return new;
end;
$guard$;

drop trigger if exists guard_warranty_checkup_period on public.appointments;
create trigger guard_warranty_checkup_period
  before insert or update on public.appointments
  for each row execute function public.guard_warranty_checkup_period();

notify pgrst, 'reload schema';
