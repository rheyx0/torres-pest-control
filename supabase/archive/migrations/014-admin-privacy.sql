-- ============================================================================
-- Torres Pest Control — Migration 014 (Admin Privacy)
-- ============================================================================

-- Fix: Prevent admins from interfering with other admins (editing details or deactivating)
create or replace function public.update_user(
  session_token uuid,
  target_id uuid,
  new_name text,
  new_email text,
  new_phone text,
  new_role user_role
)
returns users
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  caller  users;
  updated users;
  target_role user_role;
begin
  caller := public.get_session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;

  select role into target_role from users where id = target_id;

  if caller.id <> target_id then
    if not can_manage_users(caller) then raise exception 'You do not have permission to edit accounts.'; end if;
    -- NEW: Block admins from editing other admins
    if target_role = 'ADMIN' then
      raise exception 'Admins cannot modify other Admins.';
    end if;
  elsif new_role is distinct from caller.role then
    raise exception 'You cannot change your own role.';
  end if;

  if exists (select 1 from users u where lower(u.email) = lower(new_email) and u.id <> target_id) then
    raise exception 'That email is already used by another account.';
  end if;

  update users
     set name  = coalesce(new_name, users.name),
         email = coalesce(new_email, users.email),
         phone = new_phone,
         role  = coalesce(new_role, users.role)
   where users.id = target_id
   returning * into updated;

  if updated.id is null then raise exception 'Account not found.'; end if;

  perform write_log(caller, format('Updated account for %s.', updated.name), 'admin');
  return updated;
end;
$BODY$;

create or replace function public.set_user_status(
  session_token uuid,
  target_id uuid,
  new_status account_status
)
returns users
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  caller  users;
  target  users;
  updated users;
begin
  caller := public.get_session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if not can_manage_users(caller) then raise exception 'You do not have permission to change account status.'; end if;

  select * into target from users u where u.id = target_id;
  if target.id is null then raise exception 'Account not found.'; end if;

  -- NEW: Block admins from deactivating other admins
  if target.role = 'ADMIN' and caller.id <> target.id then
    raise exception 'Admins cannot change the status of other Admins.';
  end if;

  if new_status <> 'ACTIVE' and target.role = 'ADMIN' then
    if (select count(*) from users u
         where u.role = 'ADMIN' and u.status = 'ACTIVE') <= 1 then
      raise exception 'At least one active admin account is required.';
    end if;
  end if;

  update users set status = new_status where users.id = target_id returning * into updated;

  if new_status <> 'ACTIVE' then
    delete from sessions where sessions.user_id = target_id;
  end if;

  perform write_log(caller, format('%s account marked %s.', updated.name, new_status), 'admin');
  return updated;
end;
$BODY$;

-- Fix: Do not show the list of admins to staff or technicians
-- We'll add a helper to get the session role
create or replace function public.get_header_session_role()
returns text
language sql
stable
security definer
set search_path = public
as $BODY$
  select u.role::text
  from sessions s
  join users u on u.id = s.user_id
  where s.token::text = (current_setting('request.headers', true)::json->>'x-session-token')
    and s.expires_at > now()
    and u.status = 'ACTIVE';
$BODY$;

-- Update the RLS policy on users to hide admins from non-admins
drop policy if exists "Read users" on users;
create policy "Read users" on users for select using (
  role != 'ADMIN' or coalesce(public.get_header_session_role(), '') = 'ADMIN'
);