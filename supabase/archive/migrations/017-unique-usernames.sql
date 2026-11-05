-- ============================================================================
-- Torres Pest Control — Migration 017 (Unique Usernames)
-- ============================================================================
-- Usernames are shared by every role because all accounts live in
-- public.users. Enforce that rule in the database as well as in the form so
-- concurrent account creation and direct RPC calls cannot create duplicates.

do $$
begin
  if exists (
    select lower(btrim(username)) from (
      select username from public.admins
      union all select username from public.staff
      union all select username from public.technicians
    ) accounts
    where username is not null
    group by lower(btrim(username))
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce unique usernames: duplicate usernames already exist across role tables. Rename the duplicates before rerunning this migration.';
  end if;
end;
$$;

-- `btrim` keeps "alex", " Alex ", and "ALEX" from becoming distinct login
-- identities. The index is the authoritative safeguard for every role.
-- Each role table has its own normalized uniqueness index. The duplicate check
-- above enforces the cross-role rule before these indexes are created.
create unique index if not exists admins_username_normalized_unique_idx
  on public.admins (lower(btrim(username))) where username is not null;
create unique index if not exists staff_username_normalized_unique_idx
  on public.staff (lower(btrim(username))) where username is not null;
create unique index if not exists technicians_username_normalized_unique_idx
  on public.technicians (lower(btrim(username))) where username is not null;

notify pgrst, 'reload schema';
