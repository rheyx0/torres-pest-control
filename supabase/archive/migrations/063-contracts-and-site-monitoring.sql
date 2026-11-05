-- ---------------------------------------------------------------------------
-- Migration 063 - Service contracts and site monitoring.
--
-- Run after 062-invoices.sql.
--
-- SITE MONITORING. Each visit records how much pest activity was found
-- (appointments.activity_level: NONE, LOW, MEDIUM, HIGH) and what is still
-- open at the site (open_issues: a leaking pipe feeding the termites, a gap
-- under a door). The client profile shows the activity as a trend, so the
-- office can see a treatment working, or not. Recorded with the report,
-- through record_site_monitoring() — by the visit's crew or the office — so
-- submit_appointment_report (052) is left exactly as it is.
--
-- CONTRACTS (TPC-K-00001). The terms a recurring service is sold on: the
-- services, how often and how many visits (or until when), the price per
-- visit, how it is billed (per visit, monthly, or the whole contract up
-- front), payment terms, what is included, the cancellation terms, and the
-- signed copy (a client document, category CONTRACT, migration 031).
--
--   DRAFT -> ACTIVE (only with the signed copy attached) -> ENDED
--   DRAFT | ACTIVE -> CANCELLED, with a reason: the visits still to come on
--   its plan are cancelled and the plan stops asking to be renewed (053).
--
-- Its visits are booked the usual way, as a recurring plan (052), and the
-- plan is linked back here (plan_id). A service named on a contract counts as
-- used (060's rule): it can be retired, not deleted.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Site monitoring.
-- ---------------------------------------------------------------------------

alter table public.appointments add column if not exists activity_level text;
alter table public.appointments add column if not exists open_issues text;

alter table public.appointments drop constraint if exists appointments_activity_level_check;
alter table public.appointments add constraint appointments_activity_level_check
  check (activity_level is null or activity_level in ('NONE', 'LOW', 'MEDIUM', 'HIGH'));

drop function if exists public.record_site_monitoring(uuid, text, text);

create function public.record_site_monitoring(p_appointment_id uuid, p_activity_level text, p_open_issues text default null)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare
  visit public.appointments;
  v_level text := nullif(upper(trim(coalesce(p_activity_level, ''))), '');
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  select * into visit from public.appointments a where a.id = p_appointment_id for update;
  if visit.id is null then raise exception 'Appointment not found.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') and not public.is_assigned_to_appointment(visit.id) then
    raise exception 'Only the office or the visit''s crew can record its monitoring.';
  end if;
  if visit.status = 'Cancelled' then raise exception 'A cancelled visit has nothing to record.'; end if;
  if v_level is not null and v_level not in ('NONE', 'LOW', 'MEDIUM', 'HIGH') then
    raise exception 'Activity level is None, Low, Medium or High.';
  end if;
  if char_length(coalesce(p_open_issues, '')) > 2000 then raise exception 'Keep the open issues under 2,000 characters.'; end if;

  update public.appointments a set
    activity_level = v_level,
    open_issues = nullif(trim(coalesce(p_open_issues, '')), '')
  where a.id = visit.id
  returning * into visit;
  return visit;
end;
$$;

grant execute on function public.record_site_monitoring(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Contracts.
-- ---------------------------------------------------------------------------

create sequence if not exists public.contract_reference_seq as bigint start 1;

create table if not exists public.contracts (
  id                  uuid        primary key default gen_random_uuid(),
  reference           text        not null default 'TPC-K-' || lpad(nextval('public.contract_reference_seq')::text, 5, '0'),
  client_id           uuid        not null references public.clients(id) on delete restrict,
  quote_id            uuid        references public.quotes(id) on delete set null,
  plan_id             uuid        references public.appointment_plans(id) on delete set null,
  title               text        not null check (char_length(title) between 1 and 200),
  service_ids         uuid[]      not null default '{}',
  service_names       text,
  frequency           text        not null,
  visit_count         integer     check (visit_count is null or (visit_count between 1 and 366)),
  starts_on           date        not null,
  ends_on             date,
  price_per_visit     numeric     not null default 0 check (price_per_visit >= 0 and price_per_visit <= 999999.99),
  billing_schedule    text        not null default 'PER_VISIT' check (billing_schedule in ('PER_VISIT', 'MONTHLY', 'UPFRONT')),
  payment_terms       text        not null default 'DUE_ON_RECEIPT' check (payment_terms in ('DUE_ON_RECEIPT', 'NET_15', 'NET_30')),
  inclusions          text,
  cancellation_terms  text,
  notes               text,
  signed_document_id  uuid        references public.client_documents(id) on delete set null,
  status              text        not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED')),
  activated_at        timestamptz,
  ended_at            timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint contracts_length check (visit_count is not null or ends_on is not null),
  constraint contracts_dates check (ends_on is null or ends_on >= starts_on)
);

create unique index if not exists contracts_reference_key on public.contracts (reference);
create index if not exists contracts_client_idx on public.contracts (client_id);
create index if not exists contracts_plan_idx on public.contracts (plan_id) where plan_id is not null;

comment on table public.contracts is
  'The terms a recurring service is sold on (TPC-K). DRAFT -> ACTIVE (signed copy attached) -> ENDED, or CANCELLED with a reason.';

alter table public.contracts enable row level security;

drop policy if exists "Contract read" on public.contracts;
create policy "Contract read" on public.contracts
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

revoke all on public.contracts from anon, authenticated;
grant select on public.contracts to anon, authenticated;

-- A service on a contract is in use too.
create or replace function public.service_in_use(p_service_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.appointments a where a.service_id = p_service_id)
      or exists (select 1 from public.appointment_services s where s.service_id = p_service_id)
      or exists (select 1 from public.quote_lines l where l.service_id = p_service_id)
      or exists (select 1 from public.invoice_lines l where l.service_id = p_service_id)
      or exists (select 1 from public.contracts c where p_service_id = any(c.service_ids));
$$;

-- ---------------------------------------------------------------------------
-- 3. Writing contracts.
-- ---------------------------------------------------------------------------

-- Create (p_contract_id null) or change a draft. The terms of an active
-- contract are what was signed: they are not edited.
drop function if exists public.save_contract(uuid, jsonb);

create function public.save_contract(p_contract_id uuid, p_contract jsonb)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  v_client uuid := (p_contract->>'client_id')::uuid;
  v_quote uuid := nullif(p_contract->>'quote_id', '')::uuid;
  v_services uuid[] := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_contract->'service_ids', '[]'::jsonb))),
    '{}'::uuid[]
  );
  v_count integer := nullif(p_contract->>'visit_count', '')::integer;
  v_starts date := nullif(p_contract->>'starts_on', '')::date;
  v_ends date := nullif(p_contract->>'ends_on', '')::date;
  v_price numeric := coalesce(nullif(p_contract->>'price_per_visit', '')::numeric, 0);
  v_names text;
begin
  perform public.assert_billing_office();

  if v_client is null or not exists (select 1 from public.clients c where c.id = v_client) then
    raise exception 'Choose the client for this contract.';
  end if;
  if nullif(trim(coalesce(p_contract->>'title', '')), '') is null then raise exception 'Give the contract a title.'; end if;
  if cardinality(v_services) = 0 then raise exception 'Choose the services the contract covers.'; end if;
  if nullif(trim(coalesce(p_contract->>'frequency', '')), '') is null then raise exception 'Choose how often the visits are.'; end if;
  if v_starts is null then raise exception 'Enter the start date.'; end if;
  if v_count is null and v_ends is null then raise exception 'Enter the number of visits or the end date.'; end if;
  if v_ends is not null and v_ends < v_starts then raise exception 'The end date is before the start date.'; end if;
  if v_price < 0 or v_price > 999999.99 then raise exception 'Enter a price per visit up to ₱999,999.99.'; end if;
  if v_quote is not null and not exists (select 1 from public.quotes q where q.id = v_quote and q.client_id = v_client) then
    raise exception 'That quote is for a different client.';
  end if;

  select string_agg(s.name, ', ' order by array_position(v_services, s.id)) into v_names
  from public.services s where s.id = any(v_services);

  if p_contract_id is null then
    insert into public.contracts (
      client_id, quote_id, title, service_ids, service_names, frequency, visit_count, starts_on, ends_on,
      price_per_visit, billing_schedule, payment_terms, inclusions, cancellation_terms, notes, created_by
    )
    values (
      v_client, v_quote, trim(p_contract->>'title'), v_services, v_names, trim(p_contract->>'frequency'), v_count, v_starts, v_ends,
      round(v_price, 2), coalesce(p_contract->>'billing_schedule', 'PER_VISIT'), coalesce(p_contract->>'payment_terms', 'DUE_ON_RECEIPT'),
      nullif(trim(coalesce(p_contract->>'inclusions', '')), ''), nullif(trim(coalesce(p_contract->>'cancellation_terms', '')), ''),
      nullif(trim(coalesce(p_contract->>'notes', '')), ''), public.current_account_id()
    )
    returning * into target;
  else
    select * into target from public.contracts c where c.id = p_contract_id for update;
    if target.id is null then raise exception 'That contract was not found.'; end if;
    if target.status <> 'DRAFT' then
      raise exception 'Contract % is %: its terms are what was signed and can no longer be changed.', target.reference, lower(target.status);
    end if;
    update public.contracts c set
      client_id = v_client, quote_id = v_quote, title = trim(p_contract->>'title'),
      service_ids = v_services, service_names = v_names, frequency = trim(p_contract->>'frequency'),
      visit_count = v_count, starts_on = v_starts, ends_on = v_ends, price_per_visit = round(v_price, 2),
      billing_schedule = coalesce(p_contract->>'billing_schedule', 'PER_VISIT'),
      payment_terms = coalesce(p_contract->>'payment_terms', 'DUE_ON_RECEIPT'),
      inclusions = nullif(trim(coalesce(p_contract->>'inclusions', '')), ''),
      cancellation_terms = nullif(trim(coalesce(p_contract->>'cancellation_terms', '')), ''),
      notes = nullif(trim(coalesce(p_contract->>'notes', '')), ''),
      -- A draft moved to another client can't keep the first client's file.
      signed_document_id = case when v_client = target.client_id then target.signed_document_id end,
      updated_at = now()
    where c.id = target.id
    returning * into target;
  end if;
  return target;
end;
$$;

grant execute on function public.save_contract(uuid, jsonb) to anon, authenticated;

-- The signed copy: one of the client's own documents.
drop function if exists public.attach_contract_document(uuid, uuid);

create function public.attach_contract_document(p_contract_id uuid, p_document_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare target public.contracts;
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status in ('ENDED', 'CANCELLED') then raise exception 'Contract % is %.', target.reference, lower(target.status); end if;
  if not exists (select 1 from public.client_documents d where d.id = p_document_id and d.client_id = target.client_id) then
    raise exception 'That document is not in this client''s files.';
  end if;
  update public.contracts c set signed_document_id = p_document_id, updated_at = now()
  where c.id = target.id returning * into target;
  return target;
end;
$$;

grant execute on function public.attach_contract_document(uuid, uuid) to anon, authenticated;

-- Draft -> Active (signed) -> Ended.
drop function if exists public.set_contract_status(uuid, text);

create function public.set_contract_status(p_contract_id uuid, p_status text)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  v_status text := upper(coalesce(p_status, ''));
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if v_status = 'ACTIVE' then
    if target.status <> 'DRAFT' then raise exception 'Only a draft contract can be made active.'; end if;
    if target.signed_document_id is null then raise exception 'Attach the signed contract first.'; end if;
    update public.contracts c set status = 'ACTIVE', activated_at = now(), updated_at = now() where c.id = target.id returning * into target;
  elsif v_status = 'ENDED' then
    if target.status <> 'ACTIVE' then raise exception 'Only an active contract can end.'; end if;
    update public.contracts c set status = 'ENDED', ended_at = now(), updated_at = now() where c.id = target.id returning * into target;
  else
    raise exception 'A contract is made active or ended here; cancel it with a reason instead.';
  end if;
  return target;
end;
$$;

grant execute on function public.set_contract_status(uuid, text) to anon, authenticated;

-- Cancelled, with a reason: the visits still to come are cancelled, and the
-- plan stops asking to be renewed.
drop function if exists public.cancel_contract(uuid, text);

create function public.cancel_contract(p_contract_id uuid, p_reason text)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  cancelled_count integer := 0;
begin
  perform public.assert_billing_office();
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Write why the contract is being cancelled.'; end if;
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status not in ('DRAFT', 'ACTIVE') then raise exception 'Contract % is already %.', target.reference, lower(target.status); end if;

  if target.plan_id is not null then
    update public.appointments a
      set status = 'Cancelled', cancellation_reason = 'Contract cancelled: ' || trim(p_reason)
      where a.plan_id = target.plan_id and a.scheduled_at > now()
        and a.status not in ('Completed', 'Cancelled', 'In progress');
    get diagnostics cancelled_count = row_count;
    update public.appointment_plans p set renewal_declined_at = coalesce(p.renewal_declined_at, now()) where p.id = target.plan_id;
  end if;

  update public.contracts c set
    status = 'CANCELLED', cancelled_at = now(), updated_at = now(),
    cancellation_reason = trim(p_reason) || case when cancelled_count > 0 then ' (' || cancelled_count || ' visit' || case when cancelled_count = 1 then '' else 's' end || ' cancelled)' else '' end
  where c.id = target.id
  returning * into target;
  return target;
end;
$$;

grant execute on function public.cancel_contract(uuid, text) to anon, authenticated;

-- The recurring plan booked for it (052), through one of the plan's visits.
drop function if exists public.link_contract_plan(uuid, uuid);

create function public.link_contract_plan(p_contract_id uuid, p_appointment_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  visit public.appointments;
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status in ('ENDED', 'CANCELLED') then raise exception 'Contract % is %.', target.reference, lower(target.status); end if;
  select * into visit from public.appointments a where a.id = p_appointment_id;
  if visit.id is null then raise exception 'That visit was not found.'; end if;
  if visit.client_id <> target.client_id then raise exception 'That visit is for a different client.'; end if;
  if visit.plan_id is null then raise exception 'Book the contract''s visits as a recurring plan.'; end if;
  update public.contracts c set plan_id = visit.plan_id, updated_at = now() where c.id = target.id returning * into target;
  return target;
end;
$$;

grant execute on function public.link_contract_plan(uuid, uuid) to anon, authenticated;

-- A draft nobody has booked can be thrown away.
drop function if exists public.delete_contract(uuid);

create function public.delete_contract(p_contract_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare target public.contracts;
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status <> 'DRAFT' then raise exception 'Only a draft contract can be deleted; cancel it instead.'; end if;
  if target.plan_id is not null then raise exception 'Visits were booked for this contract; cancel it instead.'; end if;
  delete from public.contracts c where c.id = target.id;
  return true;
end;
$$;

grant execute on function public.delete_contract(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
