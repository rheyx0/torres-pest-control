-- ============================================================================
-- Torres Pest Control — Migration 013 (Audit Fixes)
-- ============================================================================

-- Fix #7, #10: Missing Backend Validation (CHECK constraints)
alter table users drop constraint if exists users_email_check;
alter table users add constraint users_email_check check (email ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$');

alter table users drop constraint if exists users_phone_check;
alter table users add constraint users_phone_check check (phone is null or phone = '' or phone ~ '^09[0-9]{9}$');

alter table clients drop constraint if exists clients_email_check;
alter table clients add constraint clients_email_check check (email is null or email = '' or email ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$');

alter table clients drop constraint if exists clients_phone_check;
alter table clients add constraint clients_phone_check check (phone is null or phone = '' or phone ~ '^09[0-9]{9}$');

-- Fix #3, #4: Admin Privilege & Passwords
create or replace function public.reset_password(
  session_token uuid,
  target_id uuid,
  new_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  target users;
begin
  caller := public.get_session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if not can_manage_users(caller) then raise exception 'You do not have permission to reset passwords.'; end if;

  select * into target from users u where u.id = target_id;
  if target.id is null then raise exception 'Account not found.'; end if;

  -- Prevent resetting another admin
  if target.role = 'ADMIN' and caller.id <> target.id then
    raise exception 'You cannot reset the password of another Admin.';
  end if;

  if length(new_password) < 6 or new_password !~ '[A-Za-z]' or new_password !~ '[0-9]' then
    raise exception 'Password must be at least 6 characters and include a letter and a number.';
  end if;

  update users
     set password_hash = crypt(new_password, gen_salt('bf')),
         status = 'PENDING'
   where users.id = target_id;

  delete from sessions where sessions.user_id = target_id;
  perform write_log(caller, format('Reset the password for %s.', target.name), 'auth');
end;
$$;

-- Fix #2, #6: RLS for core tables using header token
create or replace function public.get_header_session_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from sessions s
    join users u on u.id = s.user_id
    where s.token::text = (current_setting('request.headers', true)::json->>'x-session-token')
      and s.expires_at > now()
      and u.status = 'ACTIVE'
  );
$$;

-- Apply to clients
drop policy if exists "Read clients" on clients;
create policy "Read clients" on clients for select using (public.get_header_session_user());
drop policy if exists "Write clients" on clients;
create policy "Write clients" on clients for all using (public.get_header_session_user()) with check (public.get_header_session_user());

-- Apply to client_documents
drop policy if exists "Read documents" on client_documents;
create policy "Read documents" on client_documents for select using (public.get_header_session_user());
drop policy if exists "Write documents" on client_documents;
create policy "Write documents" on client_documents for all using (public.get_header_session_user()) with check (public.get_header_session_user());

-- Apply to inventory
drop policy if exists "Read inventory" on inventory;
create policy "Read inventory" on inventory for select using (public.get_header_session_user());
drop policy if exists "Write inventory" on inventory;
create policy "Write inventory" on inventory for all using (public.get_header_session_user()) with check (public.get_header_session_user());
