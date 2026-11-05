-- Migration 019 — Require current password for self-service email changes.

create or replace function public.update_role_account(
  session_token uuid, target_id uuid, new_name text, new_email text,
  new_phone text, new_role text, current_password text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  caller_id uuid;
  caller_role text;
  caller_password text;
  caller_password_hash text;
  target_role text;
  updated jsonb;
begin
  select id, role_name into caller_id, caller_role
    from role_account_for_session(session_token) limit 1;
  if caller_id is null then raise exception 'Not signed in.'; end if;

  select role_name into target_role from (
    select id, 'ADMIN'::text role_name from admins
    union all select id, 'STAFF'::text from staff
    union all select id, 'TECHNICIAN'::text from technicians
  ) accounts where id = target_id;
  if target_role is null then raise exception 'Account not found.'; end if;
  if caller_id <> target_id and caller_role <> 'ADMIN' then
    raise exception 'You do not have permission to edit accounts.';
  end if;
  if target_role = 'ADMIN' and caller_id <> target_id then
    raise exception 'Admins cannot modify other Admins.';
  end if;

  if caller_id = target_id then
    if new_email is distinct from (
      select email from admins where id = target_id
      union all select email from staff where id = target_id
      union all select email from technicians where id = target_id
    ) and nullif(current_password, '') is null then
      raise exception 'Enter your current password to change your email.';
    end if;

    if new_email is distinct from (
      select email from admins where id = target_id
      union all select email from staff where id = target_id
      union all select email from technicians where id = target_id
    ) then
      select password, password_hash into caller_password, caller_password_hash
        from (
          select password, password_hash from admins where id = target_id
          union all select password, password_hash from staff where id = target_id
          union all select password, password_hash from technicians where id = target_id
        ) credentials limit 1;
      if coalesce(caller_password, '') <> current_password
         and coalesce(caller_password_hash, '') <> crypt(current_password, caller_password_hash) then
        raise exception 'Current password is incorrect.';
      end if;
    end if;
  end if;

  if exists (select 1 from admins where id <> target_id and lower(email)=lower(new_email))
     or exists (select 1 from staff where id <> target_id and lower(email)=lower(new_email))
     or exists (select 1 from technicians where id <> target_id and lower(email)=lower(new_email)) then
    raise exception 'That email is already used by another account.';
  end if;

  if target_role = 'ADMIN' then
    update admins set name=new_name, email=new_email, phone=new_phone
      where id=target_id returning to_jsonb(admins.*) into updated;
  elsif target_role = 'STAFF' then
    update staff set name=new_name, email=new_email, phone=new_phone
      where id=target_id returning to_jsonb(staff.*) into updated;
  else
    update technicians set name=new_name, email=new_email, phone=new_phone
      where id=target_id returning to_jsonb(technicians.*) into updated;
  end if;

  return updated || jsonb_build_object('role', target_role);
end;
$$;

grant execute on function public.update_role_account(uuid,uuid,text,text,text,text,text) to anon, authenticated;
notify pgrst, 'reload schema';
