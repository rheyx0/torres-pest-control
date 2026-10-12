-- ---------------------------------------------------------------------------
-- Migration 080 - follow-ups after their visit; no chemicals on a
-- non-chemical service.
--
-- Run after 079-signed-stock-handover.sql.
--
--   1. book_follow_up_from_report (from 078) does not book a follow-up dated
--      before the visit it follows.
--   2. link_follow_up (from 068) refuses a follow-up that starts before the
--      visit it follows has ended.
--   3. set_service_materials (from 070) refuses chemical items on a service
--      whose category is NON_CHEMICAL (075), and a trigger refuses switching a
--      service that lists chemicals to NON_CHEMICAL.
--
-- This is now the source of truth for those three functions: re-running 068,
-- 070 or 078 brings back the versions without these checks, so re-run 080
-- after any of them. The app makes the same checks (followUpDateProblem,
-- followUpStartProblem, validateServiceForm). Safe to run more than once.
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

create or replace function public.link_follow_up(p_appointment_id uuid, p_original_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_visit public.appointments;
  v_original public.appointments;
begin
  if coalesce(public.current_account_role(), '') not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can link a follow-up visit.';
  end if;
  select * into v_visit from public.appointments where id = p_appointment_id;
  if v_visit.id is null then raise exception 'That visit was not found.'; end if;
  if p_original_id is null then
    update public.appointments set follow_up_of = null where id = p_appointment_id;
    return;
  end if;
  select * into v_original from public.appointments where id = p_original_id;
  if v_original.id is null then raise exception 'The original visit was not found.'; end if;
  if v_original.id = v_visit.id then raise exception 'A visit cannot be a follow-up of itself.'; end if;
  if v_original.client_id is distinct from v_visit.client_id then
    raise exception 'A follow-up must be for the same client as the visit it follows.';
  end if;
  -- 080: after the visit it checks on, never before.
  if v_visit.scheduled_at < v_original.scheduled_at + make_interval(mins => coalesce(v_original.duration_minutes, 60)) then
    raise exception 'A follow-up must be after % (%).', coalesce(v_original.reference, 'the visit it follows'), to_char(v_original.scheduled_at at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM');
  end if;
  update public.appointments set follow_up_of = v_original.id where id = p_appointment_id;
end;
$$;

grant execute on function public.link_follow_up(uuid, uuid) to anon, authenticated;

create or replace function public.set_service_materials(
  p_service_id uuid,
  p_materials  jsonb
)
returns setof public.service_materials
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_office_account() then
    raise exception 'Only the office can change service materials.';
  end if;
  if not exists (select 1 from public.services where id = p_service_id) then
    raise exception 'Service not found.';
  end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    raise exception 'Materials must be a list.';
  end if;
  -- 080: a non-chemical service uses no chemicals.
  if exists (select 1 from public.services s where s.id = p_service_id and s.category = 'NON_CHEMICAL')
     and exists (
       select 1 from jsonb_to_recordset(p_materials) as entries(item_id uuid)
       join public.inventory i on i.id = entries.item_id where i.type = 'CHEMICAL'
     ) then
    raise exception 'A non-chemical service can''t use chemicals. Remove them, or make the service Chemical.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_materials) as entries(item_id uuid)
    group by entries.item_id having count(*) > 1
  ) then
    raise exception 'Each inventory item can only be listed once per service.';
  end if;

  delete from public.service_materials where service_id = p_service_id;

  insert into public.service_materials (service_id, item_id, default_amount, billing_mode)
  select p_service_id, entries.item_id, entries.default_amount,
         case upper(coalesce(entries.billing_mode, ''))
           when 'EXTRA_CHARGED' then 'EXTRA_CHARGED'
           when 'CHARGE_ALL' then 'CHARGE_ALL'
           else 'INCLUDED'
         end
  from jsonb_to_recordset(p_materials) as entries(item_id uuid, default_amount numeric, billing_mode text);

  return query select * from public.service_materials where service_id = p_service_id;
end;
$$;

-- A service switched to Non-chemical while it still lists chemicals.
create or replace function public.services_no_chemicals_when_non_chemical()
returns trigger
language plpgsql security definer set search_path = public
as $no_chem$
begin
  if new.category = 'NON_CHEMICAL' and exists (
    select 1 from public.service_materials sm join public.inventory i on i.id = sm.item_id
    where sm.service_id = new.id and i.type = 'CHEMICAL'
  ) then
    raise exception 'Remove the chemicals from % first. A non-chemical service can''t use chemicals.', new.name;
  end if;
  return new;
end;
$no_chem$;

drop trigger if exists services_no_chemicals_when_non_chemical on public.services;
create trigger services_no_chemicals_when_non_chemical
  before update of category on public.services
  for each row execute function public.services_no_chemicals_when_non_chemical();

notify pgrst, 'reload schema';
