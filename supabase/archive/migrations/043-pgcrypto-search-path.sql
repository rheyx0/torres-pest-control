-- ---------------------------------------------------------------------------
-- Migration 043 - Let the auth functions find pgcrypto on Supabase.
--
-- Run after 042-client-service-notes.sql.
--
-- THE SYMPTOM
--
--   Signing in fails with:
--     function crypt(text, text) does not exist  [42883]
--
--   Everything applies cleanly, the accounts are there, and every password
--   function is broken: check_login, change_password, reset_password,
--   request_password_reset, create_role_account, update_role_account.
--
-- WHY
--
--   Supabase installs pgcrypto into the `extensions` schema, not `public`.
--   That is fine for ordinary statements, because a Supabase database's
--   default search_path already includes `extensions` — which is exactly why
--   schema-v2.sql and every migration apply without complaint, crypt() calls
--   and all.
--
--   The six functions above are `security definer set search_path = public`.
--   A function-level search_path REPLACES the database one, so inside those
--   functions `extensions` is not on the path and crypt() is invisible. The
--   pinned path is not a mistake — a security definer function without one is
--   a privilege-escalation hazard — it is just too narrow by one schema.
--
--   `create extension if not exists "pgcrypto"` in schema-v2.sql does not
--   help: the extension already exists, so the statement is a no-op and does
--   not move it into public.
--
-- WHY NOT JUST MOVE THE EXTENSION
--
--   `alter extension pgcrypto set schema public` is one line and does work,
--   but PostgREST exposes `public`, and extension functions are executable by
--   PUBLIC — so it would publish crypt(), gen_salt(), digest() and the rest
--   of pgcrypto as callable REST endpoints on an anon key. Widening the
--   search_path by one schema costs nothing and exposes nothing.
--
-- THE FIX
--
--   Append `extensions` to the search_path of every public function that
--   calls crypt() or gen_salt(). Found by inspection rather than listed by
--   name, so a function added later is picked up by re-running this file, and
--   so it is correct whether pgcrypto sits in `extensions` (Supabase) or in
--   `public` (a local or self-hosted Postgres) — an unreadable or absent
--   schema on a search_path is ignored, not an error.
--
-- RE-RUN THIS after re-running any migration that recreates an auth function
-- (011, 013, 015, 016, 018, 019, 037): `create or replace function` rewrites
-- the function's settings, which puts the narrow search_path back.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- Present on Supabase already; created here so a bare Postgres gets the same
-- shape rather than relying on pgcrypto happening to live in public.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  target record;
  widened int := 0;
begin
  for target in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.prosrc like '%crypt(%' or p.prosrc like '%gen_salt(%')
      -- Only functions that pin a search_path are affected. One that inherits
      -- the database default can already see `extensions` and is left alone.
      and p.proconfig is not null
      and exists (select 1 from unnest(p.proconfig) entry where entry like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', target.signature);
    widened := widened + 1;
  end loop;

  raise notice 'pgcrypto reachable from % function(s).', widened;

  if widened = 0 then
    raise warning 'No password functions found. Apply schema-v2.sql and migrations 001-042 first.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   Every password function should now list both schemas:
--
--     select p.proname, array_to_string(p.proconfig, ', ') as config
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and (p.prosrc like '%crypt(%' or p.prosrc like '%gen_salt(%')
--     order by p.proname;
--     -> expect search_path=public, extensions on each
--
--   And the end-to-end check, which is the one that matters:
--
--     select token, username, role from public.check_login('admin', 'ChangeMe123');
--     -> one row. An empty result means the credentials are wrong; error
--        42883 means this migration has not been applied.
-- ---------------------------------------------------------------------------
