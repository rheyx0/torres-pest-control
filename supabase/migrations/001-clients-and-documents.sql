-- ============================================================================
-- Migration 001 — Clients + Client Documents into Postgres/Storage
-- ============================================================================
--
-- Standalone. Does NOT depend on the users-table migration in schema-v2.sql,
-- so it can be run now and the account restructure can follow later.
--
-- WHAT THIS FIXES -----------------------------------------------------------
--
-- Client profiles lived in localStorage, so each teammate had a private copy.
-- Documents were worse: the app stored URL.createObjectURL(file), which is a
-- pointer into the browser tab's memory. The pointer was persisted, but the
-- browser revokes it on reload — so every "uploaded" file broke on refresh,
-- and the bytes never left the machine that uploaded them.
--
-- After this: clients are rows, document bytes live in Supabase Storage, and
-- the whole team sees the same data.
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
  create type client_status as enum ('ACTIVE', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_classification as enum (
    'RESIDENTIAL', 'COMMERCIAL', 'HOSPITALITY', 'WAREHOUSE_STORAGE',
    'INDUSTRIAL', 'AGRICULTURAL', 'EDUCATIONAL', 'MEDICAL_FACILITY',
    'GOVERNMENT_OFFICE', 'RELIGIOUS_INSTITUTION', 'MILITARY_FACILITY',
    'SCIENCE_LABORATORY', 'DOCK_PORT_FACILITY', 'BOAT_SHIP_VESSEL',
    'VACANT_LOT', 'OTHER'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Clients
--
--    Column names match what the app calls them. v1 named the column
--    `property_type` while every line of JS said `classification`.
-- ---------------------------------------------------------------------------

create table if not exists clients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  email                text,
  phone                text,
  address              text,
  classification       client_classification not null default 'RESIDENTIAL',
  classification_other text,
  pest_concern         text,
  source               text,                 -- 'Walk-in' | 'Referral'
  status               client_status not null default 'ACTIVE',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Guarded renames: a bare ALTER fails both on a fresh database (no such
-- column) and on a second run (already renamed).
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'clients' and column_name = 'property_type') then
    alter table clients rename column property_type to classification;
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'clients' and column_name = 'property_type_other') then
    alter table clients rename column property_type_other to classification_other;
  end if;
end $$;

create index if not exists clients_classification_idx on clients (classification);
create index if not exists clients_name_idx           on clients (lower(name));

drop trigger if exists clients_set_updated_at on clients;
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Client documents (metadata)
--
--    The bytes go in Storage; this table holds everything the UI lists.
--    ON DELETE CASCADE means removing a client removes its document rows —
--    the Storage objects are cleaned up by the app, since Postgres cannot
--    reach into the bucket.
-- ---------------------------------------------------------------------------

create table if not exists client_documents (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,               -- original filename, shown in the UI
  mime_type    text,
  size_bytes   bigint,
  storage_path text not null unique,        -- object key inside the bucket
  uploaded_at  timestamptz not null default now()
);

create index if not exists client_documents_client_idx on client_documents (client_id);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security on the tables
--
--    v1 enabled RLS on `clients` and then defined no policies, which is why
--    the table was unreachable and the app fell back to localStorage. RLS with
--    no policy denies everything.
--
--    This runs BEFORE the Storage section on purpose: creating policies on
--    storage.objects can fail with "must be owner of table objects" depending
--    on the project, and if that aborts the script, everything after it is
--    skipped. The table policies matter more, so they go first.
-- ---------------------------------------------------------------------------

alter table clients          enable row level security;
alter table client_documents enable row level security;

drop policy if exists "Open access" on clients;
create policy "Open access" on clients for all using (true) with check (true);

drop policy if exists "Open access" on client_documents;
create policy "Open access" on client_documents for all using (true) with check (true);

grant select, insert, update, delete on clients, client_documents to anon, authenticated;

-- PostgREST caches the schema; without this it can still report a column as
-- missing after the DDL above has run.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 5. Storage bucket
--
--    Private (public = false): files are reachable only through signed URLs
--    the app mints on demand, which expire after 60 seconds.
--
--    IF THIS SECTION ERRORS, everything above it has already committed and the
--    client-profile features work. Only uploads are affected. See the fallback
--    note at the bottom.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  2097152,  -- 2MB, matching MAX_DOCUMENT_BYTES in src/utils/constants.js
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage access. There is no Supabase Auth here, so the browser is always the
-- `anon` role — these policies scope access to this one bucket rather than
-- identifying a user. The size and MIME limits set above are enforced by
-- Storage itself, so they hold even if validators.validateDocument is bypassed.

do $$ begin
  drop policy if exists "client docs readable" on storage.objects;
  create policy "client docs readable" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'client-documents');

  drop policy if exists "client docs insertable" on storage.objects;
  create policy "client docs insertable" on storage.objects
    for insert to anon, authenticated
    with check (bucket_id = 'client-documents');

  drop policy if exists "client docs deletable" on storage.objects;
  create policy "client docs deletable" on storage.objects
    for delete to anon, authenticated
    using (bucket_id = 'client-documents');
exception when insufficient_privilege then
  raise notice 'Could not create storage.objects policies from SQL. Add them in the dashboard: Storage -> client-documents -> Policies.';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Verify
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'clients';
--   -> expect `classification`, NOT `property_type`
--
-- select tablename, policyname, cmd from pg_policies
--  where tablename in ('clients', 'client_documents');
--   -> expect 2 rows
--
-- select id, public, file_size_limit from storage.buckets
--  where id = 'client-documents';
--   -> expect 1 row
--
-- select policyname from pg_policies
--  where schemaname = 'storage' and tablename = 'objects';
--   -> expect the 3 "client docs ..." policies; if absent, add them in the
--      dashboard under Storage -> client-documents -> Policies (allow
--      select/insert/delete for anon), otherwise uploads will fail.
