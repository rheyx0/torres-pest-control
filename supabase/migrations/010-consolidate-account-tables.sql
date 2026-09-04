-- Migration 010 — Keep all account roles in public.users
--
-- Run schema-v2.sql before this migration. The v2 schema already copies
-- legacy account rows into users; this migration removes the old tables so
-- there is one unambiguous source of truth for account data.

do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'public.users is missing. Run supabase/schema-v2.sql first.';
  end if;
end $$;

-- These tables are no longer read or written by the application. CASCADE is
-- intentionally avoided so unexpected dependencies fail instead of being
-- silently deleted.
drop table if exists public.admins;
drop table if exists public.staff;
drop table if exists public.technicians;

notify pgrst, 'reload schema';