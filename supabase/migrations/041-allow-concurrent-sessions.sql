-- Migration 041 — Allow concurrent sessions across devices again.
--
-- Migration 040 refused a login while another session for the account was
-- still heartbeating, so only one device could be signed in at a time.
-- Decision: multiple devices should be able to stay signed in at the same
-- time, indefinitely — logging in on a second device should not affect the
-- first device's session in either direction (no blocking, no kick-out).
--
-- check_login() no longer deletes the account's other sessions and no
-- longer refuses to log in while another session is active — every login
-- just adds its own independent session row, same as migration 018's
-- version, minus the "delete from sessions where user_id = found.id"
-- single-session cleanup.
--
-- validate_session() is untouched: it keeps stamping sessions.last_seen_at
-- on every heartbeat poll. That's no longer used to block anything, but
-- it's harmless bookkeeping (e.g. useful later for a "signed in on N other
-- devices" admin view) so there's no reason to remove it.

drop function if exists public.check_login(text, text);
create or replace function public.check_login(login_identifier text, login_password text)
returns table(token uuid, id uuid, name text, email text, username text, phone text, role text, status account_status)
language plpgsql security definer set search_path = public
as $$
declare
  found record;
  new_token uuid;
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
  insert into sessions (user_id, user_role) values (found.id, found.role_name) returning sessions.token into new_token;
  return query select new_token, found.id, found.name, found.email, coalesce(found.username, found.email), found.phone, found.role_name, 'ACTIVE'::account_status;
end;
$$;
grant execute on function public.check_login(text,text) to anon, authenticated;

notify pgrst, 'reload schema';
