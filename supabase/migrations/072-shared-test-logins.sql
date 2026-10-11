-- ---------------------------------------------------------------------------
-- Migration 072 - let chosen accounts be signed in on several devices.
--
-- Run after 071-paid-invoice-covers-booking.sql.
--
-- check_login() (046) ends every other session of an account when it signs
-- in, so an account is only ever signed in on one device. For a class
-- testing the system together, many people sign in to the same test account
-- at once and kept knocking each other out.
--
-- shared_login_accounts lists the accounts exempt from that: signing in to
-- one of them leaves its other sessions alone. This run lists the test
-- accounts pestStaff and pestTech. Every other account keeps the one-device
-- rule, and deactivating an account or changing its password still ends all
-- of its sessions (those paths are untouched).
--
-- To turn it off again (one device per account for everyone):
--   delete from public.shared_login_accounts;
-- To allow another account:
--   insert into public.shared_login_accounts (id, note)
--   select id, 'why' from public.staff where username = '<username>';
--
-- This is now the source of truth for check_login (from 046; re-running 046
-- restores the version that ends every other session, so re-run 072 after
-- it). It keeps 043's search_path with extensions.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create table if not exists public.shared_login_accounts (
  id       uuid primary key,
  note     text,
  added_at timestamptz not null default now()
);

comment on table public.shared_login_accounts is
  'Accounts that may be signed in on several devices at once (check_login leaves their other sessions alone). Empty = one device per account for everyone.';

-- Read and written only by check_login and by hand in the SQL editor.
alter table public.shared_login_accounts enable row level security;
revoke all on public.shared_login_accounts from anon, authenticated;

insert into public.shared_login_accounts (id, note)
select s.id, 'Test account shared by the testing class' from public.staff s where lower(s.username) = 'peststaff'
union all
select t.id, 'Test account shared by the testing class' from public.technicians t where lower(t.username) = 'pesttech'
on conflict (id) do nothing;

create or replace function public.check_login(login_identifier text, login_password text)
returns table(token uuid, id uuid, name text, email text, username text, phone text, role text, status account_status)
language plpgsql security definer set search_path = public, extensions
as $$
declare found record; new_token uuid;
begin
  if nullif(login_password, '') is null then return; end if;
  if nullif(login_identifier, '') is null then return; end if;

  select * into found from (
    select a.id, a.name, a.username, a.phone, a.email, a.password, a.password_hash, a.status, 'ADMIN'::text role_name
      from admins a where lower(a.email)=lower(login_identifier) or lower(a.username)=lower(login_identifier)
    union all
    select s.id, s.name, s.username, s.phone, s.email, s.password, s.password_hash, s.status, 'STAFF'::text
      from staff s where lower(s.email)=lower(login_identifier) or lower(s.username)=lower(login_identifier)
    union all
    select t.id, t.name, t.username, t.phone, t.email, t.password, t.password_hash, t.status, 'TECHNICIAN'::text
      from technicians t where lower(t.email)=lower(login_identifier) or lower(t.username)=lower(login_identifier)
  ) accounts
  where accounts.status in ('ACTIVE', 'PENDING')
    and (
      (nullif(accounts.password, '') is not null and accounts.password = login_password)
      or
      (nullif(accounts.password_hash, '') is not null
       and accounts.password_hash = crypt(login_password, accounts.password_hash))
    )
  limit 1;
  if found.id is null then return; end if;

  execute format(
    'update %I set status = ''ACTIVE'', last_login_at = now() where id = $1',
    case found.role_name when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  ) using found.id;
  -- One device per account, except the accounts listed as shared.
  if not exists (select 1 from public.shared_login_accounts sla where sla.id = found.id) then
    delete from sessions where user_id = found.id;
  end if;
  insert into sessions (user_id, user_role) values (found.id, found.role_name) returning sessions.token into new_token;
  return query select new_token, found.id, found.name, found.email, coalesce(found.username, found.email), found.phone, found.role_name, 'ACTIVE'::account_status;
end;
$$;

grant execute on function public.check_login(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--   select * from public.shared_login_accounts;   -- expect 2 rows
--   Sign in as pestStaff in two browsers: both stay signed in.
--   Sign in as any other account in two browsers: the first is signed out.
-- ---------------------------------------------------------------------------
