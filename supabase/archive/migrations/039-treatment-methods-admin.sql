-- ---------------------------------------------------------------------------
-- Migration 039 - Admin-managed treatment methods.
--
-- Run after 038-technician-signature.sql.
--
-- Supersedes the earlier draft numbered 038-treatment-methods-admin.sql, which
-- collided with the technician-signature migration and is not safe to run. If
-- that file is still in the migrations folder, delete it: this one replaces it
-- in full and is safe to run on a database where the draft was already applied.
--
-- Moves the hardcoded TREATMENT_METHODS list out of the front-end constants and
-- into a table so admins can create, edit and retire choices. The "Devices"
-- group is deliberately not seeded — it is being removed.
--
-- What changed from the draft, and why:
--
--   1. Grants. RLS decides which ROWS a role may touch; it never grants the
--      privilege to touch the table at all. The draft had policies but no
--      grant, so every query would have failed with "permission denied".
--
--   2. Session-gated RLS. The draft used `using (true)`, citing the pattern in
--      migrations 001 and 003. That pattern was replaced by migration 018,
--      which moved clients and inventory onto has_role_table_session(). With
--      `using (true)` anyone holding the publishable key could rewrite the
--      treatment list without signing in.
--
--   3. Admin-only writes, enforced here. The draft left the admin check to the
--      front end, which is a UI affordance and not a control: any signed-in
--      technician could have POSTed to the table directly. current_account_role()
--      from migration 030 already answers this question server-side.
--
--   4. Re-runnable. Postgres has no CREATE TRIGGER IF NOT EXISTS, so the draft
--      failed on a second run. Every object below is dropped first, matching
--      how the rest of this folder is written.
--
--   5. History is protected. Reports store the `value` string, not a row id,
--      so renaming or deleting a value in use would silently change what an
--      already-filed report says. See section 5.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

create table if not exists public.treatment_methods (
  id          bigint generated always as identity primary key,
  group_name  text        not null check (group_name in ('Application', 'Other work')),
  value       text        not null unique,
  label       text        not null,
  sort_order  int         not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.treatment_methods is
  'Admin-managed list of treatment methods offered on the service report.';
comment on column public.treatment_methods.value is
  'Stable key written into appointment_reports.treatment_methods. Immutable once used — see enforce_treatment_method_value_stable().';
comment on column public.treatment_methods.is_active is
  'False retires a method: it disappears from the report form but still resolves to a label on reports that already reference it.';

-- ---------------------------------------------------------------------------
-- 2. Seed (mirrors the old constants.js, minus Devices).
--
--    ON CONFLICT DO NOTHING so a re-run, or a database where the draft already
--    seeded these rows, is left exactly as it is.
-- ---------------------------------------------------------------------------

insert into public.treatment_methods (group_name, value, label, sort_order) values
  ('Application', 'GEL_BAIT',       'Gel bait application',         1),
  ('Application', 'CRACK_CREVICE',  'Crack & crevice treatment',    2),
  ('Application', 'RESIDUAL_SPRAY', 'Residual spraying',            3),
  ('Application', 'SPACE_FOGGING',  'Space / ULV fogging',          4),
  ('Application', 'DUSTING',        'Dusting / powder application', 5),
  ('Application', 'SOIL_TREATMENT', 'Soil poisoning / drilling',    6),
  ('Application', 'FUMIGATION',     'Fumigation',                   7),
  ('Other work',  'INSPECTION_ONLY',   'Inspection only, no treatment',         1),
  ('Other work',  'SANITATION_ADVICE', 'Sanitation advice given',               2),
  ('Other work',  'EXCLUSION',         'Exclusion / proofing work',             3),
  ('Other work',  'FOLLOW_UP_CHECK',   'Follow-up check of previous treatment', 4)
on conflict (value) do nothing;

-- ---------------------------------------------------------------------------
-- 3. updated_at maintenance.
-- ---------------------------------------------------------------------------

create or replace function public.set_treatment_methods_updated_at()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_treatment_methods_updated_at on public.treatment_methods;
create trigger trg_treatment_methods_updated_at
  before update on public.treatment_methods
  for each row execute function public.set_treatment_methods_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Access.
--
--    Read: any signed-in account, because the report form has to render the
--          list for whoever is filing the report.
--    Write: admins only, checked here rather than in the browser.
-- ---------------------------------------------------------------------------

alter table public.treatment_methods enable row level security;

drop policy if exists "Open access"             on public.treatment_methods;
drop policy if exists "Read treatment methods"  on public.treatment_methods;
drop policy if exists "Write treatment methods" on public.treatment_methods;

create policy "Read treatment methods" on public.treatment_methods
  for select using (public.has_role_table_session());

create policy "Write treatment methods" on public.treatment_methods
  for all
  using (public.current_account_role() = 'ADMIN')
  with check (public.current_account_role() = 'ADMIN');

grant select, insert, update, delete on public.treatment_methods to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Protecting reports that already exist.
--
--    appointment_reports.treatment_methods is a text[] of `value` strings, not
--    foreign keys. Nothing in the database stops a value being renamed or
--    deleted out from under a filed report, and the printed form would then
--    quietly show a different treatment than the technician recorded.
--
--    So: a value that is in use cannot be renamed, and cannot be deleted.
--    Retire it instead by setting is_active = false, which hides it from the
--    form while leaving old reports resolving to their proper label.
-- ---------------------------------------------------------------------------

create or replace function public.treatment_method_in_use(p_value text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.appointment_reports
    where p_value = any(coalesce(treatment_methods, '{}'))
  );
$$;

grant execute on function public.treatment_method_in_use(text) to anon, authenticated;

create or replace function public.enforce_treatment_method_value_stable()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.value is distinct from old.value
     and public.treatment_method_in_use(old.value) then
    raise exception
      'This method is already recorded on filed reports, so its value cannot be changed. Edit the label instead, or retire it and add a replacement.';
  end if;

  if tg_op = 'DELETE' and public.treatment_method_in_use(old.value) then
    raise exception
      'This method is already recorded on filed reports, so it cannot be deleted. Set it inactive to retire it instead.';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_treatment_methods_value_stable on public.treatment_methods;
create trigger trg_treatment_methods_value_stable
  before update or delete on public.treatment_methods
  for each row execute function public.enforce_treatment_method_value_stable();

-- ---------------------------------------------------------------------------
-- Note on the Devices group
--
--   Reports filed before this migration may still reference device values such
--   as MONITORING_STATION. They are not seeded here and no longer appear on the
--   form, so the report renderer falls back to printing the raw key. Seed the
--   rows as inactive if you would rather those reports print proper labels:
--
--     insert into public.treatment_methods (group_name, value, label, is_active)
--     values ('Other work', 'MONITORING_STATION', 'Monitoring station', false)
--     on conflict (value) do nothing;
--
--   The group_name CHECK allows only 'Application' and 'Other work'. Widen it
--   there if a third group is ever wanted; the admin UI reads the same two.
-- ---------------------------------------------------------------------------
