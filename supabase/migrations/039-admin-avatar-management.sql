-- Migration 039 - Allow administrators to manage user profile pictures.
--
-- Users may update their own avatar. Active administrators may update any
-- account avatar from the User Accounts page.

create or replace function public.update_role_account_avatar(
  session_token uuid,
  target_id uuid,
  new_avatar_url text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  caller_id uuid;
  caller_role text;
  target_role text;
  updated jsonb;
begin
  select id, role_name
    into caller_id, caller_role
    from role_account_for_session(session_token)
   limit 1;

  if caller_id is null then
    raise exception 'Not signed in.';
  end if;

  if caller_id <> target_id and caller_role <> 'ADMIN' then
    raise exception 'Only administrators can update another user''s profile picture.';
  end if;

  select role_name
    into target_role
    from (
      select id, 'ADMIN'::text as role_name from admins
      union all
      select id, 'STAFF'::text from staff
      union all
      select id, 'TECHNICIAN'::text from technicians
    ) accounts
   where id = target_id;

  if target_role is null then
    raise exception 'Account not found.';
  end if;

  if target_role = 'ADMIN' then
    update admins
       set avatar_url = nullif(new_avatar_url, '')
     where id = target_id
     returning to_jsonb(admins.*) into updated;
  elsif target_role = 'STAFF' then
    update staff
       set avatar_url = nullif(new_avatar_url, '')
     where id = target_id
     returning to_jsonb(staff.*) into updated;
  else
    update technicians
       set avatar_url = nullif(new_avatar_url, '')
     where id = target_id
     returning to_jsonb(technicians.*) into updated;
  end if;

  return updated || jsonb_build_object('role', target_role);
end;
$$;

grant execute on function public.update_role_account_avatar(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
