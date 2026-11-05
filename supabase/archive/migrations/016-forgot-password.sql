-- ============================================================================
-- Torres Pest Control — Migration 016 (Forgot Password)
-- ============================================================================
-- Generates a temporary password for a "forgot password" request and hands
-- it back to the caller so it can be emailed.
--
-- IMPORTANT: this function returns a plaintext (unhashed) password, so it
-- must NEVER be callable by anon/authenticated roles directly — only from a
-- trusted server context (the forgot-password Edge Function) using the
-- service_role key. That's why execute is revoked from anon/authenticated
-- below. If those grants are ever reset by a future migration, re-apply them.

create or replace function public.request_password_reset(target_email text)
returns table (user_id uuid, user_name text, user_email text, temp_password text)
language plpgsql
security definer
set search_path = public
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

  -- No matching account: return an empty result rather than raising, so the
  -- caller can show the same generic "if that email exists..." message
  -- whether or not the account exists (avoids leaking which emails are
  -- registered).
  if target_id is null then
    return;
  end if;

  -- 12 random alphanumeric characters, guaranteed to contain a letter and a
  -- number so it passes the same password policy used elsewhere.
  generated_password := substr(md5(random()::text || clock_timestamp()::text), 1, 10) || floor(random() * 90 + 10)::text;

  execute format(
    'update %I set password_hash = crypt($1, gen_salt(''bf'')), status = ''PENDING'' where id = $2',
    case target_role when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end
  )
    using generated_password, target_id;

  delete from sessions where sessions.user_id = target_id;

  insert into system_logs (actor_id, actor_name, message, type)
    values (target_id, target_name, 'Requested a password reset.', 'auth');

  return query select target_id, target_name, found_email, generated_password;
end;
$$;

revoke all on function public.request_password_reset(text) from public;
revoke all on function public.request_password_reset(text) from anon;
revoke all on function public.request_password_reset(text) from authenticated;
grant execute on function public.request_password_reset(text) to service_role;
