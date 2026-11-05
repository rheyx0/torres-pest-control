-- ---------------------------------------------------------------------------
-- Migration 085 - the activity log is saved again.
--
-- Run after 084-built-in-services.sql.
--
-- 059 creates public.system_logs with "create table if not exists". On this
-- database an older system_logs table was already there (no actor_role
-- column, type as the enum log_type), so 059 kept it, and add_system_log()'s
-- insert into actor_role has failed ever since. The app read that failure as
-- "migration 059 not applied" and quietly wrote each entry to the browser's
-- own storage instead: logins, deliveries, account changes and the reasons
-- given for "Still make appointment without an approved quotation" never
-- reached the shared log.
--
-- This brings the table to 059's shape, keeping every entry already in it:
--   - actor_role added (old entries: 'ADMIN' where the actor is an admin,
--     else 'UNKNOWN');
--   - type becomes text with 059's check;
--   - 059's read policy (admins), grants and append-only trigger, again.
-- add_system_log() itself is unchanged. Nothing in the app changes: the
-- next entry it writes lands in the table. Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.system_logs add column if not exists actor_role text;

-- The append-only trigger would refuse the backfill below on a re-run;
-- it is dropped here and recreated at the end.
drop trigger if exists trg_system_logs_append_only on public.system_logs;
update public.system_logs l
  set actor_role = case when exists (select 1 from public.admins a where a.id = l.actor_id) then 'ADMIN'
                        when exists (select 1 from public.staff s where s.id = l.actor_id) then 'STAFF'
                        when exists (select 1 from public.technicians t where t.id = l.actor_id) then 'TECHNICIAN'
                        else 'UNKNOWN' end
  where l.actor_role is null;
alter table public.system_logs alter column actor_role set not null;

-- type: the old enum becomes text, with 059's list.
alter table public.system_logs alter column type drop default;
alter table public.system_logs alter column type type text using type::text;
update public.system_logs set type = 'admin' where type not in ('auth', 'admin', 'client', 'document', 'inventory');
alter table public.system_logs drop constraint if exists system_logs_type_check;
alter table public.system_logs add constraint system_logs_type_check
  check (type in ('auth', 'admin', 'client', 'document', 'inventory'));

alter table public.system_logs drop constraint if exists system_logs_message_check;
alter table public.system_logs add constraint system_logs_message_check
  check (char_length(message) between 1 and 500) not valid;

create index if not exists system_logs_created_at_idx on public.system_logs (created_at desc);

alter table public.system_logs enable row level security;
drop policy if exists "System log read" on public.system_logs;
create policy "System log read" on public.system_logs
for select using (public.current_account_role() = 'ADMIN');

revoke all on public.system_logs from anon, authenticated;
grant select on public.system_logs to anon, authenticated;

create or replace function public.refuse_system_log_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The activity log cannot be changed or deleted.';
end;
$$;

create trigger trg_system_logs_append_only
  before update or delete on public.system_logs
  for each row execute function public.refuse_system_log_change();

notify pgrst, 'reload schema';
