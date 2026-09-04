-- Migration 011 — use admins, staff, and technicians as account storage
--
-- Run this only after schema-v2.sql and migrations 008-010. Back up the
-- database first. This preserves rows from public.users, then removes the
-- unified table so the three role tables are the only account source.

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(), name text not null, phone text,
  email text not null unique, password text not null default '', status account_status not null default 'ACTIVE',
  is_primary boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(), name text not null, phone text,
  email text not null unique, password text not null default '', status account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.technicians (
  id uuid primary key default gen_random_uuid(), name text not null, phone text,
  email text not null unique, password text not null default '', status account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.admins add column if not exists username text;
alter table public.staff add column if not exists username text;
alter table public.technicians add column if not exists username text;
alter table public.admins add column if not exists password_hash text;
alter table public.staff add column if not exists password_hash text;
alter table public.technicians add column if not exists password_hash text;
alter table public.admins add column if not exists last_login_at timestamptz;
alter table public.staff add column if not exists last_login_at timestamptz;
alter table public.technicians add column if not exists last_login_at timestamptz;

do $$
begin
  if to_regclass('public.users') is not null then
    insert into public.admins (id, name, username, phone, email, password, password_hash, status, is_primary, created_at, updated_at, last_login_at)
    select u.id, u.name, u.username, u.phone, u.email, coalesce(a.password, ''), u.password_hash, u.status::text::account_status, u.is_primary, u.created_at, u.updated_at, u.last_login_at
    from public.users u left join public.admins a on a.id = u.id where u.role = 'ADMIN'
    on conflict (id) do update set username = excluded.username, password_hash = excluded.password_hash, password = case when excluded.password <> '' then excluded.password else public.admins.password end;

    insert into public.staff (id, name, username, phone, email, password, password_hash, status, created_at, updated_at, last_login_at)
    select u.id, u.name, u.username, u.phone, u.email, coalesce(s.password, ''), u.password_hash, u.status::text::account_status, u.created_at, u.updated_at, u.last_login_at
    from public.users u left join public.staff s on s.id = u.id where u.role = 'STAFF'
    on conflict (id) do update set username = excluded.username, password_hash = excluded.password_hash, password = case when excluded.password <> '' then excluded.password else public.staff.password end;

    insert into public.technicians (id, name, username, phone, email, password, password_hash, status, created_at, updated_at, last_login_at)
    select u.id, u.name, u.username, u.phone, u.email, coalesce(t.password, ''), u.password_hash, u.status::text::account_status, u.created_at, u.updated_at, u.last_login_at
    from public.users u left join public.technicians t on t.id = u.id where u.role = 'TECHNICIAN'
    on conflict (id) do update set username = excluded.username, password_hash = excluded.password_hash, password = case when excluded.password <> '' then excluded.password else public.technicians.password end;
  end if;
end $$;

-- Existing users rows use password_hash. New role-table rows may use the
-- legacy password column until the application is fully migrated.
alter table public.sessions drop constraint if exists sessions_user_id_fkey;
alter table public.sessions add column if not exists user_role text;

alter table public.clients drop constraint if exists clients_created_by_fkey;
alter table public.clients drop constraint if exists clients_archived_by_fkey;
alter table public.client_documents drop constraint if exists client_documents_uploaded_by_fkey;
alter table public.inventory drop constraint if exists inventory_created_by_fkey;
alter table public.inventory_movements drop constraint if exists inventory_movements_actor_id_fkey;

-- The application uses security-definer login/session functions and must not
-- expose password columns through ordinary table reads.
alter table public.admins enable row level security;
alter table public.staff enable row level security;
alter table public.technicians enable row level security;

drop policy if exists "Role account access" on public.admins;
drop policy if exists "Role account access" on public.staff;
drop policy if exists "Role account access" on public.technicians;
create policy "Role account access" on public.admins for all using (true) with check (true);
create policy "Role account access" on public.staff for all using (true) with check (true);
create policy "Role account access" on public.technicians for all using (true) with check (true);

revoke all on public.admins from anon, authenticated;
revoke all on public.staff from anon, authenticated;
revoke all on public.technicians from anon, authenticated;
grant select (id, name, username, phone, email, status, is_primary, created_at, updated_at, last_login_at)
  on public.admins to anon, authenticated;
grant select (id, name, username, phone, email, status, created_at, updated_at, last_login_at)
  on public.staff to anon, authenticated;
grant select (id, name, username, phone, email, status, created_at, updated_at, last_login_at)
  on public.technicians to anon, authenticated;
grant insert, update, delete on public.admins, public.staff, public.technicians to anon, authenticated;

drop function if exists public.check_login(text, text);
create or replace function public.check_login(login_identifier text, login_password text)
returns table(token uuid, id uuid, name text, email text, username text, phone text, role text, status account_status)
language plpgsql security definer set search_path = public
as $$
declare found record; new_token uuid;
begin
  select * into found from (
    select a.id, a.name, a.username, a.phone, a.email, a.password, a.password_hash, a.status, a.is_primary, a.created_at, a.updated_at, a.last_login_at, 'ADMIN'::text as role_name from admins a where lower(a.email)=lower(login_identifier) or lower(a.username)=lower(login_identifier)
    union all select s.id, s.name, s.username, s.phone, s.email, s.password, s.password_hash, s.status, false, s.created_at, s.updated_at, s.last_login_at, 'STAFF'::text from staff s where lower(s.email)=lower(login_identifier) or lower(s.username)=lower(login_identifier)
    union all select t.id, t.name, t.username, t.phone, t.email, t.password, t.password_hash, t.status, false, t.created_at, t.updated_at, t.last_login_at, 'TECHNICIAN'::text from technicians t where lower(t.email)=lower(login_identifier) or lower(t.username)=lower(login_identifier)
  ) accounts
  where accounts.status in ('ACTIVE', 'PENDING')
    and (password = login_password or password_hash = crypt(login_password, password_hash))
  limit 1;
  if found.id is null then return; end if;
  execute format(
    'update %I set status = ''ACTIVE'', last_login_at = now() where id = $1',
    case found.role_name when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  ) using found.id;
  insert into sessions (user_id, user_role) values (found.id, found.role_name) returning sessions.token into new_token;
  return query select new_token, found.id, found.name, found.email, coalesce(found.username, found.email), found.phone, found.role_name, 'ACTIVE'::account_status;
end;
$$;

drop function if exists public.validate_session(uuid);
create or replace function public.validate_session(session_token uuid)
returns table(id uuid, name text, username text, email text, phone text, role text, status account_status, is_primary boolean, last_login_at timestamptz, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select a.id, a.name, coalesce(a.username, a.email), a.email, a.phone, 'ADMIN', a.status, a.is_primary, a.last_login_at, a.created_at, a.updated_at from sessions s join admins a on a.id=s.user_id where s.token=session_token and s.user_role='ADMIN' and a.status='ACTIVE'
  union all select a.id, a.name, coalesce(a.username, a.email), a.email, a.phone, 'STAFF', a.status, false, a.last_login_at, a.created_at, a.updated_at from sessions s join staff a on a.id=s.user_id where s.token=session_token and s.user_role='STAFF' and a.status='ACTIVE'
  union all select a.id, a.name, coalesce(a.username, a.email), a.email, a.phone, 'TECHNICIAN', a.status, false, a.last_login_at, a.created_at, a.updated_at from sessions s join technicians a on a.id=s.user_id where s.token=session_token and s.user_role='TECHNICIAN' and a.status='ACTIVE';
$$;

create or replace function public.change_password(session_token uuid, current_password text, new_password text)
returns void language plpgsql security definer set search_path = public
as $$
declare caller record;
begin
  select * into caller from (
    select a.id, a.email, a.password, a.password_hash, 'admins'::text as table_name from sessions s join admins a on a.id=s.user_id where s.token=session_token and s.user_role='ADMIN' and a.status='ACTIVE'
    union all select a.id, a.email, a.password, a.password_hash, 'staff'::text from sessions s join staff a on a.id=s.user_id where s.token=session_token and s.user_role='STAFF' and a.status='ACTIVE'
    union all select a.id, a.email, a.password, a.password_hash, 'technicians'::text from sessions s join technicians a on a.id=s.user_id where s.token=session_token and s.user_role='TECHNICIAN' and a.status='ACTIVE'
  ) account limit 1;
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if caller.password <> current_password and caller.password_hash <> crypt(current_password, caller.password_hash) then raise exception 'Current password is incorrect.'; end if;
  execute format('update %I set password = $1, password_hash = null where id = $2', caller.table_name) using new_password, caller.id;
end;
$$;

create or replace function public.reset_password(session_token uuid, target_id uuid, new_password text)
returns void language plpgsql security definer set search_path = public
as $$
declare caller record; target_table text;
begin
  select * into caller from (
    select a.id, 'ADMIN'::text as role_name from sessions s join admins a on a.id=s.user_id where s.token=session_token and s.user_role='ADMIN' and a.status='ACTIVE'
  ) account limit 1;
  if caller.id is null then raise exception 'Only an active administrator can reset passwords.'; end if;
  select case when exists (select 1 from admins where id=target_id) then 'admins' when exists (select 1 from staff where id=target_id) then 'staff' when exists (select 1 from technicians where id=target_id) then 'technicians' end into target_table;
  if target_table is null then raise exception 'Account not found.'; end if;
  execute format('update %I set password = $1, password_hash = null where id = $2', target_table) using new_password, target_id;
end;
$$;

grant execute on function public.change_password(uuid, text, text) to anon, authenticated;
grant execute on function public.reset_password(uuid, uuid, text) to anon, authenticated;

-- Remove v2 objects whose signatures return or accept the users composite
-- type. Dropping them explicitly avoids DROP ... CASCADE deleting unrelated
-- objects.
do $$
begin
  if to_regclass('public.users') is not null then
    drop trigger if exists users_invalidate_sessions on public.users;
    drop trigger if exists users_set_updated_at on public.users;
    drop function if exists public.invalidate_sessions_on_account_change();
    drop function if exists public.get_session_user(uuid);
    drop function if exists public.can_manage_users(users);
    drop function if exists public.write_log(users, text, log_type);
    drop function if exists public.create_user(uuid, text, text, text, text, text, user_role);
    drop function if exists public.update_user(uuid, uuid, text, text, text, user_role);
    drop function if exists public.update_user(uuid, uuid, text, text, text, user_role, text);
    drop function if exists public.set_user_status(uuid, uuid, account_status);
  end if;
end $$;
alter table public.system_logs drop constraint if exists system_logs_actor_id_fkey;

drop table if exists public.users;
notify pgrst, 'reload schema';