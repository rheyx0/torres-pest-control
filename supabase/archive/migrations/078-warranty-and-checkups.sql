-- ---------------------------------------------------------------------------
-- Migration 078 - warranty, checkups and warranty re-treatment.
--
-- Run after 077-contract-down-payment.sql.
--
-- A quotation (one-time job) or a contract can carry a warranty, in months,
-- and the checkups that come with it (monthly or quarterly):
--
--   quotes.warranty_months, quotes.checkup_frequency
--   contracts.warranty_months, contracts.checkup_frequency
--   set_quote_warranty / set_contract_warranty   (office)
--
-- When it runs (warranty_window):
--   a contract's from the day it became Active (signed);
--   a quotation's from the day its job was completed (the first completed
--   visit booked under it); before that it has not started.
--
-- Visits that belong to a warranty carry appointments.warranty_kind
-- (CHECKUP or RETREATMENT) and warranty_quote_id / warranty_contract_id.
-- book_warranty_visits(kind, source type, source id, visits, technicians,
-- reason) books them at ₱0 in one transaction, through create_appointment
-- (so every booking check applies), refusing any date outside the warranty
-- and a re-treatment without a reason. Checkups use the Checkup service
-- (added here if missing: ₱0, Non-chemical, booked without payment); a
-- re-treatment uses the job's own services. Neither is ever invoiced (the
-- app leaves them out of invoices).
--
-- Replaced here: book_follow_up_from_report (073). Under a running warranty
-- the follow-up it books is a ₱0 re-treatment; otherwise it is charged as
-- before. Re-running 073 restores the always-charged version; re-run 078
-- after it.
--
-- The app reads the new columns as optional, so it loads without 078.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.quotes add column if not exists warranty_months integer;
alter table public.quotes add column if not exists checkup_frequency text;
alter table public.contracts add column if not exists warranty_months integer;
alter table public.contracts add column if not exists checkup_frequency text;

alter table public.quotes drop constraint if exists quotes_warranty_check;
alter table public.quotes add constraint quotes_warranty_check check (
  (warranty_months is null or warranty_months between 1 and 120)
  and (checkup_frequency is null or checkup_frequency in ('MONTHLY', 'QUARTERLY'))
);
alter table public.contracts drop constraint if exists contracts_warranty_check;
alter table public.contracts add constraint contracts_warranty_check check (
  (warranty_months is null or warranty_months between 1 and 120)
  and (checkup_frequency is null or checkup_frequency in ('MONTHLY', 'QUARTERLY'))
);

alter table public.appointments add column if not exists warranty_kind text;
alter table public.appointments add column if not exists warranty_quote_id uuid references public.quotes(id) on delete set null;
alter table public.appointments add column if not exists warranty_contract_id uuid references public.contracts(id) on delete set null;
alter table public.appointments drop constraint if exists appointments_warranty_kind_check;
alter table public.appointments add constraint appointments_warranty_kind_check check (warranty_kind is null or warranty_kind in ('CHECKUP', 'RETREATMENT'));
create index if not exists appointments_warranty_quote_idx on public.appointments (warranty_quote_id) where warranty_quote_id is not null;
create index if not exists appointments_warranty_contract_idx on public.appointments (warranty_contract_id) where warranty_contract_id is not null;

-- The Checkup service, if the catalog has none.
do $checkup$
begin
  if not exists (select 1 from public.services where lower(name) ~ 'check[ -]?up') then
    insert into public.services (name, description, default_price, default_duration_minutes, is_active)
    values ('Checkup', 'Regular checkup under a warranty or contract. Free of charge.', 0, 60, true);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'category') then
    execute 'update public.services set category = ''NON_CHEMICAL'' where lower(name) ~ ''check[ -]?up''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'skip_payment_check') then
    execute 'update public.services set skip_payment_check = true where lower(name) ~ ''check[ -]?up''';
  end if;
end;
$checkup$;

-- ---- setting the warranty ----------------------------------------------------

drop function if exists public.set_quote_warranty(uuid, integer, text);
create function public.set_quote_warranty(p_quote_id uuid, p_months integer, p_checkups text)
returns public.quotes
language plpgsql security definer set search_path = public
as $$
declare target public.quotes;
begin
  perform public.assert_billing_office();
  if p_months is not null and (p_months < 1 or p_months > 120) then raise exception 'A warranty is between 1 and 120 months.'; end if;
  if p_checkups is not null and p_checkups not in ('MONTHLY', 'QUARTERLY') then raise exception 'Checkups are monthly or quarterly.'; end if;
  update public.quotes q set warranty_months = p_months, checkup_frequency = case when p_months is null then null else p_checkups end
  where q.id = p_quote_id returning * into target;
  if target.id is null then raise exception 'That quote was not found.'; end if;
  return target;
end;
$$;
grant execute on function public.set_quote_warranty(uuid, integer, text) to anon, authenticated;

drop function if exists public.set_contract_warranty(uuid, integer, text);
create function public.set_contract_warranty(p_contract_id uuid, p_months integer, p_checkups text)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare target public.contracts;
begin
  perform public.assert_billing_office();
  if p_months is not null and (p_months < 1 or p_months > 120) then raise exception 'A warranty is between 1 and 120 months.'; end if;
  if p_checkups is not null and p_checkups not in ('MONTHLY', 'QUARTERLY') then raise exception 'Checkups are monthly or quarterly.'; end if;
  update public.contracts c set warranty_months = p_months, checkup_frequency = case when p_months is null then null else p_checkups end, updated_at = now()
  where c.id = p_contract_id returning * into target;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  return target;
end;
$$;
grant execute on function public.set_contract_warranty(uuid, integer, text) to anon, authenticated;

-- ---- when a warranty runs ------------------------------------------------------

drop function if exists public.warranty_window(text, uuid);
create function public.warranty_window(p_source_type text, p_source_id uuid)
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
    select min(coalesce((r.signed_at at time zone 'Asia/Manila')::date, (a.scheduled_at at time zone 'Asia/Manila')::date)) into v_start
    from public.appointments a
    left join public.appointment_reports r on r.appointment_id = a.id
    where a.quote_id = p_source_id and a.status = 'Completed' and a.warranty_kind is null;
  end if;
  if v_months is null or v_start is null then return; end if;
  return query select v_start, (v_start + make_interval(months => v_months))::date;
end;
$$;
grant execute on function public.warranty_window(text, uuid) to anon, authenticated;

-- ---- booking checkups and re-treatments -----------------------------------------

drop function if exists public.book_warranty_visits(text, text, uuid, jsonb, uuid[], text);
create function public.book_warranty_visits(
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_visits jsonb,
  p_technician_ids uuid[],
  p_reason text default null
)
returns setof public.appointments
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text := upper(coalesce(p_kind, ''));
  v_type text := upper(coalesce(p_source_type, ''));
  v_starts date;
  v_ends date;
  v_client uuid;
  v_reference text;
  v_location text;
  v_service public.services;
  v_service_ids uuid[];
  v_service_name text;
  entry record;
  v_day date;
  created public.appointments;
begin
  perform public.assert_billing_office();
  if v_kind not in ('CHECKUP', 'RETREATMENT') then raise exception 'Book a checkup or a warranty re-treatment.'; end if;
  if v_type not in ('QUOTE', 'CONTRACT') then raise exception 'A warranty belongs to a quotation or a contract.'; end if;
  if v_kind = 'RETREATMENT' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Write what came back, for the re-treatment.';
  end if;
  if p_visits is null or jsonb_typeof(p_visits) <> 'array' or jsonb_array_length(p_visits) = 0 then
    raise exception 'Choose at least one date.';
  end if;
  if jsonb_array_length(p_visits) > 60 then raise exception 'Book at most 60 visits at a time.'; end if;

  select w.starts_on, w.ends_on into v_starts, v_ends from public.warranty_window(v_type, p_source_id) w;
  if v_starts is null then
    raise exception 'That warranty has not started: a contract''s starts when it is signed, a quotation''s when its job is completed.';
  end if;

  if v_type = 'CONTRACT' then
    select c.client_id, c.reference into v_client, v_reference from public.contracts c where c.id = p_source_id;
    select coalesce(array_agg(s), '{}') into v_service_ids from public.contracts c, unnest(c.service_ids) s where c.id = p_source_id;
  else
    select q.client_id, q.reference into v_client, v_reference from public.quotes q where q.id = p_source_id;
    select coalesce(array_agg(distinct l.service_id), '{}') into v_service_ids
    from public.quote_lines l where l.quote_id = p_source_id and l.service_id is not null;
  end if;
  select cl.address into v_location from public.clients cl where cl.id = v_client;

  if v_kind = 'CHECKUP' then
    select * into v_service from public.services s where s.is_active and lower(s.name) ~ 'check[ -]?up' order by s.name limit 1;
    if v_service.id is null then raise exception 'There is no Checkup service in the catalog.'; end if;
    v_service_name := v_service.name;
  else
    select string_agg(s.name, ', ' order by s.name) into v_service_name from public.services s where s.id = any(v_service_ids);
    select * into v_service from public.services s where s.id = v_service_ids[1];
  end if;

  for entry in
    select (e->>'scheduled_at')::timestamptz as scheduled_at, coalesce((e->>'duration_minutes')::integer, 60) as minutes
    from jsonb_array_elements(p_visits) e
    order by 1
  loop
    v_day := (entry.scheduled_at at time zone 'Asia/Manila')::date;
    if v_day < v_starts or v_day > v_ends then
      raise exception 'The warranty runs % to %; % is outside it.', to_char(v_starts, 'Mon DD, YYYY'), to_char(v_ends, 'Mon DD, YYYY'), to_char(v_day, 'Mon DD, YYYY');
    end if;
    created := public.create_appointment(
      v_client, entry.scheduled_at, entry.minutes, null,
      coalesce(v_service_name, case when v_kind = 'CHECKUP' then 'Checkup' else 'Warranty re-treatment' end),
      v_location, p_technician_ids,
      case when v_kind = 'CHECKUP'
        then 'Checkup under ' || coalesce(v_reference, 'the warranty') || ' (warranty until ' || to_char(v_ends, 'Mon DD, YYYY') || '). No charge.'
        else 'Warranty re-treatment under ' || coalesce(v_reference, 'the warranty') || ': ' || trim(p_reason) || ' No charge.' end,
      'One-time', 0, v_service.id
    );
    update public.appointments a
      set warranty_kind = v_kind,
          warranty_quote_id = case when v_type = 'QUOTE' then p_source_id end,
          warranty_contract_id = case when v_type = 'CONTRACT' then p_source_id end
      where a.id = created.id;
    -- A re-treatment carries the job's services (051).
    if v_kind = 'RETREATMENT' and cardinality(v_service_ids) > 1
       and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'appointment_services') then
      delete from public.appointment_services aps where aps.appointment_id = created.id;
      insert into public.appointment_services (appointment_id, position, service_id, service_name)
      select created.id, ord - 1, s.id, s.name
      from unnest(v_service_ids) with ordinality as ids(id, ord) join public.services s on s.id = ids.id;
    end if;
    return query select * from public.appointments a where a.id = created.id;
  end loop;
end;
$$;
grant execute on function public.book_warranty_visits(text, text, uuid, jsonb, uuid[], text) to anon, authenticated;

-- ---- the automatic follow-up (073) respects the warranty -------------------------

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
  v_contract uuid;
  v_until date;
  v_source_type text;
  v_source_id uuid;
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

  -- Under a running warranty the follow-up is a free re-treatment.
  if v_original.plan_id is not null then
    select c.id into v_contract from public.contracts c where c.plan_id = v_original.plan_id limit 1;
  end if;
  v_contract := coalesce(v_original.warranty_contract_id, v_contract);
  if v_contract is not null then
    select w.ends_on into v_until from public.warranty_window('CONTRACT', v_contract) w;
    if v_until is not null and v_date <= v_until then v_source_type := 'CONTRACT'; v_source_id := v_contract; end if;
  end if;
  if v_source_id is null and coalesce(v_original.quote_id, v_original.warranty_quote_id) is not null then
    select w.ends_on into v_until from public.warranty_window('QUOTE', coalesce(v_original.quote_id, v_original.warranty_quote_id)) w;
    if v_until is not null and v_date <= v_until then v_source_type := 'QUOTE'; v_source_id := coalesce(v_original.quote_id, v_original.warranty_quote_id); end if;
  end if;

  if v_source_id is null and v_original.quote_id is null then
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

  if v_source_id is not null then
    v_price := 0;
  else
    select case when count(*) = 0 then v_service.default_price
                else sum(coalesce(s.follow_up_price, v_service.default_price)) end
      into v_price
    from public.appointment_services aps
    left join public.services s on s.id = aps.service_id
    where aps.appointment_id = v_original.id;
    if v_price is null and v_original.service_id is not null then
      select coalesce(s.follow_up_price, v_service.default_price) into v_price from public.services s where s.id = v_original.service_id;
    end if;
  end if;

  select coalesce(array_agg(t.technician_id order by t.is_lead desc, t.assigned_at), array[]::uuid[]) into v_crew
  from public.appointment_technicians t where t.appointment_id = v_original.id;
  if cardinality(v_crew) = 0 and v_original.technician_id is not null then v_crew := array[v_original.technician_id]; end if;

  v_start := (v_date::timestamp + time '09:00') at time zone 'Asia/Manila';
  if v_start < now() then
    v_start := date_trunc('hour', now()) + interval '1 hour';
    if (v_start at time zone 'Asia/Manila')::date <> v_date then
      return query select 'PAST'::text, null::uuid, null::text, 'Too late today to book the follow-up.'::text; return;
    end if;
  end if;

  begin
    v_created := public.create_appointment(
      v_original.client_id, v_start, coalesce(v_service.default_duration_minutes, 60),
      v_original.pest_concern, v_service.name, v_original.service_location, v_crew,
      'Follow-up of ' || coalesce(v_original.reference, 'a visit') || ', booked from its report.'
        || case when v_source_id is not null then ' Covered by warranty until ' || to_char(v_until, 'Mon DD, YYYY') || ': no charge.' else '' end,
      'One-time', v_price, v_service.id
    );
  exception when others then
    return query select 'REFUSED'::text, null::uuid, null::text, sqlerrm::text; return;
  end;

  update public.appointments a
    set follow_up_of = v_original.id,
        quote_id = v_original.quote_id,
        warranty_kind = case when v_source_id is not null then 'RETREATMENT' end,
        warranty_quote_id = case when v_source_type = 'QUOTE' then v_source_id end,
        warranty_contract_id = case when v_source_type = 'CONTRACT' then v_source_id end
    where a.id = v_created.id;

  return query select 'BOOKED'::text, v_created.id, v_created.reference,
    ('Follow-up ' || coalesce(v_created.reference, '') || ' booked for ' || to_char(v_start at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM') || ' (Pending)'
      || case when v_source_id is not null then ', free under warranty.' else '.' end)::text;
end;
$book_follow_up$;

grant execute on function public.book_follow_up_from_report(uuid) to anon, authenticated;

-- A follow-up booked from the app under a warranty is marked the same way.
drop function if exists public.mark_warranty_retreatment(uuid, text, uuid);
create function public.mark_warranty_retreatment(p_appointment_id uuid, p_source_type text, p_source_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_until date;
begin
  perform public.assert_billing_office();
  select w.ends_on into v_until from public.warranty_window(upper(p_source_type), p_source_id) w;
  if v_until is null then raise exception 'That warranty is not running.'; end if;
  update public.appointments a
    set warranty_kind = 'RETREATMENT',
        warranty_quote_id = case when upper(p_source_type) = 'QUOTE' then p_source_id end,
        warranty_contract_id = case when upper(p_source_type) = 'CONTRACT' then p_source_id end,
        price = 0
    where a.id = p_appointment_id;
end;
$$;
grant execute on function public.mark_warranty_retreatment(uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
