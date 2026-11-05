-- ---------------------------------------------------------------------------
-- Migration 073 - book the follow-up when the report sets its date.
--
-- Run after 072-shared-test-logins.sql.
--
-- A report's follow-up date only raised a reminder (066's
-- followUpReminders), so someone had to see it and click Book.
-- book_follow_up_from_report(visit) books it straight away, as a Pending
-- visit, when every booking rule passes:
--
--   * the report has a follow-up date, today or later (Asia/Manila);
--   * the visit was booked under a quotation (068: a follow-up belongs to its
--     job's quotation); a visit booked without one is left to the office;
--   * no live follow-up of this visit exists yet;
--   * the Follow-up Visit service exists;
--   * the visit's crew is free and not out (create_appointment's checks,
--     through 057's assert_technicians_available).
--
-- The new visit: 9:00 AM on the follow-up date, the original crew, the
-- Follow-up Visit service, priced like 068's followUpPriceFor() (each of the
-- original's services' follow-up price, or the Follow-up Visit service's price
-- for one with none), under the original's quotation, follow_up_of set.
--
-- It never raises: it answers what it did, so a report is never lost to a
-- follow-up that could not be booked. status is BOOKED, or one of NO_DATE,
-- PAST, NO_QUOTE, ALREADY, NO_SERVICE, NOT_ALLOWED, REFUSED (message says
-- why, e.g. the technician is busy). The reminder stays for anything not
-- booked.
--
-- Callable by the office or the visit's crew (the technician files the report
-- on the phone, and technicians cannot book through the app). Nothing
-- existing is replaced. Safe to run more than once.
-- ---------------------------------------------------------------------------

drop function if exists public.book_follow_up_from_report(uuid);

create function public.book_follow_up_from_report(p_appointment_id uuid)
returns table (status text, appointment_id uuid, reference text, message text)
language plpgsql security definer set search_path = public
as $book_follow_up$
declare
  v_original public.appointments;
  v_date date;
  v_service public.services;
  v_price numeric;
  v_crew uuid[];
  v_start timestamptz;
  v_created public.appointments;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.has_role_table_session() then
    return query select 'NOT_ALLOWED'::text, null::uuid, null::text, 'Not signed in.'::text; return;
  end if;
  select * into v_original from public.appointments a where a.id = p_appointment_id;
  if v_original.id is null then
    return query select 'NOT_ALLOWED'::text, null::uuid, null::text, 'That visit was not found.'::text; return;
  end if;
  if coalesce(public.current_account_role(), '') not in ('ADMIN', 'STAFF')
     and not public.is_assigned_to_appointment(v_original.id) then
    return query select 'NOT_ALLOWED'::text, null::uuid, null::text, 'Only the office or the visit''s crew can book its follow-up.'::text; return;
  end if;

  select r.follow_up_date into v_date from public.appointment_reports r where r.appointment_id = v_original.id;
  if v_date is null then
    return query select 'NO_DATE'::text, null::uuid, null::text, 'No follow-up date on the report.'::text; return;
  end if;
  if v_date < v_today then
    return query select 'PAST'::text, null::uuid, null::text, 'The follow-up date has passed, so it was not booked.'::text; return;
  end if;
  if v_original.quote_id is null then
    return query select 'NO_QUOTE'::text, null::uuid, null::text,
      'The visit was not booked under a quotation, so the office books its follow-up.'::text; return;
  end if;
  if exists (select 1 from public.appointments f where f.follow_up_of = v_original.id and f.status <> 'Cancelled') then
    return query select 'ALREADY'::text, f.id, f.reference, 'A follow-up of this visit is already booked.'::text
      from public.appointments f where f.follow_up_of = v_original.id and f.status <> 'Cancelled'
      order by f.scheduled_at limit 1;
    return;
  end if;

  select * into v_service from public.services s
  where s.is_active and lower(s.name) ~ 'follow[ -]?up'
  order by s.name limit 1;
  if v_service.id is null then
    return query select 'NO_SERVICE'::text, null::uuid, null::text, 'There is no Follow-up Visit service in the catalog.'::text; return;
  end if;

  -- 068's price: each original service's follow-up price, or the Follow-up
  -- Visit service's own price for one with none.
  select case when count(*) = 0 then v_service.default_price
              else sum(coalesce(s.follow_up_price, v_service.default_price)) end
    into v_price
  from public.appointment_services aps
  left join public.services s on s.id = aps.service_id
  where aps.appointment_id = v_original.id;
  if v_price is null and v_original.service_id is not null then
    select coalesce(s.follow_up_price, v_service.default_price) into v_price from public.services s where s.id = v_original.service_id;
  end if;

  select coalesce(array_agg(t.technician_id order by t.is_lead desc, t.assigned_at), array[]::uuid[]) into v_crew
  from public.appointment_technicians t where t.appointment_id = v_original.id;
  if cardinality(v_crew) = 0 and v_original.technician_id is not null then v_crew := array[v_original.technician_id]; end if;

  v_start := (v_date::timestamp + time '09:00') at time zone 'Asia/Manila';
  if v_start < now() then
    -- Today, after 9 AM: the next whole hour instead.
    v_start := date_trunc('hour', now()) + interval '1 hour';
    if (v_start at time zone 'Asia/Manila')::date <> v_date then
      return query select 'PAST'::text, null::uuid, null::text, 'Too late today to book the follow-up.'::text; return;
    end if;
  end if;

  begin
    v_created := public.create_appointment(
      v_original.client_id, v_start, coalesce(v_service.default_duration_minutes, 60),
      v_original.pest_concern, v_service.name, v_original.service_location, v_crew,
      'Follow-up of ' || coalesce(v_original.reference, 'a visit') || ', booked from its report.',
      'One-time', v_price, v_service.id
    );
  exception when others then
    return query select 'REFUSED'::text, null::uuid, null::text, sqlerrm::text; return;
  end;

  update public.appointments a
    set follow_up_of = v_original.id, quote_id = v_original.quote_id
    where a.id = v_created.id;

  return query select 'BOOKED'::text, v_created.id, v_created.reference,
    ('Follow-up ' || coalesce(v_created.reference, '') || ' booked for ' || to_char(v_start at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM') || ' (Pending).')::text;
end;
$book_follow_up$;

grant execute on function public.book_follow_up_from_report(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
