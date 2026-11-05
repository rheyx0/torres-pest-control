-- ---------------------------------------------------------------------------
-- Migration 070 - Staff run the office.
--
-- Run after 069-stock-out-lines-and-losses.sql.
--
-- In this business the office staff do most of the work, so what was
-- admin-only on the server and is everyday work is opened to Staff:
--
--   1. The service catalog and its prices: the services and
--      service_materials write policies (047), set_service_materials (066)
--      and set_service_payment_check (066).
--   2. The client's "skip the payment check" switch: set_client_payment_check
--      (066).
--   3. The batch tools (write off an expired batch, edit a batch, split the
--      opening batch): assert_inventory_admin (055), which all three call.
--
-- Adding items, deliveries and corrections, archiving clients and correcting
-- a completed visit were never refused by the server (any signed-in office
-- account could); the app opens them through utils/permissions.js.
--
-- Left with the admin on purpose: reversing a payment (061), voiding an
-- invoice (062), deleting a client permanently, accounts and the activity
-- log. Whoever takes the money should not be able to erase the record of it.
--
-- This is now the source of truth for set_service_materials (from 066),
-- set_service_payment_check and set_client_payment_check (from 066) and
-- assert_inventory_admin (from 055): re-running 047, 055, 060 or 066 makes
-- them admin-only again, so re-run 070 after any of those.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create or replace function public.is_office_account()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_account_role(), '') in ('ADMIN', 'STAFF');
$$;

grant execute on function public.is_office_account() to anon, authenticated;

-- 1. The service catalog.
drop policy if exists "Write services"          on public.services;
drop policy if exists "Write service materials" on public.service_materials;

create policy "Write services" on public.services
  for all
  using (public.is_office_account())
  with check (public.is_office_account());

create policy "Write service materials" on public.service_materials
  for all
  using (public.is_office_account())
  with check (public.is_office_account());

-- set_service_materials, from 066, open to the office.
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

create or replace function public.set_service_payment_check(p_service_id uuid, p_skip boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_office_account() then
    raise exception 'Only the office can change a service''s payment check.';
  end if;
  update public.services set skip_payment_check = coalesce(p_skip, false) where id = p_service_id;
  if not found then raise exception 'Service not found.'; end if;
  return coalesce(p_skip, false);
end;
$$;

grant execute on function public.set_service_payment_check(uuid, boolean) to anon, authenticated;

-- 2. The client's payment check.
create or replace function public.set_client_payment_check(p_client_id uuid, p_skip boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_office_account() then
    raise exception 'Only the office can change a client''s payment check.';
  end if;
  update public.clients set skip_payment_check = coalesce(p_skip, false) where id = p_client_id;
  if not found then raise exception 'Client not found.'; end if;
  return coalesce(p_skip, false);
end;
$$;

grant execute on function public.set_client_payment_check(uuid, boolean) to anon, authenticated;

-- 3. The batch tools. The name is kept: three functions in 055 call it.
create or replace function public.assert_inventory_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if not public.is_office_account() then
    raise exception 'Only the office can change batches.';
  end if;
end;
$$;

revoke all on function public.assert_inventory_admin() from public, anon, authenticated;

notify pgrst, 'reload schema';
