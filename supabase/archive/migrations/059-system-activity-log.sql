-- ---------------------------------------------------------------------------
-- Migration 059 - The activity log lives in the database.
--
-- Run after 058-amount-limits.sql.
--
-- Sprint 1 (Edit / Deactivate User Account): "changes are logged in the
-- system activity log". The log was kept in each browser's localStorage: one
-- computer's history was invisible on another, clearing the browser erased it,
-- and anyone with the browser open could edit or invent entries. It was a
-- list on a screen, not an audit trail.
--
--   system_logs        one row per action: who (by account id, with the name
--                      and role they had then), what kind (auth, admin,
--                      client, document, inventory), what happened, when.
--
--   add_system_log()   the only way in. The actor is worked out on the
--                      server from the session — never taken from the
--                      browser — so an entry cannot be written in someone
--                      else's name. It takes the session token as an
--                      argument too, so the "Logged in" entry can be written
--                      the moment the session exists, before the app has
--                      attached it to its requests.
--
-- Append-only: there is no update or delete path through the API, and a
-- trigger refuses UPDATE and DELETE outright, even from SQL.
--
-- Read by admins only, matching the Activity Log page's permission
-- (src/utils/permissions.js, "logs": admin read-only).
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create table if not exists public.system_logs (
  id          uuid        primary key default gen_random_uuid(),
  -- Plain uuid: accounts live in three role tables (migration 011).
  actor_id    uuid        not null,
  actor_name  text        not null,
  actor_role  text        not null,
  type        text        not null check (type in ('auth', 'admin', 'client', 'document', 'inventory')),
  message     text        not null check (char_length(message) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists system_logs_created_at_idx on public.system_logs (created_at desc);

comment on table public.system_logs is
  'The system activity log. Written only by add_system_log(); never updated or deleted.';

alter table public.system_logs enable row level security;

drop policy if exists "System log read" on public.system_logs;
create policy "System log read" on public.system_logs
for select using (public.current_account_role() = 'ADMIN');

revoke all on public.system_logs from anon, authenticated;
grant select on public.system_logs to anon, authenticated;

-- Append-only, whoever asks.
create or replace function public.refuse_system_log_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The activity log cannot be changed or deleted.';
end;
$$;

drop trigger if exists trg_system_logs_append_only on public.system_logs;
create trigger trg_system_logs_append_only
  before update or delete on public.system_logs
  for each row execute function public.refuse_system_log_change();

-- The one way in.
drop function if exists public.add_system_log(text, text, uuid);

create function public.add_system_log(p_type text, p_message text, p_session_token uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  token uuid;
  account_id uuid;
  account_role text;
  account_name text;
  created uuid;
begin
  token := coalesce(p_session_token, nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid);

  select r.id, r.role_name into account_id, account_role
  from public.role_account_for_session(token) r
  limit 1;
  if account_id is null then raise exception 'Not signed in.'; end if;

  select coalesce(a.name, s.name, t.name) into account_name
  from (select account_id as id) me
  left join public.admins a on a.id = me.id
  left join public.staff s on s.id = me.id
  left join public.technicians t on t.id = me.id;

  if p_type is null or p_type not in ('auth', 'admin', 'client', 'document', 'inventory') then
    raise exception 'Unknown activity type.';
  end if;
  if nullif(trim(coalesce(p_message, '')), '') is null then
    raise exception 'An activity entry needs a message.';
  end if;

  insert into public.system_logs (actor_id, actor_name, actor_role, type, message)
  values (account_id, coalesce(account_name, 'Unknown account'), account_role, p_type, left(trim(p_message), 500))
  returning id into created;

  return created;
end;
$$;

grant execute on function public.add_system_log(text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select created_at, actor_name, actor_role, type, message
--   from public.system_logs order by created_at desc limit 20;
-- ---------------------------------------------------------------------------
