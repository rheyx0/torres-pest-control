-- ---------------------------------------------------------------------------
-- Migration 083 - a quotation's warranty starts on the day the job was done.
--
-- Run after 082-protect-warranty-visits.sql.
--
-- 078's warranty_window() started a quotation's warranty on its first
-- completed visit's signature date, or, with no signature, on the visit's
-- SCHEDULED date. A visit booked for a later day but finished (and reported)
-- early, without the client signing, then had a warranty that "started" in
-- the future: no warranty strip, no free re-treatment, a charged follow-up.
--
-- Now the start is the day the client signed, else the day the report was
-- submitted, else the scheduled day. The app's quoteCompletedOn() (in
-- src/utils/warranty.js) uses the same order. A contract's warranty is
-- unchanged: it runs from the day the contract became Active.
--
-- This is now the source of truth for warranty_window (from 078); re-running
-- 078 restores the scheduled-day version, so re-run 083 after it.
-- Same signature, so book_warranty_visits, book_follow_up_from_report and
-- 082's guard pick it up without being recreated. Safe to run more than once.
-- ---------------------------------------------------------------------------

create or replace function public.warranty_window(p_source_type text, p_source_id uuid)
returns table (starts_on date, ends_on date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_months integer;
  v_start date;
begin
  if upper(p_source_type) = 'CONTRACT' then
    select c.warranty_months, (c.activated_at at time zone 'Asia/Manila')::date into v_months, v_start
    from public.contracts c where c.id = p_source_id and c.status in ('ACTIVE', 'ENDED');
  else
    select q.warranty_months into v_months from public.quotes q where q.id = p_source_id and q.status = 'APPROVED';
    select min((coalesce(r.signed_at, r.submitted_at, a.scheduled_at) at time zone 'Asia/Manila')::date) into v_start
    from public.appointments a
    left join public.appointment_reports r on r.appointment_id = a.id
    where a.quote_id = p_source_id and a.status = 'Completed' and a.warranty_kind is null;
  end if;
  if v_months is null or v_start is null then return; end if;
  return query select v_start, (v_start + make_interval(months => v_months))::date;
end;
$$;

grant execute on function public.warranty_window(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
