-- ============================================================================
-- Torres Pest Control — Migration 015 (No New Admins)
-- ============================================================================

-- Prevent creation of new Admin accounts entirely
create or replace function public.create_user(
  session_token uuid,
  new_name text,
  new_username text,
  new_email text,
  new_phone text,
  new_password text,
  new_role user_role
)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  created users;
begin
  caller := public.get_session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if not can_manage_users(caller) then raise exception 'You do not have permission to create accounts.'; end if;

  if new_role = 'ADMIN' then
    raise exception 'Creating new Admin accounts is not permitted.';
  end if;

  if exists (select 1 from users u where lower(u.email) = lower(new_email)) then
    raise exception 'That email is already used by another account.';
  end if;

  if new_username is not null and exists (select 1 from users u where lower(u.username) = lower(new_username)) then
    raise exception 'That username is already used by another account.';
  end if;

  insert into users (name, username, email, phone, password_hash, role, status, created_at, updated_at)
       values (new_name, new_username, new_email, new_phone, crypt(new_password, gen_salt('bf')),
               new_role, 'ACTIVE', now(), now())
    returning * into created;

  perform write_log(caller, format('Created %s account for %s.', lower(created.role::text), created.name), 'admin');
  return created;
end;
$$;

-- Prevent promoting accounts to Admin or demoting Admins
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
as $$
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
    if target_role = 'ADMIN' then
      raise exception 'Admins cannot modify other Admins.';
    end if;
  elsif new_role is distinct from caller.role then
    raise exception 'You cannot change your own role.';
  end if;

  if new_role = 'ADMIN' and target_role <> 'ADMIN' then
    raise exception 'Promoting accounts to Admin is not permitted.';
  end if;

  if target_role = 'ADMIN' and new_role <> 'ADMIN' then
    raise exception 'Demoting Admin accounts is not permitted.';
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
$$;

