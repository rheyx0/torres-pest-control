-- Reference schema for Supabase (plain Postgres/SQL — no Prisma, no Supabase
-- Auth). Run this in the Supabase SQL Editor once you're ready to move off
-- localStorage.
--
-- Login is handled entirely by this project's own tables — admins/staff/
-- technicians each have their own `password` column, checked directly via
-- the check_login() function below. Supabase Auth (auth.users, signUp,
-- email confirmation) is intentionally NOT used: it added email-confirmation
-- requirements and per-hour email rate limits that don't fit a live,
-- multi-person demo where several people take turns testing the app.
-- Supabase here is just a shared hosted Postgres database — the same role
-- localStorage used to play, except everyone sees the same data instead of
-- each browser having its own separate copy.
--
-- Safe to run this whole file more than once — types/tables/triggers/
-- policies/functions are all guarded so re-running it doesn't error on
-- "already exists".

create extension if not exists "pgcrypto";

-- Reusable trigger to keep updated_at current on every row update.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- --- Enums ------------------------------------------------------------
-- Postgres has no `create type if not exists`, so each one is wrapped to
-- silently skip if it already exists.

do $$ begin
  create type account_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_status as enum ('ACTIVE', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_classification as enum (
    'RESIDENTIAL',
    'COMMERCIAL',
    'HOSPITALITY',
    'WAREHOUSE_STORAGE',
    'INDUSTRIAL',
    'AGRICULTURAL',
    'EDUCATIONAL',
    'MEDICAL_FACILITY',
    'GOVERNMENT_OFFICE',
    'RELIGIOUS_INSTITUTION',
    'MILITARY_FACILITY',
    'SCIENCE_LABORATORY',
    'DOCK_PORT_FACILITY',
    'BOAT_SHIP_VESSEL',
    'VACANT_LOT',
    'OTHER'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type inventory_type as enum ('CHEMICAL', 'EQUIPMENT', 'MATERIAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chemical_type as enum ('INSECTICIDE', 'FUNGICIDE', 'RODENTICIDE', 'HERBICIDE', 'FUMIGANT', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_condition as enum ('ACTIVE', 'MAINTENANCE', 'DAMAGED', 'INACTIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type material_category as enum ('PROTECTIVE_GEAR', 'SUPPLIES', 'TOOLS_ACCESSORIES', 'OTHER');
exception when duplicate_object then null; end $$;

-- --- Accounts -------------------------------------------------------------
-- Admin / Staff / Technician stay as three separate tables. Each stores its
-- own plaintext password column and is checked directly via check_login().

create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text not null unique,
  password text not null,
  status account_status not null default 'ACTIVE',
  is_primary boolean not null default false, -- seeded admin; guards against deactivating the last active admin
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table admins drop column if exists auth_user_id;
alter table admins add column if not exists password text not null default '';
drop trigger if exists admins_set_updated_at on admins;
create trigger admins_set_updated_at before update on admins
  for each row execute function set_updated_at();

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text not null unique,
  password text not null,
  status account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table staff drop column if exists auth_user_id;
alter table staff add column if not exists password text not null default '';
drop trigger if exists staff_set_updated_at on staff;
create trigger staff_set_updated_at before update on staff
  for each row execute function set_updated_at();

create table if not exists technicians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text not null unique,
  password text not null,
  status account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table technicians drop column if exists auth_user_id;
alter table technicians add column if not exists password text not null default '';
drop trigger if exists technicians_set_updated_at on technicians;
create trigger technicians_set_updated_at before update on technicians
  for each row execute function set_updated_at();

-- Seed the first admin so there's always a way to log in. Safe to re-run —
-- inserts it if missing, otherwise just makes sure the password matches.
insert into admins (name, phone, email, password, is_primary)
values ('Maya Torres', '+63 917 000 1111', 'admin@torrespestcontrol.com', '123321', true)
on conflict (email) do update set password = excluded.password;

-- --- Clients ----------------------------------------------------------

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  property_type client_classification not null default 'RESIDENTIAL',
  property_type_other text, -- used when property_type = 'OTHER'
  pest_concern text,        -- e.g. "Termites", "Rodents"
  source text,               -- "Walk-in" or "Referral"
  status client_status not null default 'ACTIVE', -- enables Record Editing & Archiving
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists clients_set_updated_at on clients;
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();

-- --- Inventory ----------------------------------------------------------

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type inventory_type not null,
  quantity numeric not null,
  unit text not null,        -- "liters", "kg", "boxes", "pcs", etc.
  cost numeric not null,     -- cost per unit
  supplier text,
  storage_location text,
  reorder_level numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- CHEMICAL-only fields
  chemical_type chemical_type,
  expiration_date timestamptz,
  safety_level text,         -- "Low", "Medium", "High"
  hazard_rating text,
  date_received timestamptz,

  -- EQUIPMENT-only fields
  serial_number text,
  condition equipment_condition,
  last_maintenance_date timestamptz,
  next_maintenance_date timestamptz,
  manufacturer text,
  model text,

  -- MATERIAL-only fields
  material_category material_category,
  description text
);
drop trigger if exists inventory_set_updated_at on inventory;
create trigger inventory_set_updated_at before update on inventory
  for each row execute function set_updated_at();

-- --- Row-Level Security ---------------------------------------------------
-- No Supabase Auth session exists in this design, so the client is always
-- the `anon` role from Postgres's point of view — there's no per-user
-- identity to check in a policy the way there was with auth.jwt(). Access
-- control for writes (only admins can create/edit accounts) is enforced by
-- the app's UI instead, which fits this project's scope. The one thing kept
-- server-side: the `password` column is hidden from ordinary reads via
-- column-level grants below, so it's not just sitting in a plainly-queryable
-- column — the only way to check a password is through check_login().

alter table admins enable row level security;
alter table staff enable row level security;
alter table technicians enable row level security;
alter table clients enable row level security;
alter table inventory enable row level security;

drop policy if exists "Authenticated users can read admins" on admins;
drop policy if exists "Admins manage admins" on admins;
drop policy if exists "Open access" on admins;
create policy "Open access" on admins for all using (true) with check (true);

drop policy if exists "Authenticated users can read staff" on staff;
drop policy if exists "Admins manage staff" on staff;
drop policy if exists "Open access" on staff;
create policy "Open access" on staff for all using (true) with check (true);

drop policy if exists "Authenticated users can read technicians" on technicians;
drop policy if exists "Admins manage technicians" on technicians;
drop policy if exists "Open access" on technicians;
create policy "Open access" on technicians for all using (true) with check (true);

-- Hide the password column from general reads/listing — only reachable
-- through check_login() below, never via a plain `select *`.
revoke select on admins from anon, authenticated;
revoke select on staff from anon, authenticated;
revoke select on technicians from anon, authenticated;
grant select (id, name, phone, email, status, is_primary, created_at, updated_at) on admins to anon, authenticated;
grant select (id, name, phone, email, status, created_at, updated_at) on staff to anon, authenticated;
grant select (id, name, phone, email, status, created_at, updated_at) on technicians to anon, authenticated;
grant insert, update, delete on admins, staff, technicians to anon, authenticated;

-- clients/inventory intentionally have no policies yet — the app still
-- manages those two tables via localStorage, not Supabase.

-- --- Login check ------------------------------------------------------
-- Checks email+password against all three tables at once and returns the
-- matching profile (without the password) plus which role it came from.
-- security definer so it can read the password column even though ordinary
-- reads are revoked above.

drop function if exists public.lookup_auth_user_id(text);

create or replace function public.check_login(login_email text, login_password text)
returns table(id uuid, name text, phone text, email text, role text, status account_status)
language sql
security definer
set search_path = public
as $$
  select id, name, phone, email, 'ADMIN'::text, status from admins
    where email = login_email and password = login_password and status = 'ACTIVE'
  union all
  select id, name, phone, email, 'STAFF'::text, status from staff
    where email = login_email and password = login_password and status = 'ACTIVE'
  union all
  select id, name, phone, email, 'TECHNICIAN'::text, status from technicians
    where email = login_email and password = login_password and status = 'ACTIVE';
$$;

revoke all on function public.check_login(text, text) from public;
grant execute on function public.check_login(text, text) to anon, authenticated;
