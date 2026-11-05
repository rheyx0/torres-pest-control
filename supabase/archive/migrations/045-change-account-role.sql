-- ---------------------------------------------------------------------------
-- Migration 045 - Let an admin change an account's role.
--
-- Run after 044-password-reset-and-login-hardening.sql.
--
-- WHERE THIS STOOD
--
--   Since migration 011 an account's role IS the table its row sits in:
--   admins, staff or technicians. There is no role column to update.
--
--   Migration 018's update_role_account() accepted new_role and refused to
--   act on it:
--     'Role changes are not supported with separate role tables.'
--
--   Migration 019 rewrote that function to add the current-password check on
--   email changes, and in doing so dropped the refusal without replacing it.
--   Since then new_role has been accepted and silently ignored: the caller is
--   told the save succeeded and the role does not move. That is worse than
--   018's honest error, and it is what this migration replaces.
--
-- HOW A ROLE CHANGE WORKS HERE
--
--   Move the row to the other table, KEEPING ITS id. The id is what
--   appointments.technician_id, appointment_technicians.technician_id,
--   inventory_movements.actor_id / technician_id, sessions.user_id,
--   appointment_reports.submitted_by and system_logs.actor_id all point at.
--   None of them is a foreign key — the role tables replaced a single users
--   table and the references were never re-pointed — so nothing in the
--   database would stop a delete-and-reinsert under a NEW id, and every one
--   of those rows would quietly become an orphan. Preserving the id is the
--   whole job.
--
--   Done inside one function, so it is one transaction: the row cannot exist
--   in both tables or in neither.
--
-- WHAT IS REFUSED, AND WHY
--
--   * Into or out of ADMIN. Migration 015 established that admins are not
--     created through the app; promoting to ADMIN is the same thing by
--     another route, and demoting the last admin locks everyone out. Both
--     directions stay closed, and the error says which.
--   * Changing your own role — an admin cannot demote themselves mid-session.
--   * A technician with future work. Their appointments would keep pointing
--     at an id that is no longer in `technicians`, so the visit would show an
--     unresolvable assignee. The error names the count so the office knows to
--     reassign first. Past appointments are fine and are left alone: history
--     should still say who did the work.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The move itself.
--
--    Separate from update_role_account() so the rule lives in one place and
--    can be called on its own. The three tables carry the same columns, so
--    the copy is explicit rather than dynamic — a column added to one table
--    and not the others should fail loudly here, not silently drop data.
-- ---------------------------------------------------------------------------

create or replace function public.move_account_role(
  session_token uuid,
  target_id uuid,
  new_role text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  caller_id uuid;
  caller_role text;
  caller_name text;
  current_role_name text;
  source_table text;
  target_table text;
  account record;
  pending_jobs integer;
  moved jsonb;
begin
  select r.id, r.role_name into caller_id, caller_role
  from public.role_account_for_session(session_token) r
  limit 1;
  if caller_id is null then raise exception 'Not signed in.'; end if;
  if caller_role <> 'ADMIN' then
    raise exception 'Only an administrator can change an account''s role.';
  end if;

  if upper(coalesce(new_role, '')) not in ('ADMIN', 'STAFF', 'TECHNICIAN') then
    raise exception 'Role must be ADMIN, STAFF or TECHNICIAN.';
  end if;
  new_role := upper(new_role);

  select accounts.role_name into current_role_name
  from (
    select id, 'ADMIN'::text role_name from public.admins
    union all select id, 'STAFF'::text from public.staff
    union all select id, 'TECHNICIAN'::text from public.technicians
  ) accounts
  where accounts.id = target_id;
  if current_role_name is null then raise exception 'Account not found.'; end if;

  -- Nothing to do. Not an error: update_role_account() passes the unchanged
  -- role on every ordinary profile edit.
  if current_role_name = new_role then
    return jsonb_build_object('id', target_id, 'role', current_role_name, 'moved', false);
  end if;

  if caller_id = target_id then
    raise exception 'You cannot change your own role.';
  end if;
  if current_role_name = 'ADMIN' then
    raise exception 'An Admin account cannot be demoted. Create a new account for the other role instead.';
  end if;
  if new_role = 'ADMIN' then
    raise exception 'Accounts cannot be promoted to Admin.';
  end if;

  -- A technician still holding live work would leave those appointments
  -- pointing at an id that is no longer a technician.
  if current_role_name = 'TECHNICIAN' then
    select count(*) into pending_jobs
    from public.appointments a
    where a.status not in ('Completed', 'Cancelled')
      and (a.technician_id = target_id
           or exists (select 1 from public.appointment_technicians at
                      where at.appointment_id = a.id and at.technician_id = target_id));
    if pending_jobs > 0 then
      raise exception
        'This technician is still assigned to % upcoming appointment(s). Reassign them before changing the role.',
        pending_jobs;
    end if;
  end if;

  source_table := lower(case current_role_name when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end);
  target_table := lower(case new_role         when 'ADMIN' then 'admins' when 'STAFF' then 'staff' else 'technicians' end);

  -- Read the whole row, then write it to the other table under the same id.
  execute format(
    'select id, name, username, email, phone, password, password_hash, status, created_at, last_login_at, avatar_url from %I where id = $1',
    source_table
  ) into account using target_id;

  if exists (select 1 from public.admins where lower(email) = lower(account.email) and id <> target_id)
     or exists (select 1 from public.staff where lower(email) = lower(account.email) and id <> target_id)
     or exists (select 1 from public.technicians where lower(email) = lower(account.email) and id <> target_id) then
    raise exception 'That email is already used by another account.';
  end if;

  execute format(
    'insert into %I (id, name, username, email, phone, password, password_hash, status, created_at, updated_at, last_login_at, avatar_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)
     returning to_jsonb(%I.*)',
    target_table, target_table
  )
  into moved
  using account.id, account.name, account.username, account.email, account.phone,
        account.password, account.password_hash, account.status, account.created_at,
        account.last_login_at, account.avatar_url;

  execute format('delete from %I where id = $1', source_table) using target_id;

  -- The session carries the old role, and role_account_for_session() joins on
  -- it, so leaving it in place would give this person a token that resolves
  -- to nothing. Signing them out is the honest outcome of a role change.
  delete from public.sessions where sessions.user_id = target_id;

  select a.name into caller_name from public.admins a where a.id = caller_id;
  insert into public.system_logs (actor_id, actor_name, message, type)
  values (caller_id, coalesce(caller_name, 'Administrator'),
          format('Changed %s''s role from %s to %s.', account.name, current_role_name, new_role),
          'admin');

  return moved || jsonb_build_object('role', new_role, 'moved', true);
end;
$$;

grant execute on function public.move_account_role(uuid, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. update_role_account() honours new_role again.
--
--    The migration 019 definition, unchanged except that it now performs the
--    move instead of ignoring the parameter. Ordinary edits pass the role
--    they already have, and move_account_role() returns early on those, so
--    the common path costs one extra lookup and nothing else.
--
--    The move happens LAST. If any of the name/email/password checks above it
--    raise, the row has not moved yet; and since the whole function is one
--    transaction, a failure in the move rolls back the field updates too.
-- ---------------------------------------------------------------------------

create or replace function public.update_role_account(
  session_token uuid, target_id uuid, new_name text, new_email text,
  new_phone text, new_role text, current_password text default null
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  caller_id uuid;
  caller_role text;
  caller_password text;
  caller_password_hash text;
  target_role text;
  updated jsonb;
  move_result jsonb;
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
      -- Matches migration 044's rule: an empty stored credential never
      -- satisfies a check.
      if not (
        (nullif(caller_password, '') is not null and caller_password = current_password)
        or (nullif(caller_password_hash, '') is not null
            and caller_password_hash = crypt(current_password, caller_password_hash))
      ) then
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

  if new_role is not null and upper(new_role) <> target_role then
    move_result := public.move_account_role(session_token, target_id, new_role);
    return move_result;
  end if;

  return updated || jsonb_build_object('role', target_role);
end;
$$;

grant execute on function public.update_role_account(uuid,uuid,text,text,text,text,text) to anon, authenticated;

-- The migration 018 six-argument overload still exists and still carries the
-- old refusal. Dropped so there is one definition of this function, and so
-- PostgREST cannot resolve a six-argument call to the version that rejects
-- every role change.
drop function if exists public.update_role_account(uuid, uuid, text, text, text, text);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   Promote a technician to staff, keeping the id:
--     select public.move_account_role(
--       (select token from public.check_login('admin','ChangeMe123')),
--       '<technician id>', 'STAFF');
--
--   The id must survive the move (expect STAFF, and the same uuid):
--     select 'admins' t, id from public.admins where id = '<id>'
--     union all select 'staff', id from public.staff where id = '<id>'
--     union all select 'technicians', id from public.technicians where id = '<id>';
--
--   And their completed appointments must still resolve to them:
--     select count(*) from public.appointments where technician_id = '<id>';
--
--   These must all raise:
--     ... '<an admin id>', 'STAFF'        -> Admin cannot be demoted
--     ... '<a staff id>', 'ADMIN'         -> cannot be promoted to Admin
--     ... '<own id>', 'STAFF'             -> cannot change your own role
--     ... '<technician with future work>' -> still assigned to N appointments
-- ---------------------------------------------------------------------------
