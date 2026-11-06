-- Make the live database and the files the same, and close a password leak.
--
-- A read-only comparison of the live project with a database built from
-- 20261105000000_torres_database.sql (Nov 6, 2026) found these differences.
-- Everything here is safe to run on either one: each step checks first or
-- replaces in place, so it only changes what is different.
--
-- 1. Account tables (admins, staff, technicians). On live, anon and
--    authenticated could SELECT every column, password and password_hash
--    included, so anyone holding the app's public key could read them. The
--    files allowed column SELECT without those two, but still let anon INSERT,
--    UPDATE and DELETE the tables directly. The app only reads these tables
--    (userService.fetchAccounts); every write goes through a security-definer
--    function (check_login, create_role_account, update_role_account,
--    reset_password, change_password, ...), which these grants do not affect.
--    So: no direct writes, and SELECT on the columns the app reads.
-- 2. Plain-text passwords. Old accounts still had their password in the
--    `password` column. Where it matches password_hash it is cleared (login
--    is unchanged: the hash still accepts it); where there is no hash, the
--    hash is made from it first. A plain-text password that does NOT match
--    the account's hash is left alone, since clearing it would lock out
--    whoever uses it; the next password change or reset clears it.
-- 3. change_password. Live still ran the pre-018 version, which reads the
--    old `users` table that no longer exists, so changing your own password
--    failed. The files' version worked but saved the new password as plain
--    text and dropped the hash, and accepted any current password when the
--    hash was missing. Now it checks the current password properly, applies
--    reset_password's rule (6+ characters, a letter and a number), stores
--    only the hash, and ends the account's sessions, as reset_password does.
-- 4. update_role_account_avatar. Live had the older own-picture-only version;
--    the files' version (039-admin-avatar-management) lets an admin change
--    anyone's. Both returned the whole row, hash included; this one doesn't.
-- 5. submit_appointment_report. Live had 051's version; the files have 052's
--    (a multi-day job takes one report on its last day, and signing it
--    completes every day). Recreated from the files.
-- 6. stock_in. Live had a pre-040 body. Revoked since 055 and unused by the
--    app; recreated from the files so both are the same (grants unchanged).
-- 7. Old policies on live that called get_header_session_user(), a function
--    that reads the removed `users` table: Read/Write clients, documents and
--    inventory now use has_role_table_session(), as in the files, and the two
--    get_header_session_* functions are dropped. A second "Open access"
--    policy on each account table (same as "Role account access") is dropped.
-- 8. Columns: sessions.last_seen_at (live only, never read or written) and
--    clients.created_by / client_documents.uploaded_by (files only, never
--    filled in) are dropped, so the diagram and both databases agree.
-- 9. client_documents.storage_path is unique (live already had it), and
--    clients.phone takes only 09XXXXXXXXX, the app's rule (live also allowed
--    +63; no live client uses it).

-- crypt() and gen_salt() live in `extensions` on a new project and in `public`
-- on the live one (pgcrypto was installed there before the move to Supabase).
set search_path = public, extensions;

-- 1. Account tables -----------------------------------------------------------

revoke all on table public.admins, public.staff, public.technicians from anon, authenticated;

grant select (id, name, username, reference, phone, email, status, is_primary,
              created_at, updated_at, last_login_at, avatar_url)
  on table public.admins to anon, authenticated;
grant select (id, name, username, reference, phone, email, status,
              created_at, updated_at, last_login_at, avatar_url)
  on table public.staff to anon, authenticated;
grant select (id, name, username, reference, phone, email, status,
              created_at, updated_at, last_login_at, avatar_url)
  on table public.technicians to anon, authenticated;

drop policy if exists "Open access" on public.admins;
drop policy if exists "Open access" on public.staff;
drop policy if exists "Open access" on public.technicians;

-- 2. Plain-text passwords -----------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['admins', 'staff', 'technicians'] loop
    -- No hash yet: make one from the plain text.
    execute format(
      'update public.%I set password_hash = crypt(password, gen_salt(''bf''))
        where nullif(password, '''') is not null and nullif(password_hash, '''') is null', t);
    -- The hash already accepts it: the plain copy is not needed.
    execute format(
      'update public.%I set password = ''''
        where nullif(password, '''') is not null
          and case when password_hash like ''$2%%''
                   then password_hash = crypt(password, password_hash)
                   else false end', t);
  end loop;
end;
$$;

-- 3. change_password ----------------------------------------------------------

create or replace function public.change_password(session_token uuid, current_password text, new_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare caller record;
begin
  select * into caller from (
    select a.id, a.name, a.password, a.password_hash, 'admins'::text as table_name
      from sessions s join admins a on a.id = s.user_id
     where s.token = session_token and s.user_role = 'ADMIN' and a.status = 'ACTIVE'
    union all
    select a.id, a.name, a.password, a.password_hash, 'staff'::text
      from sessions s join staff a on a.id = s.user_id
     where s.token = session_token and s.user_role = 'STAFF' and a.status = 'ACTIVE'
    union all
    select a.id, a.name, a.password, a.password_hash, 'technicians'::text
      from sessions s join technicians a on a.id = s.user_id
     where s.token = session_token and s.user_role = 'TECHNICIAN' and a.status = 'ACTIVE'
  ) account limit 1;
  if caller.id is null then raise exception 'Not signed in.'; end if;

  -- The same test check_login uses: the plain copy (old accounts) or the hash.
  if nullif(current_password, '') is null or not (
       (nullif(caller.password, '') is not null and caller.password = current_password)
       or
       (nullif(caller.password_hash, '') is not null
        and caller.password_hash = crypt(current_password, caller.password_hash))
     ) then
    raise exception 'Current password is incorrect.';
  end if;

  if new_password is null
     or length(new_password) < 6
     or new_password !~ '[A-Za-z]'
     or new_password !~ '[0-9]' then
    raise exception 'Password must be at least 6 characters and include a letter and a number.';
  end if;

  execute format(
    'update %I set password_hash = crypt($1, gen_salt(''bf'')), password = '''' where id = $2',
    caller.table_name
  ) using new_password, caller.id;

  -- A new password signs the account out everywhere (the app signs in again).
  delete from public.sessions where sessions.user_id = caller.id;
end;
$fn$;

-- 4. update_role_account_avatar -----------------------------------------------

CREATE OR REPLACE FUNCTION public.update_role_account_avatar(session_token uuid, target_id uuid, new_avatar_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Never hand the password columns back to the browser.
  return (updated - 'password' - 'password_hash') || jsonb_build_object('role', target_role);
end;
$function$
;

-- 5. submit_appointment_report (052, from the files) ----------------------------

CREATE OR REPLACE FUNCTION public.submit_appointment_report(p_appointment_id uuid, p_findings text, p_treatment_performed text, p_recommendations text, p_follow_up_date date, p_customer_name text DEFAULT NULL::text, p_signature_path text DEFAULT NULL::text, p_completion_note text DEFAULT NULL::text, p_treatment_methods text[] DEFAULT NULL::text[], p_technician_signature_path text DEFAULT NULL::text, p_service_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS appointment_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare report_row public.appointment_reports;
declare actor_id uuid;
declare previous_status text;
declare current_service text;
declare job_plan uuid;
declare job_kind text;
declare signed boolean;
declare tech_signed boolean;
declare confirmed boolean;
declare methods text[];
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;

  methods := coalesce(p_treatment_methods, '{}');

  select a.status, a.service_type, a.plan_id, p.kind
    into previous_status, current_service, job_plan, job_kind
  from public.appointments a
  left join public.appointment_plans p on p.id = a.plan_id
  where a.id = p_appointment_id;
  if previous_status is null then raise exception 'Appointment not found.'; end if;

  -- 052: a multi-day job has one report, on its last day.
  if job_kind = 'MULTI_DAY' and public.plan_last_day(job_plan) is distinct from p_appointment_id then
    raise exception 'This job''s report is filed on its last day.';
  end if;

  -- 051: the services performed, ticked on the report. Replaces the list.
  if p_service_ids is not null and cardinality(p_service_ids) > 0 then
    current_service := public.set_appointment_services(p_appointment_id, p_service_ids);
  end if;

  if nullif(trim(coalesce(current_service, '')), '') is null
     and cardinality(methods) = 0
     and nullif(trim(coalesce(p_treatment_performed, '')), '') is null then
    raise exception 'Record the treatment: tick the services performed.';
  end if;

  signed := nullif(trim(coalesce(p_signature_path, '')), '') is not null;
  tech_signed := nullif(trim(coalesce(p_technician_signature_path, '')), '') is not null;

  if signed and nullif(trim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'A customer name is required alongside the signature.';
  end if;

  -- Unchanged from migration 034: only the customer's signature or an office
  -- note completes a visit. tech_signed is deliberately absent here.
  confirmed := signed or nullif(trim(coalesce(p_completion_note, '')), '') is not null;

  actor_id := public.current_account_id();

  insert into public.appointment_reports (
    appointment_id, findings, treatment_performed, treatment_methods, recommendations,
    follow_up_date, submitted_by, customer_name, signature_path, signed_at, completion_note,
    technician_signature_path, technician_signed_at
  )
  values (
    p_appointment_id, trim(p_findings), nullif(trim(coalesce(p_treatment_performed, '')), ''),
    methods, nullif(trim(p_recommendations), ''), p_follow_up_date,
    actor_id,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_signature_path, '')), ''),
    case when signed then now() else null end,
    nullif(trim(coalesce(p_completion_note, '')), ''),
    nullif(trim(coalesce(p_technician_signature_path, '')), ''),
    case when tech_signed then now() else null end
  )
  on conflict (appointment_id) do update set
    findings            = excluded.findings,
    treatment_performed = excluded.treatment_performed,
    treatment_methods   = excluded.treatment_methods,
    recommendations     = excluded.recommendations,
    follow_up_date      = excluded.follow_up_date,
    submitted_by        = excluded.submitted_by,
    submitted_at        = now(),
    customer_name   = coalesce(excluded.customer_name,   appointment_reports.customer_name),
    signature_path  = coalesce(excluded.signature_path,  appointment_reports.signature_path),
    signed_at       = coalesce(excluded.signed_at,       appointment_reports.signed_at),
    completion_note = coalesce(excluded.completion_note, appointment_reports.completion_note),
    technician_signature_path = coalesce(excluded.technician_signature_path, appointment_reports.technician_signature_path),
    technician_signed_at      = coalesce(excluded.technician_signed_at,      appointment_reports.technician_signed_at)
  returning * into report_row;

  if confirmed then
    if job_kind = 'MULTI_DAY' then
      -- 052: the signature completes the whole job, every live day of it.
      update public.appointments
        set status = 'Completed', day_done_at = coalesce(day_done_at, now())
        where plan_id = job_plan and status <> 'Cancelled';
    else
      update public.appointments set status = 'Completed' where id = p_appointment_id;
    end if;
  end if;

  if confirmed and previous_status is distinct from 'Completed' then
    insert into public.notifications (recipient_id, appointment_id, message)
    select recipients.id, p_appointment_id,
           'Service completed for ' || coalesce(c.name, 'a client') || '.'
    from public.appointments appt
    join public.clients c on c.id = appt.client_id
    cross join (
      select id from public.admins where status = 'ACTIVE'
      union all
      select id from public.staff where status = 'ACTIVE'
    ) recipients
    where appt.id = p_appointment_id
      and recipients.id is distinct from actor_id;
  end if;

  return report_row;
end;
$function$
;

-- 6. stock_in (from the files; still revoked) -----------------------------------

CREATE OR REPLACE FUNCTION public.stock_in(p_item_id uuid, p_amount numeric, p_movement_date date, p_reference text, p_actor text, p_idempotency_key uuid, p_actor_id uuid, p_intake_branch_or_station text)
 RETURNS TABLE(movement_id uuid, item_id uuid, amount numeric, movement_date date, reference text, actor text, created_at timestamp with time zone, new_quantity numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare existing inventory_movements; item_status inventory_status; movement_id_value uuid; created_at_value timestamptz; new_quantity_value numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Stock In amount must be greater than 0'; end if;
  if nullif(trim(p_reference), '') is null then raise exception 'A purchase order or supplier invoice reference is required'; end if;
  if p_idempotency_key is not null then
    select * into existing from public.inventory_movements where idempotency_key = p_idempotency_key;
    if existing.id is not null then select quantity into new_quantity_value from public.inventory where id = existing.item_id; return query select existing.id, existing.item_id, existing.amount, existing.movement_date, existing.reference, existing.actor, existing.created_at, new_quantity_value; return; end if;
  end if;
  select status into item_status from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item'; end if;
  insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, intake_branch_or_station, purchase_reference, idempotency_key, movement_type)
  values (p_item_id, p_amount, p_amount, p_movement_date, nullif(trim(p_reference), ''), p_actor, p_actor_id, nullif(trim(p_intake_branch_or_station), ''), nullif(trim(p_reference), ''), p_idempotency_key, 'IN')
  returning id, inventory_movements.created_at into movement_id_value, created_at_value;
  update public.inventory set quantity = quantity + p_amount where id = p_item_id returning quantity into new_quantity_value;
  return query select movement_id_value, p_item_id, p_amount, p_movement_date, nullif(trim(p_reference), ''), p_actor, created_at_value, new_quantity_value;
end;
$function$
;

-- 7. Policies that read the removed users table -------------------------------

drop policy if exists "Read clients" on public.clients;
create policy "Read clients" on public.clients for select using (public.has_role_table_session());
drop policy if exists "Write clients" on public.clients;
create policy "Write clients" on public.clients using (public.has_role_table_session()) with check (public.has_role_table_session());

drop policy if exists "Read documents" on public.client_documents;
create policy "Read documents" on public.client_documents for select using (public.has_role_table_session());
drop policy if exists "Write documents" on public.client_documents;
create policy "Write documents" on public.client_documents using (public.has_role_table_session()) with check (public.has_role_table_session());

drop policy if exists "Read inventory" on public.inventory;
create policy "Read inventory" on public.inventory for select using (public.has_role_table_session());
drop policy if exists "Write inventory" on public.inventory;
create policy "Write inventory" on public.inventory using (public.has_role_table_session()) with check (public.has_role_table_session());

drop function if exists public.get_header_session_user();
drop function if exists public.get_header_session_role();

-- 8. Unused columns -----------------------------------------------------------

alter table public.sessions drop column if exists last_seen_at;
alter table public.clients drop column if exists created_by;
alter table public.client_documents drop column if exists uploaded_by;

-- 9. Two constraints ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.client_documents'::regclass and conname = 'client_documents_storage_path_key'
  ) then
    alter table public.client_documents add constraint client_documents_storage_path_key unique (storage_path);
  end if;
end;
$$;

alter table public.clients drop constraint if exists clients_phone_check;
alter table public.clients add constraint clients_phone_check
  check (phone is null or phone = '' or phone ~ '^09[0-9]{9}$');
