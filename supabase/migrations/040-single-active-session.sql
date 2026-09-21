-- Migration 040 — Block concurrent logins instead of silently kicking the
-- other device out.
--
-- Previously check_login() deleted any existing session for the account and
-- issued a new token unconditionally. Combined with the 3-second
-- validate_session() poll in AuthContext, a second device logging in would
-- silently log the first one out within a few seconds — no warning, no
-- choice. Run after 018-role-table-current-app.sql (the current source of
-- truth for check_login/validate_session).
--
-- Now: a login attempt is refused with a clear error while another session
-- for the same account is still "alive" (has heartbeated recently). A
-- session that stops heartbeating — tab closed, phone died, network gone —
-- goes stale after stale_after and the account becomes loggable-into again,
-- so this can't lock someone out permanently over an abandoned tab.
--
-- The heartbeat is still the existing validate_session() poll in
-- AuthContext.jsx — it now also stamps sessions.last_seen_at, so no new
-- client-side polling loop is needed.

alter table public.sessions add column if not exists last_seen_at timestamptz not null default now();

drop function if exists public.validate_session(uuid);
create or replace function public.validate_session(session_token uuid)
returns table(
  id uuid, name text, username text, email text, phone text, role text,
  status account_status, is_primary boolean, last_login_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  -- This is the heartbeat: every successful poll from a signed-in device
  -- proves that device is still actively using the account.
  update sessions set last_seen_at = now()
   where token = session_token and expires_at > now();

  return query
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
end;
$$;
grant execute on function public.validate_session(uuid) to anon, authenticated;

drop function if exists public.check_login(text, text);
create or replace function public.check_login(login_identifier text, login_password text)
returns table(token uuid, id uuid, name text, email text, username text, phone text, role text, status account_status)
language plpgsql security definer set search_path = public
as $$
declare
  found record;
  new_token uuid;
  active_elsewhere timestamptz;
  -- A session counts as "in use" if it heartbeated within this window.
  -- Comfortably longer than the 3s poll interval so a couple of missed
  -- beats (slow network, a briefly backgrounded tab) don't falsely free up
  -- the slot; short enough that a closed tab or dead phone doesn't lock the
  -- account out for long.
  stale_after constant interval := interval '20 seconds';
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

  select s.last_seen_at into active_elsewhere
    from sessions s
   where s.user_id = found.id
     and s.expires_at > now()
     and s.last_seen_at > now() - stale_after
   order by s.last_seen_at desc
   limit 1;

  if active_elsewhere is not null then
    raise exception 'This account is already signed in on another device. Log out there first, then try again.';
  end if;

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

notify pgrst, 'reload schema';
