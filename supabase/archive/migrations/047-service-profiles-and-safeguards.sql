-- ---------------------------------------------------------------------------
-- Migration 047 - Service profiles, and limits on the figures people type.
--
-- Run after 046-deactivated-accounts-stay-locked-out.sql.
--
-- Three changes:
--
--   1. Services become data. SERVICE_TYPES was a hardcoded list in
--      src/utils/constants.js, so adding "Mosquito Misting" needed a deploy.
--      public.services holds the catalog, and public.service_materials the
--      default materials each service uses. The appointment's Stock-Out tab
--      PREFILLS from those materials and the technician confirms what was
--      actually used — the default is never deducted blind, for the same reason
--      migration 035 kept application rates advisory: a figure the technician
--      did not stand behind corrupts the stock level, the one number that has
--      to stay true.
--
--      appointments.service_id links a booking to its profile, but
--      appointments.service_type (text) stays the historical SNAPSHOT. The
--      link is `on delete set null`, so deleting or renaming a service never
--      changes a past appointment: it keeps the name it was booked under, it
--      just stops prefilling.
--
--   2. Appointments cannot be booked into the past, and prices are capped at
--      999,999.99. The past-date rule lives in create_appointment() and in
--      update_appointment() only when scheduled_at CHANGES, so a visit that
--      already happened can still be completed, re-priced or annotated. It is
--      deliberately not a table constraint: seed-demo-data.sql inserts past
--      appointments directly, and history is allowed to be in the past.
--
--   3. Stock movements cannot be dated in the future, and one movement moves
--      at most 100,000 units at up to 999,999.99 each. Enforced by a BEFORE
--      INSERT trigger on inventory_movements rather than by re-copying
--      stock_in_batch / stock_out_batch / stock_out_manual / stock_correction:
--      one rule, every write path, and those functions stay as 040 left them.
--      "Today" is the business's date (Asia/Manila), not the server's UTC
--      date — a stock-out recorded at 7 am in Davao is still "today" there.
--
--   Mirrors LIMITS in src/utils/constants.js. Changing a limit on one side
--   needs a change on the other.
--
--   This migration supersedes 041's create_appointment / update_appointment
--   (they gain p_service_id). Re-running 041 after 047 restores the old
--   signatures without the guards; re-run 047 after it.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The service catalog.
-- ---------------------------------------------------------------------------

create table if not exists public.services (
  id                       uuid        primary key default gen_random_uuid(),
  name                     text        not null,
  description              text,
  default_price            numeric,
  default_duration_minutes integer,
  sort_order               integer     not null default 0,
  is_active                boolean     not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.services drop constraint if exists services_name_check;
alter table public.services
  add constraint services_name_check check (length(trim(name)) between 1 and 120);

alter table public.services drop constraint if exists services_default_price_check;
alter table public.services
  add constraint services_default_price_check
  check (default_price is null or (default_price >= 0 and default_price <= 999999.99));

alter table public.services drop constraint if exists services_default_duration_check;
alter table public.services
  add constraint services_default_duration_check
  check (default_duration_minutes is null or default_duration_minutes between 15 and 1440);

-- Case-insensitive: "Termite control" and "Termite Control" are one service.
create unique index if not exists services_name_unique_idx on public.services (lower(trim(name)));

comment on table public.services is
  'Admin-managed service catalog. appointments.service_type keeps the name as booked; service_id only links for prefill.';
comment on column public.services.is_active is
  'False retires a service: it leaves the booking form but appointments already booked under it are untouched.';

create table if not exists public.service_materials (
  id             uuid        primary key default gen_random_uuid(),
  service_id     uuid        not null references public.services(id) on delete cascade,
  item_id        uuid        not null references public.inventory(id) on delete cascade,
  default_amount numeric     not null,
  created_at     timestamptz not null default now(),
  unique (service_id, item_id)
);

alter table public.service_materials drop constraint if exists service_materials_default_amount_check;
alter table public.service_materials
  add constraint service_materials_default_amount_check
  check (default_amount > 0 and default_amount <= 100000);

comment on table public.service_materials is
  'Default materials for a service, in each item''s own unit. Prefills the appointment Stock-Out tab; never deducted without the technician submitting it.';

-- Seed from the old SERVICE_TYPES constant. ON CONFLICT DO NOTHING against the
-- lower(name) index, so a re-run or an admin's later rename is left alone.
insert into public.services (name, sort_order) values
  ('Inspection',           1),
  ('General Treatment',    2),
  ('Termite Control',      3),
  ('Rodent Control',       4),
  ('Fumigation',           5),
  ('Soil Poisoning',       6),
  ('Follow-up Visit',      7),
  ('Maintenance Contract', 8)
on conflict ((lower(trim(name)))) do nothing;

create or replace function public.set_services_updated_at()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_services_updated_at on public.services;
create trigger trg_services_updated_at
  before update on public.services
  for each row execute function public.set_services_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Access. Same shape as treatment_methods (migration 039): anyone signed in
--    reads — the booking form and the Stock-Out tab need it — and only an
--    ADMIN writes.
-- ---------------------------------------------------------------------------

alter table public.services          enable row level security;
alter table public.service_materials enable row level security;

drop policy if exists "Read services"           on public.services;
drop policy if exists "Write services"          on public.services;
drop policy if exists "Read service materials"  on public.service_materials;
drop policy if exists "Write service materials" on public.service_materials;

create policy "Read services" on public.services
  for select using (public.has_role_table_session());
create policy "Write services" on public.services
  for all
  using (public.current_account_role() = 'ADMIN')
  with check (public.current_account_role() = 'ADMIN');

create policy "Read service materials" on public.service_materials
  for select using (public.has_role_table_session());
create policy "Write service materials" on public.service_materials
  for all
  using (public.current_account_role() = 'ADMIN')
  with check (public.current_account_role() = 'ADMIN');

grant select, insert, update, delete on public.services          to anon, authenticated;
grant select, insert, update, delete on public.service_materials to anon, authenticated;

-- Replaces a service's whole materials list in one transaction, so a failed
-- save never leaves half the old list and half the new one.
-- p_materials is [{item_id, default_amount}, ...].
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

  insert into public.service_materials (service_id, item_id, default_amount)
  select p_service_id, entries.item_id, entries.default_amount
  from jsonb_to_recordset(p_materials) as entries(item_id uuid, default_amount numeric);

  return query select * from public.service_materials where service_id = p_service_id;
end;
$$;

grant execute on function public.set_service_materials(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. appointments.service_id, and a price cap.
--
--    NOT VALID: the cap binds every new and updated row without refusing to be
--    added over a row that already breaks it. Fix such a row, then
--    `alter table public.appointments validate constraint appointments_price_max_check`.
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column if not exists service_id uuid references public.services(id) on delete set null;

create index if not exists appointments_service_id_idx
  on public.appointments (service_id) where service_id is not null;

comment on column public.appointments.service_id is
  'Service profile used for Stock-Out prefill. Nulled if the service is deleted; service_type keeps the booked name.';

alter table public.appointments drop constraint if exists appointments_price_max_check;
alter table public.appointments
  add constraint appointments_price_max_check check (price is null or price <= 999999.99) not valid;

alter table public.inventory drop constraint if exists inventory_cost_max_check;
alter table public.inventory
  add constraint inventory_cost_max_check check (cost is null or cost <= 999999.99) not valid;

-- ---------------------------------------------------------------------------
-- 4. create_appointment / update_appointment, with p_service_id and guards.
--
--    Bodies are 041's, unchanged apart from the lines marked "047". The 041
--    signatures are dropped first: PostgREST resolves an RPC by argument
--    name, and two overloads side by side fail every call with PGRST203.
-- ---------------------------------------------------------------------------

drop function if exists public.create_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, numeric);
drop function if exists public.update_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, text, text, numeric);

create or replace function public.create_appointment(
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_service_type text,
  p_service_location text,
  p_technician_ids uuid[],
  p_notes text,
  p_service_frequency text,
  p_price numeric,
  p_service_id uuid default null
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare created public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Duration must be between 1 minute and 24 hours.';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and status = 'ACTIVE') then
    raise exception 'Active client not found.';
  end if;
  if p_price is not null and p_price < 0 then raise exception 'Price cannot be negative.'; end if;
  -- 047: caps and the past-date rule. Five minutes of grace covers the time
  -- between opening the form on "now" and pressing Save.
  if p_price is not null and p_price > 999999.99 then
    raise exception 'Price cannot be more than 999,999.99.';
  end if;
  if p_scheduled_at is null or p_scheduled_at < now() - interval '5 minutes' then
    raise exception 'Appointments cannot be booked in the past.';
  end if;
  if p_service_id is not null and not exists (select 1 from public.services where id = p_service_id) then
    raise exception 'That service no longer exists.';
  end if;

  perform public.assert_technicians_available(null, p_technician_ids, p_scheduled_at, p_duration_minutes);

  insert into public.appointments (
    client_id, scheduled_at, duration_minutes, pest_concern, service_type,
    service_location, technician_id, notes, created_by, service_frequency, price,
    service_id
  )
  select p_client_id, p_scheduled_at, p_duration_minutes,
         nullif(trim(p_pest_concern), ''), nullif(trim(p_service_type), ''),
         nullif(trim(p_service_location), ''),
         (select ids.technician_id
          from unnest(coalesce(p_technician_ids, array[]::uuid[])) with ordinality as ids(technician_id, position)
          where ids.technician_id is not null
          order by ids.position limit 1),
         nullif(trim(p_notes), ''), r.id,
         nullif(trim(p_service_frequency), ''), p_price,
         p_service_id
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  limit 1
  returning * into created;

  perform public.set_appointment_technicians(created.id, p_technician_ids);

  select * into created from public.appointments where id = created.id;
  return created;
end;
$$;

grant execute on function public.create_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, numeric, uuid) to anon, authenticated;

create or replace function public.update_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_pest_concern text,
  p_service_type text,
  p_service_location text,
  p_technician_ids uuid[],
  p_status text,
  p_notes text,
  p_cancellation_reason text,
  p_service_frequency text,
  p_price numeric,
  p_service_id uuid default null
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare updated public.appointments;
declare existing_row public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'Duration must be between 1 minute and 24 hours.';
  end if;
  if p_status not in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'Completed', 'Cancelled') then
    raise exception 'Invalid appointment status.';
  end if;
  if p_price is not null and p_price < 0 then raise exception 'Price cannot be negative.'; end if;
  -- 047
  if p_price is not null and p_price > 999999.99 then
    raise exception 'Price cannot be more than 999,999.99.';
  end if;

  select * into existing_row from public.appointments where id = p_appointment_id;
  if existing_row.id is null then raise exception 'Appointment not found.'; end if;

  if (existing_row.scheduled_at is distinct from p_scheduled_at
      or existing_row.duration_minutes is distinct from p_duration_minutes)
     and existing_row.status <> 'Reschedule' then
    raise exception 'Change the status to Reschedule before moving or resizing the appointment.';
  end if;

  -- 047: moving a visit into the past is refused; leaving a past visit where
  -- it is (to complete it, fix its price, add notes) is not.
  if existing_row.scheduled_at is distinct from p_scheduled_at
     and p_scheduled_at < now() - interval '5 minutes' then
    raise exception 'Appointments cannot be moved into the past.';
  end if;
  -- 047: a stale link to a deleted service is dropped rather than refused.
  if p_service_id is not null and not exists (select 1 from public.services where id = p_service_id) then
    p_service_id := null;
  end if;

  perform public.assert_technicians_available(p_appointment_id, p_technician_ids, p_scheduled_at, p_duration_minutes);

  -- The crew is written first so the sync trigger's technician_id is in place
  -- before this statement sets the rest of the row; the update then re-asserts
  -- the lead from the same ordered input, and the two cannot disagree.
  perform public.set_appointment_technicians(p_appointment_id, p_technician_ids);

  update public.appointments
  set scheduled_at = p_scheduled_at,
      duration_minutes = p_duration_minutes,
      pest_concern = nullif(trim(p_pest_concern), ''),
      service_type = nullif(trim(p_service_type), ''),
      service_location = nullif(trim(p_service_location), ''),
      technician_id = (select ids.technician_id
                       from unnest(coalesce(p_technician_ids, array[]::uuid[])) with ordinality as ids(technician_id, position)
                       where ids.technician_id is not null
                       order by ids.position limit 1),
      status = p_status,
      notes = nullif(trim(p_notes), ''),
      cancellation_reason = case when p_status = 'Cancelled' then nullif(trim(p_cancellation_reason), '') end,
      service_frequency = nullif(trim(p_service_frequency), ''),
      price = p_price,
      service_id = p_service_id
  where id = p_appointment_id
  returning * into updated;
  return updated;
end;
$$;

grant execute on function public.update_appointment(uuid, timestamptz, integer, text, text, text, uuid[], text, text, text, text, numeric, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Every stock movement: no future dates, no absurd quantities or costs.
--
--    INSERT only. Movements are an append-only log and rows already written
--    stay as they are.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_inventory_movement_limits()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.movement_date is not null
     and new.movement_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'A stock movement cannot be dated in the future.';
  end if;
  if abs(coalesce(new.amount, 0)) > 100000 or abs(coalesce(new.quantity_delta, 0)) > 100000 then
    raise exception 'One stock movement cannot move more than 100,000 units.';
  end if;
  if new.unit_cost is not null and new.unit_cost > 999999.99 then
    raise exception 'Unit cost cannot be more than 999,999.99.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_movement_limits on public.inventory_movements;
create trigger trg_inventory_movement_limits
  before insert on public.inventory_movements
  for each row execute function public.enforce_inventory_movement_limits();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   select name, is_active from public.services order by sort_order;
--     -> the eight seeded services
--
--   select conname, convalidated from pg_constraint
--   where conname in ('appointments_price_max_check', 'inventory_cost_max_check');
--     -> convalidated = false until you VALIDATE them; new writes are checked
--        either way.
--
--   select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname in ('create_appointment', 'update_appointment');
--     -> exactly one row each, ending in "p_service_id uuid"
-- ---------------------------------------------------------------------------
