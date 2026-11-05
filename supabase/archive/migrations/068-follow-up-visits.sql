-- ---------------------------------------------------------------------------
-- Migration 068 - follow-up visits are charged, and belong to their job.
--
-- Run after 067-unique-client-email.sql.
--
-- A follow-up is the return visit a technician asks for on a report (the
-- report's follow-up date, Sprint 4). The company charges for it, at a price
-- that depends on the treatment the client had, and bills it under the same
-- quotation as that treatment.
--
--   1. services.follow_up_price: what a follow-up of this service costs
--      (Termite Control's may differ from General Treatment's). Empty means
--      "use the Follow-up Visit service's own price". Within the 058 limit.
--   2. appointments.follow_up_of: the visit a follow-up checks on, set by
--      link_follow_up() (the office, same client, not itself). The original
--      visit is not changed; "followed up by" is read back through this column.
--      Deleting the original only clears the link.
--   3. A follow-up is no longer booked without payment by default: it must be
--      linked to the job's quotation (the booking form links it to the original
--      visit's quotation), or booked with "Still make appointment" and a
--      reason. So the Follow-up Visit service's "Can be booked without
--      payment" (066) is switched off here. Inspection keeps it. Re-running 066
--      does not switch it back on (066 marks services only on its first run).
--
-- Safe to run more than once. The switch in 3 runs only while no follow-up has
-- been linked yet, so an admin who later ticks it again is left alone.
-- ---------------------------------------------------------------------------

alter table public.services add column if not exists follow_up_price numeric(12,2);
alter table public.services drop constraint if exists services_follow_up_price_check;
alter table public.services add constraint services_follow_up_price_check
  check (follow_up_price is null or (follow_up_price >= 0 and follow_up_price <= 999999.99));

comment on column public.services.follow_up_price is
  'Price of a follow-up visit after this service (migration 068). Null: the Follow-up Visit service''s own price.';

alter table public.appointments add column if not exists follow_up_of uuid references public.appointments(id) on delete set null;
create index if not exists appointments_follow_up_of_idx on public.appointments (follow_up_of) where follow_up_of is not null;

comment on column public.appointments.follow_up_of is
  'The visit this follow-up checks on (migration 068), set by link_follow_up().';

-- 3. Follow-ups go under the job's quotation now (first run only).
update public.services
  set skip_payment_check = false
  where lower(trim(name)) in ('follow-up visit', 'follow up visit')
    and skip_payment_check = true
    and not exists (select 1 from public.appointments where follow_up_of is not null);

drop function if exists public.link_follow_up(uuid, uuid);
create function public.link_follow_up(p_appointment_id uuid, p_original_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_visit public.appointments;
  v_original public.appointments;
begin
  if coalesce(public.current_account_role(), '') not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can link a follow-up visit.';
  end if;
  select * into v_visit from public.appointments where id = p_appointment_id;
  if v_visit.id is null then raise exception 'That visit was not found.'; end if;
  if p_original_id is null then
    update public.appointments set follow_up_of = null where id = p_appointment_id;
    return;
  end if;
  select * into v_original from public.appointments where id = p_original_id;
  if v_original.id is null then raise exception 'The original visit was not found.'; end if;
  if v_original.id = v_visit.id then raise exception 'A visit cannot be a follow-up of itself.'; end if;
  if v_original.client_id is distinct from v_visit.client_id then
    raise exception 'A follow-up must be for the same client as the visit it follows.';
  end if;
  update public.appointments set follow_up_of = v_original.id where id = p_appointment_id;
end;
$$;
grant execute on function public.link_follow_up(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
