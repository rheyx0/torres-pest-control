-- ---------------------------------------------------------------------------
-- Migration 076 - default rates for transportation and labor.
--
-- Run after 075-chemical-categories.sql.
--
-- The business adds transportation (by distance) and labor (per technician
-- per day) on top of the service price. Quotes and invoices get them as
-- ordinary lines (kind EXTRA, unit 'km' or 'technician-day', quantity x unit
-- price), so save_quote / create_invoice and their totals are unchanged;
-- src/utils/fieldCharges.js builds them. This migration only stores the rates
-- they start from, editable per quote:
--
--   app_settings(key, value numeric)
--     transport_rate_per_km   pesos per km
--     labor_daily_rate        pesos per technician per day
--
-- Read by any signed-in account, written by the office (070's
-- is_office_account). The app falls back to no default (an empty rate box)
-- before 076. Safe to run more than once.
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key        text primary key,
  value      numeric(12,2),
  updated_at timestamptz not null default now()
);

alter table public.app_settings drop constraint if exists app_settings_value_check;
alter table public.app_settings add constraint app_settings_value_check
  check (value is null or (value >= 0 and value <= 999999.99));

comment on table public.app_settings is 'Office-wide numbers (076): transport_rate_per_km, labor_daily_rate.';

alter table public.app_settings enable row level security;
drop policy if exists "Read app settings" on public.app_settings;
drop policy if exists "Write app settings" on public.app_settings;
create policy "Read app settings" on public.app_settings for select using (public.has_role_table_session());
create policy "Write app settings" on public.app_settings for all
  using (public.is_office_account()) with check (public.is_office_account());
grant select, insert, update, delete on public.app_settings to anon, authenticated;

insert into public.app_settings (key, value) values ('transport_rate_per_km', null), ('labor_daily_rate', null)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
