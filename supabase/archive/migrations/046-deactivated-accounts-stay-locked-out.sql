-- ---------------------------------------------------------------------------
-- Migration 046 - A deactivated account stays deactivated.
--
-- Run after 045-change-account-role.sql.
--
-- THE HOLE
--
--   check_login() has always refused INACTIVE accounts. Both password-reset
--   paths quietly undid that:
--
--     reset_password()          (admin resets someone's password)
--     request_password_reset()  (the "Forgot password?" flow)
--
--   Each ends with
--
--     update %I set password_hash = ..., password = '', status = 'PENDING'
--
--   written unconditionally. PENDING is a status check_login() ACCEPTS — it is
--   the "created but never signed in" state, and the first successful login
--   promotes it to ACTIVE. So setting it on an INACTIVE account reactivates
--   that account as a side effect of changing its password.
--
--   The forgot-password half needs no admin at all: a deactivated user enters
--   their own email, the Edge Function mails them a temporary password, their
--   row goes PENDING, and they sign straight back in. Deactivation was
--   reversible by the person it was applied to.
--
--   PENDING is right for every other account, so the fix is not to stop
--   writing it — it is to leave an INACTIVE account INACTIVE:
--
--     status = case when status = 'INACTIVE' then 'INACTIVE' else 'PENDING' end
--
--   The password still changes, which is what the caller asked for. It simply
--   does not buy back the ability to sign in. Reactivating remains what it
--   always was: an admin toggling the account in User Accounts, which goes
--   through set_role_account_status().
--
--   request_password_reset() additionally returns no rows for an INACTIVE
--   account, so no temporary password is generated or mailed for one. That is
--   the same silence it already keeps for an email that matches nothing — the
--   caller cannot tell the two apart, which is the point.
--
-- check_login() is restated below, unchanged from migration 044, so this file
-- is a complete statement of the login rule rather than half of one. Note the
-- `set search_path = public, extensions` on all three: recreating a function
-- resets its search_path, and without `extensions` crypt() is invisible and
-- every login fails with 42883 (migration 043).
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. reset_password - admin-initiated, keeps INACTIVE
--
--    Migration 044's definition with one changed expression, marked below.
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

  -- THE CHANGE: PENDING unless the account is deactivated, in which case it
  -- stays deactivated. Everything else is migration 044's statement.
  execute format(
    'update %I set password_hash = crypt($1, gen_salt(''bf'')), password = '''', '
    || 'status = case when status = ''INACTIVE'' then ''INACTIVE''::account_status '
    || 'else ''PENDING''::account_status end where id = $2',
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
-- 2. request_password_reset - no temporary password for a deactivated account
--
--    Migration 044's definition, with INACTIVE excluded from the lookup.
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
    select id, name, email, status, 'ADMIN'::text role_name from admins
    union all select id, name, email, status, 'STAFF'::text from staff
    union all select id, name, email, status, 'TECHNICIAN'::text from technicians
  ) accounts
  where lower(accounts.email) = lower(target_email)
    -- A deactivated account is not a candidate for a reset: issuing one would
    -- mail a working password to someone who is not allowed back in.
    and accounts.status <> 'INACTIVE'
  limit 1;

  -- Same silence as an unknown email, deliberately: the caller cannot use
  -- this endpoint to learn whether an address is registered or deactivated.
  if target_id is null then
    return;
  end if;

  generated_password := substr(md5(random()::text || clock_timestamp()::text), 1, 10) || floor(random() * 90 + 10)::text;

  execute format(
    'update %I set password_hash = crypt($1, gen_salt(''bf'')), password = '''', '
    || 'status = case when status = ''INACTIVE'' then ''INACTIVE''::account_status '
    || 'else ''PENDING''::account_status end where id = $2',
    case target_role when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  )
    using generated_password, target_id;

  delete from sessions where sessions.user_id = target_id;

  insert into system_logs (actor_id, actor_name, message, type)
    values (target_id, target_name, 'Requested a password reset.', 'auth');

  return query select target_id, target_name, found_email, generated_password;
end;
$$;

-- Grants preserved exactly as migrations 037 and 044 left them: this one is
-- not callable with the publishable key.
revoke all on function public.request_password_reset(text) from public;
revoke all on function public.request_password_reset(text) from anon;
revoke all on function public.request_password_reset(text) from authenticated;
grant execute on function public.request_password_reset(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. check_login - restated from migration 044, unchanged
--
--    Here so this file states the whole rule. INACTIVE is absent from the
--    status filter, which is what makes a deactivated account unable to sign
--    in; sections 1 and 2 are what stop that status being washed away.
-- ---------------------------------------------------------------------------

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
  delete from sessions where user_id = found.id;
  insert into sessions (user_id, user_role) values (found.id, found.role_name) returning sessions.token into new_token;
  return query select new_token, found.id, found.name, found.email, coalesce(found.username, found.email), found.phone, found.role_name, 'ACTIVE'::account_status;
end;
$$;

grant execute on function public.check_login(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   Pick a non-admin account and deactivate it:
--     update public.staff set status = 'INACTIVE' where username = '<username>';
--
--   It cannot sign in (expect zero rows):
--     select * from public.check_login('<username>', '<their password>');
--
--   An admin reset changes the password but does not let them back in
--   (expect zero rows from both, and status still INACTIVE):
--     select public.reset_password(
--       (select token from public.check_login('admin','ChangeMe123')),
--       '<their id>', 'NewPass123');
--     select * from public.check_login('<username>', 'NewPass123');
--     select status from public.staff where username = '<username>';
--
--   Forgot-password issues nothing for them (expect zero rows):
--     select * from public.request_password_reset('<their email>');
--
--   Reactivating through the app restores the new password:
--     update public.staff set status = 'ACTIVE' where username = '<username>';
--     select username, role from public.check_login('<username>', 'NewPass123');
--
--   And an ordinary (non-deactivated) reset still goes PENDING:
--     select status from public.technicians where id = '<some active tech>';
-- ---------------------------------------------------------------------------
