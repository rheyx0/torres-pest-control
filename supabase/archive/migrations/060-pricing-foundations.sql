-- ---------------------------------------------------------------------------
-- Migration 060 - Pricing: what things cost, and what the client pays.
--
-- Run after 059-system-activity-log.sql. The first of Sprint 3's billing
-- migrations: quotes, invoices and payments (061 onward) price from here.
--
-- The client's price is built from the SERVICE, then adjusted:
--
--   service price    FLAT: services.default_price
--                    AREA: area (sqm) × services.area_rate, never below
--                          services.minimum_charge
--   + extra materials   only for a service material billed EXTRA_CHARGED,
--                       and only what is used beyond its included quantity,
--                       at the item's customer price
--   + approved extra work
--   − discount, + 12% VAT            (on the quote / invoice, 061+)
--
-- An item's internal cost (inventory.cost, set by deliveries) is never billed:
-- it only measures profit against the customer price.
--
--   inventory.price_mode       FIXED  -> inventory.customer_price
--                              MARKUP -> cost × (1 + markup_percent / 100)
--   services.pricing_mode      FLAT | AREA, with area_rate and minimum_charge
--   services.deposit_percent   the down payment a quote asks for by default
--   service_materials.billing_mode
--                              INCLUDED       covered by the service price
--                              EXTRA_CHARGED  above default_amount (the
--                                             included quantity), billed
--
-- A service that any visit has used can no longer be deleted — only retired —
-- so a visit, and later a quote or invoice, never loses the service it names.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Items: customer price.
-- ---------------------------------------------------------------------------

alter table public.inventory add column if not exists price_mode text not null default 'MARKUP';
alter table public.inventory add column if not exists customer_price numeric;
alter table public.inventory add column if not exists markup_percent numeric not null default 0;

alter table public.inventory drop constraint if exists inventory_price_mode_check;
alter table public.inventory add constraint inventory_price_mode_check
  check (price_mode in ('FIXED', 'MARKUP'));

alter table public.inventory drop constraint if exists inventory_customer_price_check;
alter table public.inventory add constraint inventory_customer_price_check
  check (customer_price is null or (customer_price >= 0 and customer_price <= 999999.99));

alter table public.inventory drop constraint if exists inventory_markup_percent_check;
alter table public.inventory add constraint inventory_markup_percent_check
  check (markup_percent >= 0 and markup_percent <= 1000);

comment on column public.inventory.price_mode is
  'How the customer price is set: FIXED (customer_price) or MARKUP (cost × (1 + markup_percent/100)).';

-- What the client pays for one unit. Rounded to centavos.
create or replace function public.item_customer_price(p_item public.inventory)
returns numeric
language sql stable
as $$
  select round(case
    when p_item.price_mode = 'FIXED' then coalesce(p_item.customer_price, 0)
    else coalesce(p_item.cost, 0) * (1 + coalesce(p_item.markup_percent, 0) / 100)
  end, 2);
$$;

-- ---------------------------------------------------------------------------
-- 2. Services: flat or by area, and a default down payment.
-- ---------------------------------------------------------------------------

alter table public.services add column if not exists pricing_mode text not null default 'FLAT';
alter table public.services add column if not exists area_rate numeric;
alter table public.services add column if not exists minimum_charge numeric;
alter table public.services add column if not exists deposit_percent numeric not null default 0;

alter table public.services drop constraint if exists services_pricing_mode_check;
alter table public.services add constraint services_pricing_mode_check
  check (pricing_mode in ('FLAT', 'AREA'));

alter table public.services drop constraint if exists services_area_pricing_check;
alter table public.services add constraint services_area_pricing_check
  check (
    (area_rate is null or (area_rate >= 0 and area_rate <= 999999.99))
    and (minimum_charge is null or (minimum_charge >= 0 and minimum_charge <= 999999.99))
    and (pricing_mode <> 'AREA' or area_rate is not null)
  );

alter table public.services drop constraint if exists services_deposit_percent_check;
alter table public.services add constraint services_deposit_percent_check
  check (deposit_percent >= 0 and deposit_percent <= 100);

comment on column public.services.area_rate is 'Pesos per square metre, for pricing_mode AREA.';
comment on column public.services.minimum_charge is 'The least an AREA-priced service charges, however small the area.';
comment on column public.services.deposit_percent is 'The down payment a quote for this service asks for by default, as a % of its total.';

-- ---------------------------------------------------------------------------
-- 3. Service materials: included, or charged beyond the included quantity.
-- ---------------------------------------------------------------------------

alter table public.service_materials add column if not exists billing_mode text not null default 'INCLUDED';

alter table public.service_materials drop constraint if exists service_materials_billing_mode_check;
alter table public.service_materials add constraint service_materials_billing_mode_check
  check (billing_mode in ('INCLUDED', 'EXTRA_CHARGED'));

comment on column public.service_materials.billing_mode is
  'INCLUDED: covered by the service price. EXTRA_CHARGED: use beyond default_amount (the included quantity) is billed at the item''s customer price.';

-- set_service_materials(), from 047, now carries the billing mode.
-- p_materials is [{item_id, default_amount, billing_mode}, ...].
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
         case when upper(coalesce(entries.billing_mode, '')) = 'EXTRA_CHARGED' then 'EXTRA_CHARGED' else 'INCLUDED' end
  from jsonb_to_recordset(p_materials) as entries(item_id uuid, default_amount numeric, billing_mode text);

  return query select * from public.service_materials where service_id = p_service_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A used service is retired, not deleted.
--
--    Checked by a trigger so no path — the admin panel, a direct API call —
--    can delete one. Later billing tables (quotes, contracts) extend the
--    check by recreating service_in_use().
-- ---------------------------------------------------------------------------

create or replace function public.service_in_use(p_service_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.appointments a where a.service_id = p_service_id)
      or exists (select 1 from public.appointment_services s where s.service_id = p_service_id);
$$;

create or replace function public.refuse_deleting_used_service()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.service_in_use(old.id) then
    raise exception 'The service "%" has been used on visits, so it can''t be deleted. Retire it instead.', old.name;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_services_keep_used on public.services;
create trigger trg_services_keep_used
  before delete on public.services
  for each row execute function public.refuse_deleting_used_service();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select name, pricing_mode, default_price, area_rate, minimum_charge, deposit_percent
--   from public.services order by name;
--
--   select name, cost, price_mode, customer_price, markup_percent,
--          public.item_customer_price(inventory) as customer_price_now
--   from public.inventory order by name;
-- ---------------------------------------------------------------------------
