-- Torres Pest Control — the pieces of Supabase a plain PostgreSQL lacks.
--
-- Used by `npm run db:local -- --migrations` (and `npm run db:snapshot`) on an
-- empty database, after roles.sql and before schema-v2.sql and the
-- migrations. The schema and the migrations were written for Supabase, which
-- ships these already; on a plain PostgreSQL 16 (the local setup in Technical
-- Manual §4) they have to exist first or the migrations fail. The usual
-- `npm run db:local` loads torres-database.sql instead, which already holds
-- all of this.
--
--   * schema `extensions` with pgcrypto: the password functions call
--     extensions.crypt() / extensions.gen_salt() (migration 043).
--   * schema `storage` with `buckets` and `objects`: migrations 001, 013, 028
--     and 074 insert buckets and create policies on storage.objects. Locally
--     the files themselves live on disk, served by supabase/local/server.mjs.
--   * default privileges: Supabase grants every new table, sequence and
--     function in `public` to anon/authenticated/service_role; the
--     migrations' own grants and revokes then narrow that, exactly as there.
--
-- Re-runnable: every statement checks before it creates.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text not null,
  owner            uuid,
  metadata         jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated, service_role;
