-- ---------------------------------------------------------------------------
-- Migration 084 - built-in services: Checkup, Follow-up Visit, Inspection.
--
-- Run after 083-warranty-starts-when-finished.sql.
--
-- Three services drive features, and until now the system found them by
-- guessing from their names ("checkup", "follow-up", "inspect"): renaming or
-- retiring one quietly broke warranty checkups, follow-ups or inspections.
-- Now each carries a fixed tag, services.system_key:
--
--   CHECKUP     warranty checkups (book_warranty_visits)
--   FOLLOW_UP   follow-up visits (Book follow-up, book_follow_up_from_report)
--   INSPECTION  inspection fields and "Create quote from inspection"
--
-- This migration tags the service already playing each part (an active one
-- first), or creates it if there is none, so old visits stay connected. The
-- trigger guard_system_service() then keeps them:
--   - never deleted, never retired;
--   - name, description, category and "Can be booked without payment"
--     locked;
--   - the Checkup's price stays 0 (a warranty checkup is free);
--   - the tag itself is set only here and never changes, one per kind
--     (unique index).
-- Everything else (Follow-up / Inspection price, duration, materials,
-- follow-up price) stays editable.
--
-- This is now the source of truth for book_warranty_visits and
-- book_follow_up_from_report (from 082): they find their service by tag.
-- Re-running 082 (or 078 / 080) brings back the name lookup; re-run 084 after
-- it. Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.services add column if not exists system_key text;
alter table public.services drop constraint if exists services_system_key_check;
alter table public.services add constraint services_system_key_check
  check (system_key is null or system_key in ('CHECKUP', 'FOLLOW_UP', 'INSPECTION'));
create unique index if not exists services_system_key_idx on public.services (system_key) where system_key is not null;

create or replace function public.guard_system_service()
returns trigger
language plpgsql security definer set search_path = public
as $guard$
declare
  v_trusted boolean := coalesce(current_setting('app.system_service', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null then
      raise exception '% is a built-in service and cannot be deleted.', old.name;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.system_key is not null and not v_trusted then
      raise exception 'Built-in services are set up by the system.';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.system_key is distinct from old.system_key and not v_trusted then
    raise exception 'Which service is built in cannot be changed.';
  end if;
  if old.system_key is not null and not v_trusted then
    if new.name is distinct from old.name then
      raise exception '% is a built-in service: its name cannot be changed.', old.name;
    end if;
    if new.description is distinct from old.description then
      raise exception '% is a built-in service: its description cannot be changed.', old.name;
    end if;
    if new.category is distinct from old.category then
      raise exception '% is a built-in service: its category cannot be changed.', old.name;
    end if;
    if new.skip_payment_check is distinct from old.skip_payment_check then
      raise exception '% is a built-in service: whether it needs payment cannot be changed.', old.name;
    end if;
    if not new.is_active then
      raise exception '% is a built-in service and cannot be retired.', old.name;
    end if;
    if old.system_key = 'CHECKUP' and coalesce(new.default_price, 0) <> 0 then
      raise exception 'A warranty checkup is free: the Checkup price stays 0.';
    end if;
  end if;
  return new;
end;
$guard$;

drop trigger if exists guard_system_service on public.services;
create trigger guard_system_service
  before insert or update or delete on public.services
  for each row execute function public.guard_system_service();

-- Tag (or create) the three built-in services.
do $tag$
declare
  v_id uuid;
begin
  perform set_config('app.system_service', 'on', true);

  -- Checkup
  if not exists (select 1 from public.services where system_key = 'CHECKUP') then
    select id into v_id from public.services where lower(name) ~ 'check[ -]?up'
      order by is_active desc, name limit 1;
    if v_id is null then
      insert into public.services (name, description, default_price, default_duration_minutes, is_active, category, skip_payment_check, system_key)
      values ('Checkup', 'Regular checkup under a warranty or contract. Free of charge.', 0, 60, true, 'NON_CHEMICAL', true, 'CHECKUP');
    else
      update public.services set system_key = 'CHECKUP', is_active = true, default_price = 0, category = 'NON_CHEMICAL' where id = v_id;
    end if;
  end if;

  -- Follow-up Visit
  v_id := null;
  if not exists (select 1 from public.services where system_key = 'FOLLOW_UP') then
    select id into v_id from public.services where lower(name) ~ 'follow[ -]?up'
      order by is_active desc, name limit 1;
    if v_id is null then
      insert into public.services (name, description, default_duration_minutes, is_active, category, skip_payment_check, system_key)
      values ('Follow-up Visit', 'A visit to check on a job done earlier.', 60, true, 'NON_CHEMICAL', false, 'FOLLOW_UP');
    else
      update public.services set system_key = 'FOLLOW_UP', is_active = true where id = v_id;
    end if;
  end if;

  -- Inspection
  v_id := null;
  if not exists (select 1 from public.services where system_key = 'INSPECTION') then
    select id into v_id from public.services where lower(name) ~ 'inspect'
      order by is_active desc, name limit 1;
    if v_id is null then
      insert into public.services (name, description, default_duration_minutes, is_active, category, skip_payment_check, system_key)
      values ('Inspection', 'Site inspection before a quotation.', 60, true, 'NON_CHEMICAL', true, 'INSPECTION');
    else
      update public.services set system_key = 'INSPECTION', is_active = true where id = v_id;
    end if;
  end if;
end;
$tag$;

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
    select * into v_service from public.services s where s.system_key = 'CHECKUP' and s.is_active;
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
  -- 082: only the warranty functions may set a visit's warranty link.
  perform set_config('app.warranty_link', 'on', true);
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
  -- 080: a follow-up checks on the visit, so never before it.
  if v_date < (v_original.scheduled_at at time zone 'Asia/Manila')::date then
    return query select 'PAST'::text, null::uuid, null::text, 'The follow-up date is before the visit itself, so it was not booked.'::text; return;
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
  where s.system_key = 'FOLLOW_UP' and s.is_active;
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

  -- 082: only the warranty functions may set a visit's warranty link.
  perform set_config('app.warranty_link', 'on', true);
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

notify pgrst, 'reload schema';
