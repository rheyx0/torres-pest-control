-- ---------------------------------------------------------------------------
-- Migration 032 - Employee reference codes for accounts.
--
-- Run after 031-client-document-categories.sql.
--
-- Accounts already have a unique `username`, but that is a login handle. This
-- adds the other thing a business needs: a short employee number that can go on
-- an ID badge, a signed service form, or be read out over the phone.
--
--   TPC-A-001   admin
--   TPC-S-002   staff
--   TPC-T-003   technician
--
-- One shared sequence across all three tables, so a number is never reused and
-- a code is unique system-wide even though the accounts live in three tables.
-- The letter says which table to look in.
--
-- Existing accounts are backfilled in created_at order, oldest first, so the
-- numbers line up with how the team actually grew.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One counter for every account, whatever its role.
-- ---------------------------------------------------------------------------

create sequence if not exists public.account_reference_seq as bigint start 1;

-- ---------------------------------------------------------------------------
-- 2. The column, on all three account tables.
-- ---------------------------------------------------------------------------

alter table public.admins      add column if not exists reference text;
alter table public.staff       add column if not exists reference text;
alter table public.technicians add column if not exists reference text;

-- ---------------------------------------------------------------------------
-- 3. Backfill, oldest account first.
--
--    Interleaved across the three tables by created_at so the numbering follows
--    real hiring order rather than grouping every admin ahead of every
--    technician.
-- ---------------------------------------------------------------------------

do $$
declare
  account record;
  prefix text;
begin
  for account in
    select id, 'admins'::text as source, created_at from public.admins      where reference is null
    union all
    select id, 'staff'::text,            created_at from public.staff       where reference is null
    union all
    select id, 'technicians'::text,      created_at from public.technicians where reference is null
    order by created_at, id
  loop
    prefix := case account.source
      when 'admins' then 'TPC-A-'
      when 'staff'  then 'TPC-S-'
      else 'TPC-T-'
    end;

    if account.source = 'admins' then
      update public.admins
        set reference = prefix || lpad(nextval('public.account_reference_seq')::text, 3, '0')
        where id = account.id;
    elsif account.source = 'staff' then
      update public.staff
        set reference = prefix || lpad(nextval('public.account_reference_seq')::text, 3, '0')
        where id = account.id;
    else
      update public.technicians
        set reference = prefix || lpad(nextval('public.account_reference_seq')::text, 3, '0')
        where id = account.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. New accounts get one automatically.
--
--    Set after the backfill so existing rows keep the numbers assigned above.
--    create_role_account() does not mention `reference`, so the default applies
--    without touching that function.
-- ---------------------------------------------------------------------------

alter table public.admins
  alter column reference set default 'TPC-A-' || lpad(nextval('public.account_reference_seq')::text, 3, '0');
alter table public.staff
  alter column reference set default 'TPC-S-' || lpad(nextval('public.account_reference_seq')::text, 3, '0');
alter table public.technicians
  alter column reference set default 'TPC-T-' || lpad(nextval('public.account_reference_seq')::text, 3, '0');

-- ---------------------------------------------------------------------------
-- 5. A code identifies exactly one account.
--
--    The shared sequence already prevents collisions; these make it an error
--    rather than a silent duplicate if a code is ever written by hand.
-- ---------------------------------------------------------------------------

create unique index if not exists admins_reference_key      on public.admins (reference);
create unique index if not exists staff_reference_key       on public.staff (reference);
create unique index if not exists technicians_reference_key on public.technicians (reference);

-- ---------------------------------------------------------------------------
-- 6. Let the app read the new column.
--
--    These tables are granted COLUMN BY COLUMN, not table-wide, because they
--    also hold `password` and `password_hash`. A new column is therefore
--    invisible to the app until it is named in a grant — which is why adding
--    `reference` produced:
--
--      permission denied for table admins  [42501]
--
--    Postgres reports a column-level denial as if the whole table were denied,
--    and Supabase then suggests `GRANT SELECT ON public.admins TO anon`.
--    DO NOT DO THAT. Table-wide select would expose the password hashes to
--    anyone holding the publishable key. Re-grant the explicit list instead,
--    exactly as migration 018 did.
-- ---------------------------------------------------------------------------

grant select (id, name, username, reference, phone, email, status, is_primary, created_at, updated_at, last_login_at, avatar_url)
  on public.admins to anon, authenticated;
grant select (id, name, username, reference, phone, email, status, created_at, updated_at, last_login_at, avatar_url)
  on public.staff to anon, authenticated;
grant select (id, name, username, reference, phone, email, status, created_at, updated_at, last_login_at, avatar_url)
  on public.technicians to anon, authenticated;

-- The column defaults call nextval(), so inserting an account needs the
-- sequence as well.
grant usage, select on sequence public.account_reference_seq to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select reference, name, 'admin' as role from public.admins
--   union all select reference, name, 'staff' from public.staff
--   union all select reference, name, 'technician' from public.technicians
--   order by reference;
--
--   Every row should have a code, and no number should appear twice.
-- ---------------------------------------------------------------------------
