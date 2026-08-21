-- ============================================================================
-- Migration 003 — Inventory into Postgres
-- ============================================================================
--
-- Standalone. Run after 001-clients-and-documents.sql.
--
-- WHAT THIS FIXES -----------------------------------------------------------
--
-- The `inventory` table has existed since v1, but v1 enabled RLS on it and
-- never wrote a policy — and RLS with no policy denies everything. So the
-- table was unreachable from the browser and the app quietly kept using
-- localStorage. Items added in the UI went into the browser and never
-- appeared in Supabase.
--
-- Same root cause as `clients` had. This adds the missing policies and grants.
--
-- Safe to run more than once.
-- ============================================================================

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. Table
--
--    One table with three optional column blocks rather than three tables.
--    `type` selects which block applies; the others stay null.
-- ---------------------------------------------------------------------------

create table if not exists public.inventory (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              inventory_type not null,
  quantity          numeric not null default 0,
  unit              text not null,
  cost              numeric not null default 0,
  supplier          text,
  storage_location  text,
  reorder_level     numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- CHEMICAL only
  chemical_type     chemical_type,
  expiration_date   timestamptz,
  safety_level      text,
  hazard_rating     text,
  date_received     timestamptz,

  -- EQUIPMENT only
  serial_number     text,
  condition         equipment_condition,
  last_maintenance_date timestamptz,
  next_maintenance_date timestamptz,
  manufacturer      text,
  model             text,

  -- MATERIAL only
  material_category material_category,
  description       text
);

create index if not exists inventory_type_idx on public.inventory (type);

drop trigger if exists inventory_set_updated_at on public.inventory;
create trigger inventory_set_updated_at before update on public.inventory
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security  <- the actual fix
-- ---------------------------------------------------------------------------

alter table public.inventory enable row level security;

drop policy if exists "Open access" on public.inventory;
create policy "Open access" on public.inventory for all using (true) with check (true);

grant select, insert, update, delete on public.inventory to anon, authenticated;

-- PostgREST caches the schema; without this a fresh column can still read as
-- missing from the API right after the DDL above.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
-- select policyname, cmd from pg_policies where tablename = 'inventory';
--   -> expect 1 row
-- select count(*) from inventory;
