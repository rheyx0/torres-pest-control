-- Torres Pest Control — the database roles Supabase provides, for a plain
-- PostgreSQL (the local setup in Technical Manual §4).
--
-- Roles belong to the whole PostgreSQL server, not to one database, so a
-- pg_dump snapshot does not carry them: `npm run db:local` runs this file
-- first, both before loading supabase/local/torres-database.sql and before
-- bootstrap.sql on the migrations path. Re-runnable.
--
--   anon           every request from the app runs as this role, as on
--                  Supabase (the app does not use Supabase Auth)
--   authenticated  only has to exist: some grants name it
--   service_role   only has to exist: some grants name it
--   authenticator  the login PostgREST uses; it switches to anon per request

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- Local only, and only reachable from this computer: server.mjs starts
    -- PostgREST with this password.
    create role authenticator login noinherit password 'torres-local-api';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
