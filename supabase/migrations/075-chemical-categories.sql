-- ---------------------------------------------------------------------------
-- Migration 075 - Chemical or Non-chemical.
--
-- Run after 074-larger-uploads.sql.
--
-- The business keeps chemical and non-chemical work apart. A service now has
-- a category; a visit takes it from its services in the app
-- (src/utils/categories.js: Chemical if any service is chemical). A client
-- has a category and a checkup frequency (Monthly or Quarterly, used for the
-- checkups in a later migration).
--
--   services.category           CHEMICAL | NON_CHEMICAL, default CHEMICAL
--   clients.category            CHEMICAL | NON_CHEMICAL, or null (not set)
--   clients.checkup_frequency   MONTHLY | QUARTERLY, or null (not set)
--
-- First run only: Inspection, Follow-up Visit and Checkup services are set to
-- Non-chemical (they treat nothing); every other service stays Chemical, and
-- the office can change any of them on the Services page. The app reads these
-- columns with their own queries, so it loads without 075.
--
-- Written by the app with plain updates (services: office only, 070's write
-- policy; clients: any office or staff session, as before). Nothing existing
-- is replaced. Safe to run more than once.
-- ---------------------------------------------------------------------------

do $first_run$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'category') then
    alter table public.services add column category text not null default 'CHEMICAL';
    update public.services set category = 'NON_CHEMICAL'
    where lower(name) ~ '(inspect|follow[ -]?up|check[ -]?up)';
  end if;
end;
$first_run$;

alter table public.services drop constraint if exists services_category_check;
alter table public.services add constraint services_category_check check (category in ('CHEMICAL', 'NON_CHEMICAL'));

alter table public.clients add column if not exists category text;
alter table public.clients add column if not exists checkup_frequency text;
alter table public.clients drop constraint if exists clients_category_check;
alter table public.clients add constraint clients_category_check check (category is null or category in ('CHEMICAL', 'NON_CHEMICAL'));
alter table public.clients drop constraint if exists clients_checkup_frequency_check;
alter table public.clients add constraint clients_checkup_frequency_check check (checkup_frequency is null or checkup_frequency in ('MONTHLY', 'QUARTERLY'));

comment on column public.services.category is 'CHEMICAL or NON_CHEMICAL (075). A visit is Chemical if any of its services is.';
comment on column public.clients.category is 'CHEMICAL or NON_CHEMICAL (075); null until set.';
comment on column public.clients.checkup_frequency is 'MONTHLY or QUARTERLY (075): how often the client''s checkups are booked.';

notify pgrst, 'reload schema';
