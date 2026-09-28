-- ---------------------------------------------------------------------------
-- Migration 066 - Sprint 4: status history, the payment check, inspection to
-- quote, contract invoicing and "Charge all" materials.
--
-- Run after 065-multi-day-status-as-one.sql.
--
--   1. appointment_status_history: every status a visit takes, when, and who
--      set it. Written by a trigger, so every path records it (the Overview,
--      drag-and-drop, the report, a plan change, 065's multi-day sync).
--   2. The payment check before booking: services.skip_payment_check (an
--      inspection or follow-up needs no payment first; Inspection and
--      Follow-up Visit are marked here) and clients.skip_payment_check (a
--      trusted client). The check itself runs in the booking form, which
--      offers "Still make appointment" with a reason for the activity log;
--      these flags only say who is exempt. Admin-only setters.
--   3. Inspection to quote: an inspection visit records the area it measured
--      and the services it recommends (record_inspection, by the office or the
--      visit's crew), and a quote made from it names it (quotes.inspection_id,
--      set_quote_inspection).
--   4. Contract invoicing: invoices.contract_id ties an invoice to the
--      contract it bills (link_invoice_contract), so a contract billed up
--      front is not billed again per visit.
--   5. "Charge all" materials: service_materials.billing_mode CHARGE_ALL, for
--      a material billed for every unit used, and set_service_materials (from
--      060) takes it. Re-running 060 restores the two-mode version; re-run 066
--      after it.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Status history.
-- ---------------------------------------------------------------------------

create table if not exists public.appointment_status_history (
  id              uuid        primary key default gen_random_uuid(),
  appointment_id  uuid        not null references public.appointments(id) on delete cascade,
  from_status     text,
  to_status       text        not null,
  changed_at      timestamptz not null default now(),
  changed_by      uuid,
  changed_by_name text
);

create index if not exists appointment_status_history_visit_idx
  on public.appointment_status_history (appointment_id, changed_at);

create or replace function public.record_appointment_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.appointment_status_history (appointment_id, from_status, to_status, changed_by, changed_by_name)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    public.current_account_id(),
    public.billing_actor_name()
  );
  return new;
end;
$$;

drop trigger if exists appointments_record_status on public.appointments;
create trigger appointments_record_status
after insert or update of status on public.appointments
for each row execute function public.record_appointment_status();

alter table public.appointment_status_history enable row level security;

drop policy if exists "Status history read" on public.appointment_status_history;
create policy "Status history read" on public.appointment_status_history
  for select using (
    public.current_account_role() in ('ADMIN', 'STAFF')
    or public.is_assigned_to_appointment(appointment_id)
  );

revoke all on public.appointment_status_history from anon, authenticated;
grant select on public.appointment_status_history to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who is exempt from the payment check.
-- ---------------------------------------------------------------------------

alter table public.services add column if not exists skip_payment_check boolean not null default false;
alter table public.clients add column if not exists skip_payment_check boolean not null default false;

-- An inspection comes before any quote; a follow-up belongs to a job already
-- agreed. Only on the first run of this line: afterwards the admin decides.
update public.services
  set skip_payment_check = true
  where lower(trim(name)) in ('inspection', 'follow-up visit', 'follow up visit')
    and skip_payment_check = false
    and not exists (select 1 from public.appointment_status_history limit 1);

drop function if exists public.set_client_payment_check(uuid, boolean);

create function public.set_client_payment_check(p_client_id uuid, p_skip boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_account_role() is distinct from 'ADMIN' then
    raise exception 'Only an administrator can change a client''s payment check.';
  end if;
  update public.clients set skip_payment_check = coalesce(p_skip, false) where id = p_client_id;
  if not found then raise exception 'Client not found.'; end if;
  return coalesce(p_skip, false);
end;
$$;

grant execute on function public.set_client_payment_check(uuid, boolean) to anon, authenticated;

drop function if exists public.set_service_payment_check(uuid, boolean);

create function public.set_service_payment_check(p_service_id uuid, p_skip boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_account_role() is distinct from 'ADMIN' then
    raise exception 'Only an administrator can change a service''s payment check.';
  end if;
  update public.services set skip_payment_check = coalesce(p_skip, false) where id = p_service_id;
  if not found then raise exception 'Service not found.'; end if;
  return coalesce(p_skip, false);
end;
$$;

grant execute on function public.set_service_payment_check(uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Inspection to quote.
-- ---------------------------------------------------------------------------

alter table public.appointments add column if not exists inspection_area_sqm numeric;
alter table public.appointments add column if not exists recommended_service_ids uuid[] not null default '{}';

alter table public.appointments drop constraint if exists appointments_inspection_area_check;
alter table public.appointments add constraint appointments_inspection_area_check
  check (inspection_area_sqm is null or (inspection_area_sqm > 0 and inspection_area_sqm <= 1000000));

drop function if exists public.record_inspection(uuid, numeric, uuid[]);

create function public.record_inspection(p_appointment_id uuid, p_area_sqm numeric, p_service_ids uuid[])
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare visit public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  select * into visit from public.appointments a where a.id = p_appointment_id for update;
  if visit.id is null then raise exception 'Appointment not found.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') and not public.is_assigned_to_appointment(visit.id) then
    raise exception 'Only the office or the visit''s crew can record its inspection.';
  end if;
  if p_area_sqm is not null and (p_area_sqm <= 0 or p_area_sqm > 1000000) then
    raise exception 'Enter an area between 1 and 1,000,000 sqm.';
  end if;
  if exists (select 1 from unnest(coalesce(p_service_ids, '{}')) as wanted(id)
             where not exists (select 1 from public.services s where s.id = wanted.id)) then
    raise exception 'A recommended service was not found.';
  end if;
  update public.appointments a set
    inspection_area_sqm = p_area_sqm,
    recommended_service_ids = coalesce(p_service_ids, '{}')
  where a.id = visit.id
  returning * into visit;
  return visit;
end;
$$;

grant execute on function public.record_inspection(uuid, numeric, uuid[]) to anon, authenticated;

alter table public.quotes add column if not exists inspection_id uuid references public.appointments(id) on delete set null;

drop function if exists public.set_quote_inspection(uuid, uuid);

create function public.set_quote_inspection(p_quote_id uuid, p_appointment_id uuid)
returns public.quotes
language plpgsql security definer set search_path = public
as $$
declare target public.quotes;
begin
  perform public.assert_billing_office();
  select * into target from public.quotes q where q.id = p_quote_id for update;
  if target.id is null then raise exception 'That quote was not found.'; end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id = p_appointment_id and a.client_id = target.client_id
  ) then
    raise exception 'That inspection is for a different client.';
  end if;
  update public.quotes q set inspection_id = p_appointment_id where q.id = target.id returning * into target;
  return target;
end;
$$;

grant execute on function public.set_quote_inspection(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The contract an invoice bills.
-- ---------------------------------------------------------------------------

alter table public.invoices add column if not exists contract_id uuid references public.contracts(id) on delete set null;
create index if not exists invoices_contract_idx on public.invoices (contract_id) where contract_id is not null;

drop function if exists public.link_invoice_contract(uuid, uuid);

create function public.link_invoice_contract(p_invoice_id uuid, p_contract_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare target public.invoices;
begin
  perform public.assert_billing_office();
  select * into target from public.invoices i where i.id = p_invoice_id for update;
  if target.id is null then raise exception 'That invoice was not found.'; end if;
  if not exists (select 1 from public.contracts c where c.id = p_contract_id and c.client_id = target.client_id) then
    raise exception 'That contract is for a different client.';
  end if;
  update public.invoices i set contract_id = p_contract_id where i.id = target.id returning * into target;
  return target;
end;
$$;

grant execute on function public.link_invoice_contract(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. "Charge all" materials.
-- ---------------------------------------------------------------------------

alter table public.service_materials drop constraint if exists service_materials_billing_mode_check;
alter table public.service_materials add constraint service_materials_billing_mode_check
  check (billing_mode in ('INCLUDED', 'EXTRA_CHARGED', 'CHARGE_ALL'));

-- set_service_materials, from 060, taking CHARGE_ALL too.
create or replace function public.set_service_materials(
  p_service_id uuid,
  p_materials  jsonb
)
returns setof public.service_materials
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_account_role() is distinct from 'ADMIN' then
    raise exception 'Only an administrator can change service materials.';
  end if;
  if not exists (select 1 from public.services where id = p_service_id) then
    raise exception 'Service not found.';
  end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    raise exception 'Materials must be a list.';
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

notify pgrst, 'reload schema';
