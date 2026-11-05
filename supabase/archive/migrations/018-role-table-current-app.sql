-- Migration 018 — Make the current app use separate role tables.
-- Run after migrations 001-017, including 011-use-role-account-tables.
-- Existing account IDs are preserved. This migration does not drop data.

alter table public.admins add column if not exists avatar_url text;
alter table public.staff add column if not exists avatar_url text;
alter table public.technicians add column if not exists avatar_url text;

grant select (id, name, username, phone, email, status, is_primary, created_at, updated_at, last_login_at, avatar_url)
  on public.admins to anon, authenticated;
grant select (id, name, username, phone, email, status, created_at, updated_at, last_login_at, avatar_url)
  on public.staff to anon, authenticated;
grant select (id, name, username, phone, email, status, created_at, updated_at, last_login_at, avatar_url)
  on public.technicians to anon, authenticated;

create unique index if not exists admins_username_normalized_unique_idx
  on public.admins (lower(btrim(username))) where username is not null;
create unique index if not exists staff_username_normalized_unique_idx
  on public.staff (lower(btrim(username))) where username is not null;
create unique index if not exists technicians_username_normalized_unique_idx
  on public.technicians (lower(btrim(username))) where username is not null;

create or replace function public.role_account_for_session(session_token uuid)
returns table(id uuid, role_name text)
language sql stable security definer set search_path = public
as $$
  select a.id, 'ADMIN'::text from sessions s join admins a on a.id = s.user_id
    where s.token = session_token and s.user_role = 'ADMIN' and s.expires_at > now() and a.status = 'ACTIVE'
  union all
  select a.id, 'STAFF'::text from sessions s join staff a on a.id = s.user_id
    where s.token = session_token and s.user_role = 'STAFF' and s.expires_at > now() and a.status = 'ACTIVE'
  union all
  select a.id, 'TECHNICIAN'::text from sessions s join technicians a on a.id = s.user_id
    where s.token = session_token and s.user_role = 'TECHNICIAN' and s.expires_at > now() and a.status = 'ACTIVE';
$$;

create or replace function public.create_role_account(
  session_token uuid, new_name text, new_username text, new_email text,
  new_phone text, new_password text, new_role text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller_id uuid; caller_role text; created jsonb;
begin
  select id, role_name into caller_id, caller_role from role_account_for_session(session_token) limit 1;
  if caller_id is null or caller_role <> 'ADMIN' then raise exception 'You do not have permission to create accounts.'; end if;
  if upper(new_role) not in ('STAFF', 'TECHNICIAN') then raise exception 'Only Staff and Technician accounts can be created.'; end if;
  if exists (select 1 from admins where lower(email)=lower(new_email) or lower(username)=lower(new_username))
     or exists (select 1 from staff where lower(email)=lower(new_email) or lower(username)=lower(new_username))
     or exists (select 1 from technicians where lower(email)=lower(new_email) or lower(username)=lower(new_username)) then
    raise exception 'That email or username is already used by another account.';
  end if;
  if upper(new_role) = 'STAFF' then
    insert into staff (name, username, email, phone, password, password_hash, status) values
      (new_name, new_username, new_email, new_phone, '', crypt(new_password, gen_salt('bf')), 'ACTIVE') returning to_jsonb(staff.*) into created;
  else
    insert into technicians (name, username, email, phone, password, password_hash, status) values
      (new_name, new_username, new_email, new_phone, '', crypt(new_password, gen_salt('bf')), 'ACTIVE') returning to_jsonb(technicians.*) into created;
  end if;
  return created || jsonb_build_object('role', upper(new_role));
end;
$$;

grant execute on function public.create_role_account(uuid,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.update_role_account(
  session_token uuid, target_id uuid, new_name text, new_email text,
  new_phone text, new_role text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller_id uuid; caller_role text; target_role text; updated jsonb;
begin
  select id, role_name into caller_id, caller_role from role_account_for_session(session_token) limit 1;
  if caller_id is null then raise exception 'Not signed in.'; end if;
  select role_name into target_role from (
    select id, 'ADMIN'::text role_name from admins union all
    select id, 'STAFF'::text from staff union all select id, 'TECHNICIAN'::text from technicians
  ) accounts where id = target_id;
  if target_role is null then raise exception 'Account not found.'; end if;
  if caller_id <> target_id and caller_role <> 'ADMIN' then raise exception 'You do not have permission to edit accounts.'; end if;
  if target_role = 'ADMIN' and caller_id <> target_id then raise exception 'Admins cannot modify other Admins.'; end if;
  if upper(new_role) <> target_role then raise exception 'Role changes are not supported with separate role tables.'; end if;
  if exists (select 1 from admins where id <> target_id and lower(email)=lower(new_email))
     or exists (select 1 from staff where id <> target_id and lower(email)=lower(new_email))
     or exists (select 1 from technicians where id <> target_id and lower(email)=lower(new_email)) then
    raise exception 'That email is already used by another account.';
  end if;
  if target_role = 'ADMIN' then
    update admins set name=new_name, email=new_email, phone=new_phone where id=target_id returning to_jsonb(admins.*) into updated;
  elsif target_role = 'STAFF' then
    update staff set name=new_name, email=new_email, phone=new_phone where id=target_id returning to_jsonb(staff.*) into updated;
  else
    update technicians set name=new_name, email=new_email, phone=new_phone where id=target_id returning to_jsonb(technicians.*) into updated;
  end if;
  return updated || jsonb_build_object('role', target_role);
end;
$$;

grant execute on function public.update_role_account(uuid,uuid,text,text,text,text) to anon, authenticated;

create or replace function public.set_role_account_status(session_token uuid, target_id uuid, new_status account_status)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller_id uuid; caller_role text; target_role text; updated jsonb; active_admins integer;
begin
  select id, role_name into caller_id, caller_role from role_account_for_session(session_token) limit 1;
  if caller_id is null or caller_role <> 'ADMIN' then raise exception 'You do not have permission to change account status.'; end if;
  select role_name into target_role from (
    select id, 'ADMIN'::text role_name from admins union all select id, 'STAFF'::text from staff union all select id, 'TECHNICIAN'::text from technicians
  ) accounts where id=target_id;
  if target_role is null then raise exception 'Account not found.'; end if;
  if target_role = 'ADMIN' then
    select count(*) into active_admins from admins where status='ACTIVE';
    if new_status <> 'ACTIVE' and active_admins <= 1 then raise exception 'At least one active admin account is required.'; end if;
    if caller_id <> target_id then raise exception 'Admins cannot change the status of other Admins.'; end if;
    update admins set status=new_status where id=target_id returning to_jsonb(admins.*) into updated;
  elsif target_role = 'STAFF' then update staff set status=new_status where id=target_id returning to_jsonb(staff.*) into updated;
  else update technicians set status=new_status where id=target_id returning to_jsonb(technicians.*) into updated;
  end if;
  if new_status <> 'ACTIVE' then delete from sessions where user_id=target_id; end if;
  return updated || jsonb_build_object('role', target_role);
end;
$$;

grant execute on function public.set_role_account_status(uuid,uuid,account_status) to anon, authenticated;

create or replace function public.update_role_account_avatar(session_token uuid, target_id uuid, new_avatar_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare caller_id uuid; target_role text; updated jsonb;
begin
  select id into caller_id from role_account_for_session(session_token) limit 1;
  if caller_id is null or caller_id <> target_id then raise exception 'You can only update your own profile picture.'; end if;
  select role_name into target_role from (
    select id, 'ADMIN'::text role_name from admins union all select id, 'STAFF'::text from staff union all select id, 'TECHNICIAN'::text from technicians
  ) accounts where id=target_id;
  if target_role = 'ADMIN' then update admins set avatar_url=nullif(new_avatar_url,'') where id=target_id returning to_jsonb(admins.*) into updated;
  elsif target_role = 'STAFF' then update staff set avatar_url=nullif(new_avatar_url,'') where id=target_id returning to_jsonb(staff.*) into updated;
  else update technicians set avatar_url=nullif(new_avatar_url,'') where id=target_id returning to_jsonb(technicians.*) into updated;
  end if;
  return updated || jsonb_build_object('role', target_role);
end;
$$;

grant execute on function public.update_role_account_avatar(uuid,uuid,text) to anon, authenticated;

-- Replace the old schema-v2 validate_session function. That version calls
-- get_session_user(), whose return type was the removed users composite.
drop function if exists public.validate_session(uuid);
create or replace function public.validate_session(session_token uuid)
returns table(
  id uuid, name text, username text, email text, phone text, role text,
  status account_status, is_primary boolean, last_login_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.name, coalesce(a.username, a.email), a.email, a.phone,
         'ADMIN'::text, a.status, a.is_primary, a.last_login_at, a.created_at, a.updated_at
    from sessions s join admins a on a.id = s.user_id
   where s.token = session_token and s.user_role = 'ADMIN' and s.expires_at > now() and a.status = 'ACTIVE'
  union all
  select a.id, a.name, coalesce(a.username, a.email), a.email, a.phone,
         'STAFF'::text, a.status, false, a.last_login_at, a.created_at, a.updated_at
    from sessions s join staff a on a.id = s.user_id
   where s.token = session_token and s.user_role = 'STAFF' and s.expires_at > now() and a.status = 'ACTIVE'
  union all
  select a.id, a.name, coalesce(a.username, a.email), a.email, a.phone,
         'TECHNICIAN'::text, a.status, false, a.last_login_at, a.created_at, a.updated_at
    from sessions s join technicians a on a.id = s.user_id
   where s.token = session_token and s.user_role = 'TECHNICIAN' and s.expires_at > now() and a.status = 'ACTIVE';
$$;
grant execute on function public.validate_session(uuid) to anon, authenticated;

drop function if exists public.check_login(text, text);
create or replace function public.check_login(login_identifier text, login_password text)
returns table(token uuid, id uuid, name text, email text, username text, phone text, role text, status account_status)
language plpgsql security definer set search_path = public
as $$
declare found record; new_token uuid;
begin
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
    and (accounts.password = login_password or accounts.password_hash = crypt(login_password, accounts.password_hash))
  limit 1;
  if found.id is null then return; end if;

  execute format(
    'update %I set status = ''ACTIVE'', last_login_at = now() where id = $1',
    case found.role_name when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  ) using found.id;
  delete from sessions where user_id = found.id;
  insert into sessions (user_id, user_role) values (found.id, found.role_name) returning sessions.token into new_token;
  return query select new_token, found.id, found.name, found.email, coalesce(found.username, found.email), found.phone, found.role_name, 'ACTIVE'::account_status;
end;
$$;
grant execute on function public.check_login(text,text) to anon, authenticated;

create or replace function public.has_role_table_session()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from role_account_for_session(
      nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid
    )
  );
$$;

drop policy if exists "Read clients" on public.clients;
drop policy if exists "Write clients" on public.clients;
create policy "Read clients" on public.clients for select using (public.has_role_table_session());
create policy "Write clients" on public.clients for all using (public.has_role_table_session()) with check (public.has_role_table_session());

drop policy if exists "Read documents" on public.client_documents;
drop policy if exists "Write documents" on public.client_documents;
create policy "Read documents" on public.client_documents for select using (public.has_role_table_session());
create policy "Write documents" on public.client_documents for all using (public.has_role_table_session()) with check (public.has_role_table_session());

drop policy if exists "Read inventory" on public.inventory;
drop policy if exists "Write inventory" on public.inventory;
create policy "Read inventory" on public.inventory for select using (public.has_role_table_session());
create policy "Write inventory" on public.inventory for all using (public.has_role_table_session()) with check (public.has_role_table_session());

-- The role-table copy is now authoritative. Remove old unified-table objects
-- and the obsolete users table only after the role tables are in place.
do $$
declare unmigrated text;
begin
  if to_regclass('public.users') is not null then
    -- Recovery pass for databases where migration 011 was interrupted or
    -- skipped some rows. Conflicting rows are left in users for the guard
    -- below to report rather than being overwritten or deleted.
    insert into public.admins (id, name, username, email, phone, password, password_hash, status, is_primary, created_at, updated_at, last_login_at, avatar_url)
      select id, name, username, email, phone, '', password_hash, status, is_primary, created_at, updated_at, last_login_at, avatar_url
      from public.users where role = 'ADMIN'
      on conflict do nothing;
    insert into public.staff (id, name, username, email, phone, password, password_hash, status, created_at, updated_at, last_login_at, avatar_url)
      select id, name, username, email, phone, '', password_hash, status, created_at, updated_at, last_login_at, avatar_url
      from public.users where role = 'STAFF'
      on conflict do nothing;
    insert into public.technicians (id, name, username, email, phone, password, password_hash, status, created_at, updated_at, last_login_at, avatar_url)
      select id, name, username, email, phone, '', password_hash, status, created_at, updated_at, last_login_at, avatar_url
      from public.users where role = 'TECHNICIAN'
      on conflict do nothing;

    if exists (
      select 1 from public.users u
      where not exists (select 1 from public.admins a where a.id = u.id)
        and not exists (select 1 from public.staff s where s.id = u.id)
        and not exists (select 1 from public.technicians t where t.id = u.id)
    ) then
      select string_agg(
        format('%s | %s | %s | role=%s | email match=%s | username match=%s',
          u.id,
          coalesce(u.name, '(no name)'),
          coalesce(u.email, '(no email)'),
          u.role,
          case when exists (
            select 1 from admins a where lower(a.email) = lower(u.email)
              and a.id <> u.id
            union all select 1 from staff s where lower(s.email) = lower(u.email)
              and s.id <> u.id
            union all select 1 from technicians t where lower(t.email) = lower(u.email)
              and t.id <> u.id
          ) then 'yes' else 'no' end,
          case when exists (
            select 1 from admins a where lower(a.username) = lower(u.username)
              and a.id <> u.id
            union all select 1 from staff s where lower(s.username) = lower(u.username)
              and s.id <> u.id
            union all select 1 from technicians t where lower(t.username) = lower(u.username)
              and t.id <> u.id
          ) then 'yes' else 'no' end
        ), E'\n'
      ) into unmigrated
      from public.users u
      where not exists (select 1 from public.admins a where a.id = u.id)
        and not exists (select 1 from public.staff s where s.id = u.id)
        and not exists (select 1 from public.technicians t where t.id = u.id);
      raise exception 'Cannot remove users. Resolve these accounts first:%', E'\n' || unmigrated;
    end if;

    alter table public.sessions drop constraint if exists sessions_user_id_fkey;
    alter table public.clients drop constraint if exists clients_created_by_fkey;
    alter table public.clients drop constraint if exists clients_archived_by_fkey;
    alter table public.client_documents drop constraint if exists client_documents_uploaded_by_fkey;
    alter table public.inventory drop constraint if exists inventory_created_by_fkey;
    alter table public.inventory_movements drop constraint if exists inventory_movements_actor_id_fkey;
    alter table public.system_logs drop constraint if exists system_logs_actor_id_fkey;

    drop policy if exists "Read users" on public.users;
    drop function if exists public.get_header_session_user();
    drop function if exists public.get_header_session_role();
    drop function if exists public.get_session_user(uuid);
    drop function if exists public.update_user_avatar(uuid, uuid, text);
    drop function if exists public.can_manage_users(users);
    drop function if exists public.write_log(users, text, log_type);
    drop function if exists public.create_user(uuid, text, text, text, text, text, user_role);
    drop function if exists public.update_user(uuid, uuid, text, text, text, user_role);
    drop function if exists public.update_user(uuid, uuid, text, text, text, user_role, text);
    drop function if exists public.set_user_status(uuid, uuid, account_status);

    drop table public.users;
  end if;
end;
$$;

notify pgrst, 'reload schema';
