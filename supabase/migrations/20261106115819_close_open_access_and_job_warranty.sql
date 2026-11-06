-- Close the open doors found in the Nov 6, 2026 system check, and start a
-- multi-day job's warranty on the day the job finished.
--
-- 1. "Open access" (USING true WITH CHECK true, for every role) was left on
--    clients, client_documents, inventory and inventory_movements by the
--    first files (001, 003, 005). Permissive policies are OR'ed, so the
--    proper ones added later (has_role_table_session()) never restricted
--    anything: with the app's public key, anyone could read, add, change or
--    delete clients, documents, stock items and stock history without
--    logging in. They are dropped. clients, client_documents and inventory
--    keep their Read / Write policies (a live session); inventory_movements
--    had no other policy, so it gets "Read stock movements" (a live
--    session). The app only reads that table; every stock change goes
--    through a security-definer function, which RLS does not stop.
-- 2. "Read logs" (SELECT, true) let anyone read the activity log. Dropped:
--    "System log read" (admins only, 059) is what the Activity Log page needs.
-- 3. warranty_start() / warranty_window(): a quotation's warranty starts on
--    its job's completion day, but on a multi-day job the earlier days were
--    counted too (Completed with no report, so their scheduled day), which
--    started the warranty on Day 1. Earlier days of a multi-day job are now
--    skipped, so the job's last day (the one with the report) sets the start.
--    quoteCompletedOn() in src/utils/warranty.js does the same.
-- 4. TRUNCATE, REFERENCES and TRIGGER on public tables are taken from anon
--    and authenticated (Supabase's default grants; the app never needs
--    them, and TRUNCATE ignores RLS), and from tables created later.

-- 1. Open access ------------------------------------------------------------
drop policy if exists "Open access" on public.clients;
drop policy if exists "Open access" on public.client_documents;
drop policy if exists "Open access" on public.inventory;
drop policy if exists "Open access" on public.inventory_movements;

drop policy if exists "Read stock movements" on public.inventory_movements;
create policy "Read stock movements" on public.inventory_movements
  for select using (public.has_role_table_session());

-- 2. Activity log ------------------------------------------------------------
drop policy if exists "Read logs" on public.system_logs;

-- 3. A multi-day job's warranty starts on its last day ------------------------
create or replace function public.warranty_start(p_source_type text, p_source_id uuid)
returns date
language plpgsql stable security definer set search_path = public
as $$
declare v_start date;
begin
  if upper(p_source_type) = 'CONTRACT' then
    select (c.activated_at at time zone 'Asia/Manila')::date into v_start
    from public.contracts c where c.id = p_source_id and c.status in ('ACTIVE', 'ENDED');
  else
    if not exists (select 1 from public.quotes q where q.id = p_source_id and q.status = 'APPROVED') then return null; end if;
    select min((coalesce(r.signed_at, r.submitted_at, a.scheduled_at) at time zone 'Asia/Manila')::date) into v_start
    from public.appointments a
    left join public.appointment_reports r on r.appointment_id = a.id
    where a.quote_id = p_source_id and a.status = 'Completed' and a.warranty_kind is null
      -- not an earlier day of a multi-day job: a later live day follows it
      and not exists (
        select 1 from public.appointment_plans p
        join public.appointments later on later.plan_id = p.id
        where p.id = a.plan_id and p.kind = 'MULTI_DAY'
          and later.status <> 'Cancelled' and later.plan_position > a.plan_position);
  end if;
  return v_start;
end;
$$;

create or replace function public.warranty_window(p_source_type text, p_source_id uuid)
returns table (starts_on date, ends_on date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_months integer;
  v_start date;
begin
  if upper(p_source_type) = 'CONTRACT' then
    select c.warranty_months into v_months
    from public.contracts c where c.id = p_source_id and c.status in ('ACTIVE', 'ENDED');
  else
    select q.warranty_months into v_months from public.quotes q where q.id = p_source_id and q.status = 'APPROVED';
  end if;
  v_start := public.warranty_start(p_source_type, p_source_id);
  if v_months is null or v_start is null then return; end if;
  return query select v_start, (v_start + make_interval(months => v_months))::date;
end;
$$;

-- 4. Table rights the app never uses ------------------------------------------
do $revoke$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', r.tablename);
  end loop;
  begin
    alter default privileges for role postgres in schema public
      revoke truncate, references, trigger on tables from anon, authenticated;
  exception when insufficient_privilege then
    raise notice 'Default privileges for postgres left as they are (not allowed for this login).';
  end;
end;
$revoke$;

notify pgrst, 'reload schema';
