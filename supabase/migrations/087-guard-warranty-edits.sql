-- ---------------------------------------------------------------------------
-- Migration 087 - a warranty edit cannot strand the free visits booked under it.
--
-- Run after 086-checkup-periods.sql.
--
-- set_quote_warranty / set_contract_warranty (078) saved any length and any
-- checkup frequency. Shortening a running warranty (12 months to 3, a year
-- in) ended it at once and left its booked ₱0 checkups and re-treatments
-- standing after the end: free visits no warranty covers any more, which
-- 082's guard then refused to move. Removing the warranty, or switching
-- Monthly to Quarterly, left booked checkups outside every period (086).
--
-- The BEFORE UPDATE trigger guard_warranty_edit() on quotes and contracts now
-- refuses, whatever path the change takes (the two functions, the quotation
-- and contract forms, the Warranty page, a hand-run UPDATE):
--   - removing the warranty while visits are still booked under it;
--   - a length whose new end falls before a visit still booked under it
--     (the message names each visit and its date);
--   - changing or removing the checkup frequency while checkups are booked.
-- "Booked" = a warranty visit (082's link) neither Completed nor Cancelled;
-- cancelling those visits first, or keeping a longer warranty, lets the edit
-- through. Lengthening a warranty, and any edit with nothing booked, pass.
-- An edit that ends the warranty today or earlier is allowed: the app asks
-- for confirmation and a reason, and writes it to the activity log.
--
-- warranty_start() is 083's start of the window without the length (a
-- quotation's first completed visit, a contract's activation), so the new end
-- can be worked out before the length is saved. Nothing else is recreated.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create or replace function public.warranty_start(p_source_type text, p_source_id uuid)
returns date
language plpgsql stable security definer set search_path = public
as $$
declare v_start date;
begin
  if upper(p_source_type) = 'CONTRACT' then
    select (c.activated_at at time zone 'Asia/Manila')::date into v_start
    from public.contracts c where c.id = p_source_id and c.status in ('ACTIVE', 'ENDED');
  else
    if not exists (select 1 from public.quotes q where q.id = p_source_id and q.status = 'APPROVED') then return null; end if;
    select min((coalesce(r.signed_at, r.submitted_at, a.scheduled_at) at time zone 'Asia/Manila')::date) into v_start
    from public.appointments a
    left join public.appointment_reports r on r.appointment_id = a.id
    where a.quote_id = p_source_id and a.status = 'Completed' and a.warranty_kind is null;
  end if;
  return v_start;
end;
$$;
grant execute on function public.warranty_start(text, uuid) to anon, authenticated;

create or replace function public.guard_warranty_edit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_type text := case when tg_table_name = 'contracts' then 'CONTRACT' else 'QUOTE' end;
  v_start date;
  v_end date;
  v_list text;
begin
  if new.warranty_months is not distinct from old.warranty_months
     and new.checkup_frequency is not distinct from old.checkup_frequency then
    return new;
  end if;

  -- Removing the warranty: nothing may still be booked under it.
  if new.warranty_months is null then
    select string_agg(a.reference || ' (' || to_char((a.scheduled_at at time zone 'Asia/Manila')::date, 'Mon DD, YYYY') || ')', ', ' order by a.scheduled_at)
      into v_list
    from public.appointments a
    where (case when v_type = 'CONTRACT' then a.warranty_contract_id else a.warranty_quote_id end) = new.id
      and a.warranty_kind is not null and a.status not in ('Completed', 'Cancelled');
    if v_list is not null then
      raise exception 'The warranty cannot be removed while visits are booked under it: %. Cancel them first.', v_list;
    end if;
    return new;
  end if;

  -- A new length: no booked visit may fall after the new end.
  v_start := public.warranty_start(v_type, new.id);
  if v_start is not null then
    v_end := (v_start + make_interval(months => new.warranty_months))::date;
    select string_agg(a.reference || ' (' || to_char((a.scheduled_at at time zone 'Asia/Manila')::date, 'Mon DD, YYYY') || ')', ', ' order by a.scheduled_at)
      into v_list
    from public.appointments a
    where (case when v_type = 'CONTRACT' then a.warranty_contract_id else a.warranty_quote_id end) = new.id
      and a.warranty_kind is not null and a.status not in ('Completed', 'Cancelled')
      and (a.scheduled_at at time zone 'Asia/Manila')::date > v_end;
    if v_list is not null then
      raise exception 'The warranty would end on %, but these visits are booked after that: %. Cancel them first, or keep a longer warranty.',
        to_char(v_end, 'Mon DD, YYYY'), v_list;
    end if;
  end if;

  -- A new checkup frequency: the booked checkups were placed by the old one (086).
  if new.checkup_frequency is distinct from old.checkup_frequency then
    select string_agg(a.reference || ' (' || to_char((a.scheduled_at at time zone 'Asia/Manila')::date, 'Mon DD, YYYY') || ')', ', ' order by a.scheduled_at)
      into v_list
    from public.appointments a
    where (case when v_type = 'CONTRACT' then a.warranty_contract_id else a.warranty_quote_id end) = new.id
      and a.warranty_kind = 'CHECKUP' and a.status not in ('Completed', 'Cancelled');
    if v_list is not null then
      raise exception 'The checkups cannot change while these checkups are booked on the current schedule: %. Cancel them first.', v_list;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists quotes_guard_warranty_edit on public.quotes;
create trigger quotes_guard_warranty_edit
  before update of warranty_months, checkup_frequency on public.quotes
  for each row execute function public.guard_warranty_edit();

drop trigger if exists contracts_guard_warranty_edit on public.contracts;
create trigger contracts_guard_warranty_edit
  before update of warranty_months, checkup_frequency on public.contracts
  for each row execute function public.guard_warranty_edit();

notify pgrst, 'reload schema';
