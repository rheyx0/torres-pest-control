-- ---------------------------------------------------------------------------
-- Migration 044 - Repair reset_password, and stop empty passwords logging in.
--
-- Run after 043-pgcrypto-search-path.sql.
--
-- THREE THINGS, all in the password path.
--
-- ===========================================================================
-- 1. reset_password() was pointing at a table that no longer exists
-- ===========================================================================
--
--   Symptom: an admin resetting a user's password gets
--     ERROR: type "users" does not exist   (LINE: caller users;)
--
--   Migration 011 defined reset_password() against the three role tables.
--   Migration 013 then REPLACED it with a version written for the old
--   public.users table, calling get_session_user(), can_manage_users() and
--   write_log() — all of which belong to the v1 world that 018 removes.
--
--   That inversion was harmless only by accident: 011 used to drop
--   public.users at the end of itself, so 013 failed outright and never
--   installed its version. Migration "Make a database buildable from scratch"
--   removed that premature drop so 013/014/015 could run at all — which they
--   now do, and 013's users-based reset_password is what survives to the end
--   of the chain. Fixing the build broke this function. It is the only
--   casualty: every other function 013/014/015 define is redefined later by
--   018, which is why nothing else regressed.
--
--   Restored here against the role tables, following the conventions
--   migration 037 already established for the forgot-password flow: hash with
--   bcrypt, mark the account PENDING, drop its sessions, write an audit line.
--   Note the account going PENDING means it cannot be assigned to an
--   appointment until its owner signs in again, which flips it back to
--   ACTIVE. That is 037's existing behaviour, kept deliberately so both reset
--   paths behave the same way.
--
-- ===========================================================================
-- 2. An empty password logged in as anybody  (the serious one)
-- ===========================================================================
--
--   check_login() accepted an account when
--
--     accounts.password = login_password  OR  password_hash = crypt(...)
--
--   `password` is the legacy plaintext column. create_role_account() writes
--   '' into it for every account the app creates, and '' = '' is true — so
--   any account created through Add User could be signed into by sending its
--   username and an empty password. check_login is granted to anon, so this
--   needed nothing but the publishable key and a username.
--
--   Verified before and after on a database built from these files.
--
--   Both credential columns must now be non-empty to match, and a blank
--   submitted password is rejected outright. The plaintext branch is kept —
--   accounts reset by the old 011 function have a plaintext password and no
--   hash, and removing it would lock them out — but it can no longer fire on
--   an empty string.
--
-- ===========================================================================
-- 3. A reset left the old password working
-- ===========================================================================
--
--   Both reset paths only ever wrote password_hash. If an account also had a
--   plaintext `password` (anything reset by the 011 function, or migrated
--   from v1), that old value kept authenticating through the first branch
--   above — a password reset that does not revoke the old password. Both
--   paths now clear it.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. reset_password, against the role tables
-- ---------------------------------------------------------------------------

create or replace function public.reset_password(
  session_token uuid,
  target_id uuid,
  new_password text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  caller_id uuid;
  caller_role text;
  caller_name text;
  target_role text;
  target_name text;
  target_table text;
begin
  select r.id, r.role_name into caller_id, caller_role
  from public.role_account_for_session(session_token) r
  limit 1;
  if caller_id is null then raise exception 'Not signed in.'; end if;
  if caller_role <> 'ADMIN' then
    raise exception 'You do not have permission to reset passwords.';
  end if;

  select a.name into caller_name from public.admins a where a.id = caller_id;

  select accounts.role_name, accounts.name into target_role, target_name
  from (
    select id, name, 'ADMIN'::text role_name from public.admins
    union all select id, name, 'STAFF'::text from public.staff
    union all select id, name, 'TECHNICIAN'::text from public.technicians
  ) accounts
  where accounts.id = target_id;
  if target_role is null then raise exception 'Account not found.'; end if;

  -- Migration 014's rule, carried over: one admin may not act on another.
  -- Resetting your own password this way is still allowed.
  if target_role = 'ADMIN' and caller_id <> target_id then
    raise exception 'You cannot reset the password of another Admin.';
  end if;

  if new_password is null
     or length(new_password) < 6
     or new_password !~ '[A-Za-z]'
     or new_password !~ '[0-9]' then
    raise exception 'Password must be at least 6 characters and include a letter and a number.';
  end if;

  target_table := case target_role
    when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end;

  -- password = '' clears any legacy plaintext credential, so the old password
  -- stops working the moment the new one is set. See note 3 in the header.
  execute format(
    'update %I set password_hash = crypt($1, gen_salt(''bf'')), password = '''', status = ''PENDING'' where id = $2',
    target_table
  ) using new_password, target_id;

  delete from public.sessions where sessions.user_id = target_id;

  insert into public.system_logs (actor_id, actor_name, message, type)
  values (caller_id, coalesce(caller_name, 'Administrator'),
          format('Reset the password for %s.', target_name), 'auth');
end;
$$;

grant execute on function public.reset_password(uuid, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. check_login, refusing empty credentials
--
--    Otherwise identical to the migration 018 definition: same signature,
--    same lookup by email or username, same PENDING-to-ACTIVE promotion, same
--    single-session-per-account behaviour.
-- ---------------------------------------------------------------------------

create or replace function public.check_login(login_identifier text, login_password text)
returns table(token uuid, id uuid, name text, email text, username text, phone text, role text, status account_status)
language plpgsql security definer set search_path = public, extensions
as $$
declare found record; new_token uuid;
begin
  -- No password, no login. Guards the whole function rather than relying on
  -- the comparisons below, so a null or blank can never reach them.
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
      -- Legacy plaintext credential, but never an empty one.
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
  delete from sessions where user_id = found.id;
  insert into sessions (user_id, user_role) values (found.id, found.role_name) returning sessions.token into new_token;
  return query select new_token, found.id, found.name, found.email, coalesce(found.username, found.email), found.phone, found.role_name, 'ACTIVE'::account_status;
end;
$$;

grant execute on function public.check_login(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. request_password_reset, clearing the plaintext column too
--
--    The migration 037 definition with one addition: `password = ''` in the
--    UPDATE. Everything else, including the deliberate silence when no
--    account matches (so the caller cannot enumerate registered emails), is
--    unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.request_password_reset(target_email text)
returns table (user_id uuid, user_name text, user_email text, temp_password text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  target_id uuid;
  target_name text;
  found_email text;
  target_role text;
  generated_password text;
begin
  select id, name, email, role_name into target_id, target_name, found_email, target_role
  from (
    select id, name, email, 'ADMIN'::text role_name from admins
    union all select id, name, email, 'STAFF'::text from staff
    union all select id, name, email, 'TECHNICIAN'::text from technicians
  ) accounts where lower(email) = lower(target_email) limit 1;

  if target_id is null then
    return;
  end if;

  generated_password := substr(md5(random()::text || clock_timestamp()::text), 1, 10) || floor(random() * 90 + 10)::text;

  execute format(
    'update %I set password_hash = crypt($1, gen_salt(''bf'')), password = '''', status = ''PENDING'' where id = $2',
    case target_role when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  )
    using generated_password, target_id;

  delete from sessions where sessions.user_id = target_id;

  insert into system_logs (actor_id, actor_name, message, type)
    values (target_id, target_name, 'Requested a password reset.', 'auth');

  return query select target_id, target_name, found_email, generated_password;
end;
$$;

-- Grants preserved exactly as migration 037 left them: this one is not
-- callable with the publishable key.
revoke all on function public.request_password_reset(text) from public;
revoke all on function public.request_password_reset(text) from anon;
revoke all on function public.request_password_reset(text) from authenticated;
grant execute on function public.request_password_reset(text) to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   An empty password must be refused (expect zero rows):
--     select * from public.check_login('<a username>', '');
--
--   A real one must still work (expect one row):
--     select username, role from public.check_login('admin', 'ChangeMe123');
--
--   And the reset that was failing (expect no error):
--     select public.reset_password(
--       (select token from public.check_login('admin','ChangeMe123')),
--       '<some staff or technician id>',
--       'NewPass123');
--
--   After that reset the old password must no longer work, and the new one
--   must (the account is PENDING until that first sign-in):
--     select * from public.check_login('<their username>', '<old password>');  -- zero rows
--     select * from public.check_login('<their username>', 'NewPass123');      -- one row
-- ---------------------------------------------------------------------------
