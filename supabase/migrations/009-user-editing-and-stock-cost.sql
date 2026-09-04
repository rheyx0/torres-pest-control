-- ============================================================================
-- Migration 009 — User Editing (Username) & Stock Movement Cost Tracking
-- ============================================================================

alter table public.inventory_movements
  add column if not exists unit_cost numeric default 0;

alter table public.inventory_movements
  add column if not exists total_cost numeric default 0;

create or replace function public.update_user(
  session_token uuid,
  target_id uuid,
  new_name text,
  new_email text,
  new_phone text,
  new_role user_role,
  new_username text default null
)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  users;
  updated users;
begin
  caller := public.get_session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;

  if caller.id <> target_id then
    if not can_manage_users(caller) then raise exception 'You do not have permission to edit accounts.'; end if;
  elsif new_role is distinct from caller.role then
    raise exception 'You cannot change your own role.';
  end if;

  if exists (select 1 from users u where lower(u.email) = lower(new_email) and u.id <> target_id) then
    raise exception 'That email is already used by another account.';
  end if;

  if new_username is not null and exists (select 1 from users u where lower(u.username) = lower(new_username) and u.id <> target_id) then
    raise exception 'That username is already used by another account.';
  end if;

  update users
     set name     = coalesce(new_name, users.name),
         username = coalesce(new_username, users.username),
         email    = coalesce(new_email, users.email),
         phone    = new_phone,
         role     = coalesce(new_role, users.role)
   where users.id = target_id
   returning * into updated;

  if updated.id is null then raise exception 'Account not found.'; end if;

  perform write_log(caller, format('Updated account for %s.', updated.name), 'admin');
  return updated;
end;
$$;

grant execute on function public.update_user(uuid, uuid, text, text, text, user_role, text) to anon, authenticated;

notify pgrst, 'reload schema';
