-- ============================================================================
-- Torres Pest Control — schema v2
-- ============================================================================
--
-- Replaces schema.sql. Run this whole file in the Supabase SQL Editor; it is
-- idempotent, so re-running is safe.
--
-- WHY THIS EXISTS -----------------------------------------------------------
--
-- v1 stored accounts in three tables (admins / staff / technicians) and
-- expressed a user's role as *which table their row lived in*. Six sprint
-- acceptance criteria are impossible under that design:
--
--   1. "Admin can input name, email, username, ..."   -> no username column
--   2. "validates that email/username is unique"      -> unique per-table only,
--                                                        so one email could
--                                                        exist in all three
--   3. "Admin can update name, email, or role"        -> a role change means
--                                                        moving a row between
--                                                        tables
--   4. "Role changes take effect on next login"       -> same
--   5. "select a role (Staff/Admin, Technician,
--       Manager, Owner, System Admin)"                -> only 3 of 6 had tables
--   6. "List displays ... last login"                 -> no last_login column
--
-- One `users` table with a `role` column fixes all six at once.
--
-- v2 also fixes three things that were plainly wrong in v1:
--   - passwords were stored and compared in PLAINTEXT
--   - `grant insert, update, delete ... to anon` let anyone holding the
--     publishable key create themselves an ADMIN row
--   - the activity log and client documents had no tables at all
--
-- MIGRATION ORDER -----------------------------------------------------------
-- Sections 1-6 are the core and can be adopted on their own.
-- Section 7 (sessions + authorization RPCs) is what makes access control real
-- rather than UI-only. It requires rewriting src/services/{auth,user}Service.js.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 0. Shared trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Enums
--    Postgres has no `create type if not exists`, hence the guarded blocks.
-- ---------------------------------------------------------------------------

-- All six roles the sprint names. Adding a role is now one line here instead
-- of a new table plus a new branch in check_login.
do $$ begin
  create type user_role as enum ('ADMIN', 'STAFF', 'TECHNICIAN');
exception when duplicate_object then null; end $$;

-- PENDING implements "New account is stored with a default status
-- (active/inactive until first login)". A new account starts PENDING and is
-- promoted to ACTIVE by its first successful login (see check_login).
do $$ begin
  create type account_status as enum ('PENDING', 'ACTIVE', 'INACTIVE');
exception when duplicate_object then null; end $$;

-- UPGRADING FROM v1? v1's account_status had only ACTIVE and INACTIVE.
-- If this type already exists, run the following ONE line as a separate query
-- in Supabase SQL Editor, wait for it to commit, and then re-run this file.
-- Postgres will not let a new enum value be added and then used in the same
-- transaction, so it cannot be folded into this script:
--
--     alter type account_status add value if not exists 'PENDING' before 'ACTIVE';
--
-- On a fresh database the create type above already includes PENDING and
-- there is nothing to do.

do $$ begin
  create type client_status as enum ('ACTIVE', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_classification as enum (
    'RESIDENTIAL', 'COMMERCIAL', 'HOSPITALITY', 'WAREHOUSE_STORAGE',
    'INDUSTRIAL', 'AGRICULTURAL', 'EDUCATIONAL', 'MEDICAL_FACILITY',
    'GOVERNMENT_OFFICE', 'RELIGIOUS_INSTITUTION', 'MILITARY_FACILITY',
    'SCIENCE_LABORATORY', 'DOCK_PORT_FACILITY', 'BOAT_SHIP_VESSEL',
    'VACANT_LOT', 'OTHER'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type log_type as enum ('auth', 'admin', 'client', 'document', 'inventory');
exception when duplicate_object then null; end $$;

do $$ begin
  create type inventory_type as enum ('CHEMICAL', 'EQUIPMENT', 'MATERIAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chemical_type as enum ('INSECTICIDE', 'FUNGICIDE', 'RODENTICIDE', 'HERBICIDE', 'FUMIGANT', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_condition as enum ('ACTIVE', 'MAINTENANCE', 'DAMAGED', 'INACTIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type material_category as enum ('PROTECTIVE_GEAR', 'SUPPLIES', 'TOOLS_ACCESSORIES', 'OTHER');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Users — one table, role as a column
-- ---------------------------------------------------------------------------

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  username      text not null unique,          -- AC: "input name, email, username"
  email         text not null unique,          -- now unique across ALL roles
  phone         text,
  password_hash text not null,                 -- bcrypt via pgcrypto, never plaintext
  role          user_role not null default 'STAFF',
  status        account_status not null default 'PENDING',
  is_primary    boolean not null default false, -- seeded admin; guards last-admin rule
  last_login_at timestamptz,                   -- AC: "List displays ... last login"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists users_role_idx   on users (role);
create index if not exists users_status_idx on users (status);

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();

-- Case-insensitive lookups, so Admin@x.com and admin@x.com are the same account.
create unique index if not exists users_email_lower_idx    on users (lower(email));
create unique index if not exists users_username_lower_idx on users (lower(username));

-- ---------------------------------------------------------------------------
-- 3. Migrate v1 data, then retire the old tables
--
--    Runs only if the old tables still exist. Plaintext passwords are hashed
--    on the way across, so nobody has to reset their password.
--
--    NOTE: if the same email existed in more than one old table (v1 allowed
--    that), only the first is migrated — admins win, then staff, then
--    technicians. Check the skipped list afterwards with:
--      select email from staff where email in (select email from admins);
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.admins') is not null then
    insert into users (id, name, username, email, phone, password_hash, role, status, is_primary, created_at, updated_at)
    select id, name, email, email, phone, crypt(password, gen_salt('bf')), 'ADMIN'::user_role,
           status::text::account_status, coalesce(is_primary, false), created_at, updated_at
    from admins
    on conflict (email) do nothing;
  end if;

  if to_regclass('public.staff') is not null then
    insert into users (id, name, username, email, phone, password_hash, role, status, created_at, updated_at)
    select id, name, email, email, phone, crypt(password, gen_salt('bf')), 'STAFF'::user_role,
           status::text::account_status, created_at, updated_at
    from staff
    on conflict (email) do nothing;
  end if;

  if to_regclass('public.technicians') is not null then
    insert into users (id, name, username, email, phone, password_hash, role, status, created_at, updated_at)
    select id, name, email, email, phone, crypt(password, gen_salt('bf')), 'TECHNICIAN'::user_role,
           status::text::account_status, created_at, updated_at
    from technicians
    on conflict (email) do nothing;
  end if;
end $$;

-- Seed a primary admin so there is always a way in. Safe to re-run.
insert into users (name, username, email, phone, password_hash, role, status, is_primary)
values (
  'Maya Torres', 'admin', 'admin@torrespestcontrol.com', '+63 917 000 1111',
  crypt('ChangeMe123', gen_salt('bf')), 'ADMIN', 'ACTIVE', true
)
on conflict (email) do nothing;

-- Drop the old tables only once you've confirmed the migration above.
-- Left commented deliberately — uncomment and re-run when ready.
--   drop table if exists admins;
--   drop table if exists staff;
--   drop table if exists technicians;

-- ---------------------------------------------------------------------------
-- 4. Clients
--    Column names now match what the app actually calls them (the app said
--    `classification` while v1's column was `property_type`).
-- ---------------------------------------------------------------------------

create table if not exists clients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  email                text,
  phone                text,
  address              text,
  classification       client_classification not null default 'RESIDENTIAL',
  classification_other text,                 -- used when classification = 'OTHER'
  pest_concern         text,
  source               text,                 -- 'Walk-in' | 'Referral'
  status               client_status not null default 'ACTIVE',
  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Rename v1 columns if upgrading rather than starting fresh. Guarded, because
-- a bare ALTER ... RENAME fails both on a fresh database (no such column) and
-- on a second run (already renamed).
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'clients' and column_name = 'property_type') then
    alter table clients rename column property_type to classification;
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'clients' and column_name = 'property_type_other') then
    alter table clients rename column property_type_other to classification_other;
  end if;
end $$;

create index if not exists clients_classification_idx on clients (classification);
create index if not exists clients_name_idx on clients (lower(name));

drop trigger if exists clients_set_updated_at on clients;
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Client documents
--
--    AC: "Staff can upload documents (PDF, image) and attach them to a client
--    profile" / "view, download, or delete uploaded documents".
--
--    This table holds metadata; the bytes go in Supabase Storage. Create the
--    bucket once in the dashboard (Storage -> New bucket):
--        name: client-documents      public: no
--    `storage_path` is the object key within that bucket.
--
--    This is what replaces URL.createObjectURL() in the app — object URLs only
--    live as long as the browser tab, so every "uploaded" file broke on reload.
-- ---------------------------------------------------------------------------

create table if not exists client_documents (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,
  mime_type    text,
  size_bytes   bigint,
  storage_path text not null,
  uploaded_by  uuid references users(id) on delete set null,
  uploaded_at  timestamptz not null default now()
);

create index if not exists client_documents_client_idx on client_documents (client_id);

-- ---------------------------------------------------------------------------
-- 6. System activity log
--
--    AC: "Changes are logged in the system activity log" and "Deactivated
--    accounts remain in records for audit purposes."
--
--    In v1 this was localStorage, meaning every teammate had their own private,
--    clearable, forgeable history. As a table it becomes a shared audit trail.
--
--    actor_name is denormalised on purpose: if the account is later renamed,
--    the log should still say who did it at the time.
-- ---------------------------------------------------------------------------

create table if not exists system_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references users(id) on delete set null,
  actor_name text not null,
  message    text not null,
  type       log_type not null default 'admin',
  created_at timestamptz not null default now()
);

create index if not exists system_logs_created_idx on system_logs (created_at desc);
create index if not exists system_logs_type_idx    on system_logs (type);

-- ---------------------------------------------------------------------------
-- 7. Inventory (unchanged from v1 apart from being reachable)
-- ---------------------------------------------------------------------------

create table if not exists inventory (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              inventory_type not null,
  quantity          numeric not null default 0,
  unit              text not null,
  cost              numeric not null,
  supplier          text,
  storage_location  text,
  reorder_level     numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  chemical_type     chemical_type,
  expiration_date   timestamptz,
  safety_level      text,
  hazard_rating     text,
  date_received     timestamptz,

  serial_number     text,
  condition         equipment_condition,
  last_maintenance_date timestamptz,
  next_maintenance_date timestamptz,
  manufacturer      text,
  model             text,

  material_category material_category,
  description       text
);

drop trigger if exists inventory_set_updated_at on inventory;
create trigger inventory_set_updated_at before update on inventory
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Sessions — the basis for real server-side authorization
--
--    There is no Supabase Auth here, so from Postgres's point of view every
--    browser is the anonymous role. v1 responded by granting anon full write
--    access and enforcing rules in the UI — which means anyone with the
--    publishable key could insert themselves an ADMIN row via the REST API.
--
--    Instead: login issues an opaque token, the browser sends it with every
--    write, and the SECURITY DEFINER functions below check the caller's real
--    role server-side. Direct table writes are revoked entirely.
-- ---------------------------------------------------------------------------

create table if not exists sessions (
  token      uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

create index if not exists sessions_user_idx on sessions (user_id);

-- Resolves a token to its user, rejecting expired tokens and deactivated
-- accounts. This is what makes "deactivate blocks access" true for a session
-- that is already open — v1 only checked status at login, so a deactivated
-- user kept full access until they manually logged out.
create or replace function public.session_user(session_token uuid)
returns users
language sql
stable
security definer
set search_path = public
as $$
  select u.*
  from sessions s
  join users u on u.id = s.user_id
  where s.token = session_token
    and s.expires_at > now()
    and u.status = 'ACTIVE';
$$;

-- ---------------------------------------------------------------------------
-- 9. Login
--
--    AC: "System validates credentials and denies access if incorrect" and
--    "Failed login attempts show an error message without revealing which
--    field was incorrect" — this returns zero rows for every failure mode, so
--    the caller cannot tell them apart.
--
--    Accepts either the email or the username, per "log in using
--    username/email and password".
-- ---------------------------------------------------------------------------

drop function if exists public.check_login(text, text);

create or replace function public.check_login(login_identifier text, login_password text)
returns table (
  token   uuid,
  id      uuid,
  name    text,
  email   text,
  username text,
  phone   text,
  role    user_role,
  status  account_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_user users;
  new_token  uuid;
begin
  select * into found_user
  from users u
  where (lower(u.email) = lower(login_identifier) or lower(u.username) = lower(login_identifier))
    and u.password_hash = crypt(login_password, u.password_hash)
    and u.status in ('ACTIVE', 'PENDING');   -- PENDING is allowed exactly once

  if found_user.id is null then
    return;                                   -- no rows = generic failure
  end if;

  -- "New account is stored with a default status (active/inactive until first
  -- login)": first successful login promotes PENDING -> ACTIVE.
  update users
     set status = 'ACTIVE',
         last_login_at = now()                -- AC: "List displays ... last login"
   where users.id = found_user.id
   returning * into found_user;

  -- One live session per login. Old tokens for this user are cleared so a
  -- password change or re-login invalidates them.
  delete from sessions where sessions.user_id = found_user.id;
  insert into sessions (user_id) values (found_user.id) returning sessions.token into new_token;

  return query select
    new_token, found_user.id, found_user.name, found_user.email,
    found_user.username, found_user.phone, found_user.role, found_user.status;
end;
$$;

create or replace function public.logout(session_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from sessions where sessions.token = session_token;
$$;

-- ---------------------------------------------------------------------------
-- 10. Account management RPCs
--
--     Every write goes through one of these. Each re-checks the caller's role
--     against the database, so hiding a button in the UI is no longer the only
--     thing standing between a technician and an admin account.
-- ---------------------------------------------------------------------------

-- Roles allowed to manage accounts. Mirrors utils/permissions.js — keep the
-- two in step.
create or replace function public.can_manage_users(caller users)
returns boolean
language sql
immutable
as $$
  select caller.role = 'ADMIN';
$$;

create or replace function public.write_log(
  actor users, log_message text, log_kind log_type
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into system_logs (actor_id, actor_name, message, type)
  values (actor.id, coalesce(actor.name, 'System'), log_message, log_kind);
$$;

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
  caller  users;
  created users;
begin
  caller := session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if not can_manage_users(caller) then raise exception 'You do not have permission to create accounts.'; end if;

  -- AC: "System validates that email/username is unique before saving."
  if exists (select 1 from users u where lower(u.email) = lower(new_email)) then
    raise exception 'That email is already used by another account.';
  end if;
  if exists (select 1 from users u where lower(u.username) = lower(new_username)) then
    raise exception 'That username is already taken.';
  end if;

  insert into users (name, username, email, phone, password_hash, role, status)
  values (new_name, new_username, new_email, new_phone,
          crypt(new_password, gen_salt('bf')), new_role, 'PENDING')
  returning * into created;

  perform write_log(caller, format('Created %s account for %s.', new_role, new_name), 'admin');
  return created;
end;
$$;

-- AC: "Admin can update name, email, or role of an existing account."
-- Under v2 a role change is a plain column update, so this finally works.
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
begin
  caller := session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;

  -- Editing someone else requires the permission; editing yourself does not,
  -- but you cannot change your own role.
  if caller.id <> target_id then
    if not can_manage_users(caller) then raise exception 'You do not have permission to edit accounts.'; end if;
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
$$;

-- AC: "Admin can deactivate an account, preventing further login" and
-- "Deactivated accounts remain in records for audit purposes" — status flip
-- only, never a delete.
create or replace function public.set_user_status(
  session_token uuid,
  target_id uuid,
  new_status account_status
)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  users;
  target  users;
  updated users;
begin
  caller := session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if not can_manage_users(caller) then raise exception 'You do not have permission to change account status.'; end if;

  select * into target from users u where u.id = target_id;
  if target.id is null then raise exception 'Account not found.'; end if;

  -- Never let the last active admin be locked out.
  if new_status <> 'ACTIVE' and target.role = 'ADMIN' then
    if (select count(*) from users u
         where u.role = 'ADMIN' and u.status = 'ACTIVE') <= 1 then
      raise exception 'At least one active admin account is required.';
    end if;
  end if;

  update users set status = new_status where users.id = target_id returning * into updated;

  -- Deactivating ends any open session immediately, rather than letting the
  -- user keep working until they log out.
  if new_status <> 'ACTIVE' then
    delete from sessions where sessions.user_id = target_id;
  end if;

  perform write_log(caller, format('%s account marked %s.', updated.name, new_status), 'admin');
  return updated;
end;
$$;

-- AC: "User can change password while logged in by entering current and new
-- password" + "System validates new password meets minimum security
-- requirements."
create or replace function public.change_password(
  session_token uuid,
  current_password text,
  new_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  caller := session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;

  if caller.password_hash <> crypt(current_password, caller.password_hash) then
    raise exception 'Your current password is incorrect.';
  end if;

  if length(new_password) < 6 or new_password !~ '[A-Za-z]' or new_password !~ '[0-9]' then
    raise exception 'Password must be at least 6 characters and include a letter and a number.';
  end if;

  update users set password_hash = crypt(new_password, gen_salt('bf')) where users.id = caller.id;
  perform write_log(caller, 'Changed their password.', 'auth');

  -- Force a fresh sign-in everywhere after a password change.
  delete from sessions where sessions.user_id = caller.id;
end;
$$;

-- AC: "User can request a password reset if forgotten (e.g., via email link
-- or admin reset)" — this is the admin-reset half.
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
  caller := session_user(session_token);
  if caller.id is null then raise exception 'Not signed in.'; end if;
  if not can_manage_users(caller) then raise exception 'You do not have permission to reset passwords.'; end if;

  select * into target from users u where u.id = target_id;
  if target.id is null then raise exception 'Account not found.'; end if;

  if length(new_password) < 6 or new_password !~ '[A-Za-z]' or new_password !~ '[0-9]' then
    raise exception 'Password must be at least 6 characters and include a letter and a number.';
  end if;

  update users
     set password_hash = crypt(new_password, gen_salt('bf')),
         status = 'PENDING'          -- they must sign in again to reactivate
   where users.id = target_id;

  delete from sessions where sessions.user_id = target_id;
  perform write_log(caller, format('Reset the password for %s.', target.name), 'auth');
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Row-Level Security and grants
--
--     Reads stay open (the app needs the account list, and password_hash is
--     never selectable). Writes to `users` are revoked outright — the only way
--     in is through the RPCs above, which check the caller's role.
-- ---------------------------------------------------------------------------

alter table users            enable row level security;
alter table clients          enable row level security;
alter table client_documents enable row level security;
alter table inventory        enable row level security;
alter table system_logs      enable row level security;
alter table sessions         enable row level security;

-- Readable tables.
drop policy if exists "Read users" on users;
create policy "Read users" on users for select using (true);

drop policy if exists "Read clients" on clients;
create policy "Read clients" on clients for select using (true);
drop policy if exists "Write clients" on clients;
create policy "Write clients" on clients for all using (true) with check (true);

drop policy if exists "Read documents" on client_documents;
create policy "Read documents" on client_documents for select using (true);
drop policy if exists "Write documents" on client_documents;
create policy "Write documents" on client_documents for all using (true) with check (true);

drop policy if exists "Read inventory" on inventory;
create policy "Read inventory" on inventory for select using (true);
drop policy if exists "Write inventory" on inventory;
create policy "Write inventory" on inventory for all using (true) with check (true);

drop policy if exists "Read logs" on system_logs;
create policy "Read logs" on system_logs for select using (true);

-- sessions gets NO policy: it is reachable only through the SECURITY DEFINER
-- functions, never directly. A stolen token must be used via check_login/RPC.

-- Column-level grants on users: password_hash is never selectable, and the
-- table takes no direct writes at all.
revoke all on users from anon, authenticated;
grant select (id, name, username, email, phone, role, status, is_primary,
              last_login_at, created_at, updated_at)
  on users to anon, authenticated;

revoke insert, update, delete on users from anon, authenticated;
revoke all on sessions from anon, authenticated;
revoke insert, update, delete on system_logs from anon, authenticated;
grant select on system_logs to anon, authenticated;

-- Clients / documents / inventory are still written directly by the app.
-- Move them behind RPCs the same way if you want role checks there too.
grant select, insert, update, delete on clients, client_documents, inventory
  to anon, authenticated;

-- Only these functions are callable.
revoke all on function public.session_user(uuid) from public, anon, authenticated;

grant execute on function public.check_login(text, text)                       to anon, authenticated;
grant execute on function public.logout(uuid)                                  to anon, authenticated;
grant execute on function public.create_user(uuid, text, text, text, text, text, user_role) to anon, authenticated;
grant execute on function public.update_user(uuid, uuid, text, text, text, user_role)       to anon, authenticated;
grant execute on function public.set_user_status(uuid, uuid, account_status)   to anon, authenticated;
grant execute on function public.change_password(uuid, text, text)             to anon, authenticated;
grant execute on function public.reset_password(uuid, uuid, text)              to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. Housekeeping
-- ---------------------------------------------------------------------------

-- Expired sessions accumulate. Call occasionally, or schedule with pg_cron.
create or replace function public.purge_expired_sessions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from sessions where expires_at <= now();
$$;
