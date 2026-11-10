-- Forgot password: send the email first, change the password second.
--
-- request_password_reset() changes the account's password and only then
-- hands the new one to the forgot-password edge function to email. When the
-- email cannot be sent (no Resend key, or Resend's free sender refusing an
-- address other than its owner's) the account is left with a password nobody
-- received, locked out until an admin resets it.
--
-- The edge function now works in two steps:
--   1. password_reset_account(email): who the address belongs to (name and
--      email), changing nothing. Same rule as request_password_reset: a
--      deactivated account is not found.
--   2. It makes up a temporary password and emails it. Only when the email has
--      been accepted does it call apply_password_reset(email, password), which
--      does what request_password_reset did: sets the password (hash and the
--      plain copy the owner reads in the dashboard), puts the account in
--      PENDING, ends its sessions and logs it.
-- If the email fails, nothing about the account changes.
--
-- Both are for the edge function only (service_role), like
-- request_password_reset, which is left in place for the old function.

create or replace function public.password_reset_account(target_email text)
returns table (user_id uuid, user_name text, user_email text)
language sql stable security definer
set search_path = public
as $$
  select id, name, email
  from (
    select id, name, email, status from public.admins
    union all select id, name, email, status from public.staff
    union all select id, name, email, status from public.technicians
  ) accounts
  where lower(accounts.email) = lower(trim(target_email))
    and accounts.status <> 'INACTIVE'
  limit 1;
$$;

create or replace function public.apply_password_reset(target_email text, new_password text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  target_id uuid;
  target_name text;
  target_role text;
begin
  if new_password is null or length(new_password) < 6
     or new_password !~ '[A-Za-z]' or new_password !~ '[0-9]' then
    raise exception 'Password must be at least 6 characters and include a letter and a number.';
  end if;

  select id, name, role_name into target_id, target_name, target_role
  from (
    select id, name, email, status, 'ADMIN'::text role_name from public.admins
    union all select id, name, email, status, 'STAFF'::text from public.staff
    union all select id, name, email, status, 'TECHNICIAN'::text from public.technicians
  ) accounts
  where lower(accounts.email) = lower(trim(target_email))
    and accounts.status <> 'INACTIVE'
  limit 1;

  if target_id is null then
    return false;
  end if;

  execute format(
    'update public.%I set password_hash = crypt($1, gen_salt(''bf'')), password = $1, '
    || 'status = ''PENDING''::account_status where id = $2',
    case target_role when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  )
    using new_password, target_id;

  delete from public.sessions where sessions.user_id = target_id;

  insert into public.system_logs (actor_id, actor_name, actor_role, message, type)
    values (target_id, target_name, target_role, 'Reset their password by email (forgot password).', 'auth');

  return true;
end;
$$;

revoke all on function public.password_reset_account(text) from public, anon, authenticated;
revoke all on function public.apply_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.password_reset_account(text) to service_role;
grant execute on function public.apply_password_reset(text, text) to service_role;

notify pgrst, 'reload schema';
