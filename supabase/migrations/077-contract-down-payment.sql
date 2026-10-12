-- ---------------------------------------------------------------------------
-- Migration 077 - contracts take a down payment too.
--
-- Run after 076-default-rates.sql.
--
-- The owner asks a down payment of contract clients as well as one-time
-- jobs. A contract now carries one (none, a fixed amount, or a percentage of
-- the contract total = price per visit x number of visits), taken once the
-- contract is signed and Active, before its visits can be booked, and
-- deducted from the contract's first invoice.
--
--   contracts.deposit_type / deposit_value / deposit_amount
--   payments.contract_id: a DEPOSIT now belongs to a quote OR a contract
--   set_contract_deposit(contract, type, value)   office; before any is paid
--   record_contract_deposit(contract, payment)    office; contract Active
--   contract_deposit_paid(contract)               cleared down payments
--
-- Replaced here (re-run 077 after re-running these):
--   link_contract_plan (063): refuses to book while the down payment is due;
--   link_invoice_contract (066): an invoice linked to a contract, with no
--     quote, deducts the contract's down payment not yet deducted elsewhere,
--     as long as nothing has been paid on that invoice yet.
--
-- save_contract (064) is untouched; the app sets the down payment right after
-- saving. A percentage needs a visit count (a contract with an end date takes
-- a fixed amount). Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.contracts add column if not exists deposit_type text not null default 'NONE';
alter table public.contracts add column if not exists deposit_value numeric(12,2) not null default 0;
alter table public.contracts add column if not exists deposit_amount numeric(12,2) not null default 0;
alter table public.contracts drop constraint if exists contracts_deposit_type_check;
alter table public.contracts add constraint contracts_deposit_type_check check (deposit_type in ('NONE', 'AMOUNT', 'PERCENT'));
alter table public.contracts drop constraint if exists contracts_deposit_amount_check;
alter table public.contracts add constraint contracts_deposit_amount_check check (deposit_amount >= 0 and deposit_amount <= 99999999.99);

alter table public.payments add column if not exists contract_id uuid references public.contracts(id) on delete restrict;
create index if not exists payments_contract_idx on public.payments (contract_id) where contract_id is not null;

-- A down payment belongs to a quote or a contract (not both); a payment to an invoice.
alter table public.payments drop constraint if exists payments_target;
alter table public.payments add constraint payments_target check (
  (kind = 'DEPOSIT' and invoice_id is null and ((quote_id is not null and contract_id is null) or (quote_id is null and contract_id is not null)))
  or (kind = 'PAYMENT' and invoice_id is not null and contract_id is null)
);

create or replace function public.contract_deposit_paid(p_contract_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(p.amount), 0)
  from public.payments p
  where p.contract_id = p_contract_id and p.kind = 'DEPOSIT' and public.payment_counts(p);
$$;

grant execute on function public.contract_deposit_paid(uuid) to anon, authenticated;

drop function if exists public.set_contract_deposit(uuid, text, numeric);

create function public.set_contract_deposit(p_contract_id uuid, p_type text, p_value numeric)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  v_type text := upper(coalesce(p_type, 'NONE'));
  v_value numeric := coalesce(p_value, 0);
  v_total numeric;
  v_amount numeric;
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status in ('ENDED', 'CANCELLED') then raise exception 'Contract % is %.', target.reference, lower(target.status); end if;
  if exists (select 1 from public.payments p where p.contract_id = target.id and p.reversed_at is null) then
    raise exception 'A down payment was already received on %; it cannot be changed.', target.reference;
  end if;
  if v_type not in ('NONE', 'AMOUNT', 'PERCENT') then raise exception 'Choose none, an amount or a percentage.'; end if;
  if v_value < 0 then raise exception 'The down payment cannot be negative.'; end if;

  v_total := case when target.visit_count is not null then target.price_per_visit * target.visit_count end;
  if v_type = 'PERCENT' then
    if v_value > 100 then raise exception 'A down payment cannot be more than 100%%.'; end if;
    if v_total is null then raise exception 'A contract with an end date takes the down payment as an amount.'; end if;
    v_amount := round(v_total * v_value / 100, 2);
  elsif v_type = 'AMOUNT' then
    if v_total is not null and v_value > v_total then raise exception 'The down payment is more than the contract total (₱%).', v_total; end if;
    v_amount := round(v_value, 2);
  else
    v_amount := 0;
    v_value := 0;
  end if;

  update public.contracts c set deposit_type = v_type, deposit_value = v_value, deposit_amount = v_amount, updated_at = now()
  where c.id = target.id returning * into target;
  return target;
end;
$$;

grant execute on function public.set_contract_deposit(uuid, text, numeric) to anon, authenticated;

drop function if exists public.record_contract_deposit(uuid, jsonb);

create function public.record_contract_deposit(p_contract_id uuid, p_payment jsonb)
returns public.payments
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  target public.contracts;
  created public.payments;
  v_amount numeric := (p_payment->>'amount')::numeric;
  v_paid_on date := coalesce((p_payment->>'paid_on')::date, today);
  v_method text := upper(coalesce(p_payment->>'method', ''));
  already numeric;
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status <> 'ACTIVE' then raise exception 'A down payment is taken once the contract is signed and active.'; end if;
  if target.deposit_amount <= 0 then raise exception 'Contract % has no down payment set.', target.reference; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if v_paid_on > today then raise exception 'A payment cannot be dated in the future.'; end if;
  if v_method not in ('CASH', 'BANK_TRANSFER', 'GCASH', 'CHECK') then raise exception 'Choose how it was paid.'; end if;
  if v_method = 'CHECK' and nullif(trim(coalesce(p_payment->>'check_number', '')), '') is null then
    raise exception 'Enter the check number.';
  end if;
  select coalesce(sum(p.amount), 0) into already
  from public.payments p where p.contract_id = target.id and p.kind = 'DEPOSIT' and p.reversed_at is null
    and not (p.method = 'CHECK' and p.check_status = 'BOUNCED');
  if already + v_amount > target.deposit_amount then
    raise exception 'That is more than the ₱% down payment. Already received: ₱%.', target.deposit_amount, already;
  end if;

  insert into public.payments (
    client_id, contract_id, kind, amount, paid_on, method, reference_no,
    check_number, check_bank, check_date, check_status, notes, received_by, received_by_name
  )
  values (
    target.client_id, target.id, 'DEPOSIT', round(v_amount, 2), v_paid_on, v_method,
    nullif(trim(coalesce(p_payment->>'reference_no', '')), ''),
    case when v_method = 'CHECK' then trim(p_payment->>'check_number') end,
    case when v_method = 'CHECK' then nullif(trim(coalesce(p_payment->>'check_bank', '')), '') end,
    case when v_method = 'CHECK' then (p_payment->>'check_date')::date end,
    case when v_method = 'CHECK' then 'PENDING' end,
    nullif(trim(coalesce(p_payment->>'notes', '')), ''),
    public.current_account_id(), public.billing_actor_name()
  )
  returning * into created;
  return created;
end;
$$;

grant execute on function public.record_contract_deposit(uuid, jsonb) to anon, authenticated;

-- link_contract_plan, from 063: not until the down payment is in.
create or replace function public.link_contract_plan(p_contract_id uuid, p_appointment_id uuid)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  visit public.appointments;
  paid numeric;
begin
  perform public.assert_billing_office();
  select * into target from public.contracts c where c.id = p_contract_id for update;
  if target.id is null then raise exception 'That contract was not found.'; end if;
  if target.status in ('ENDED', 'CANCELLED') then raise exception 'Contract % is %.', target.reference, lower(target.status); end if;
  paid := public.contract_deposit_paid(target.id);
  if target.deposit_amount > 0 and paid < target.deposit_amount then
    raise exception 'The down payment of ₱% has not been received yet (₱% so far).', target.deposit_amount, paid;
  end if;
  select * into visit from public.appointments a where a.id = p_appointment_id;
  if visit.id is null then raise exception 'That visit was not found.'; end if;
  if visit.client_id <> target.client_id then raise exception 'That visit is for a different client.'; end if;
  if visit.plan_id is null then raise exception 'Book the contract''s visits as a recurring plan.'; end if;
  update public.contracts c set plan_id = visit.plan_id, updated_at = now() where c.id = target.id returning * into target;
  return target;
end;
$$;

grant execute on function public.link_contract_plan(uuid, uuid) to anon, authenticated;

-- link_invoice_contract, from 066: the contract's down payment comes off its
-- first invoice (one with no quote and nothing paid on it yet).
create or replace function public.link_invoice_contract(p_invoice_id uuid, p_contract_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare
  target public.invoices;
  v_deposit numeric;
begin
  perform public.assert_billing_office();
  select * into target from public.invoices i where i.id = p_invoice_id for update;
  if target.id is null then raise exception 'That invoice was not found.'; end if;
  if not exists (select 1 from public.contracts c where c.id = p_contract_id and c.client_id = target.client_id) then
    raise exception 'That contract is for a different client.';
  end if;
  update public.invoices i set contract_id = p_contract_id where i.id = target.id returning * into target;

  if target.quote_id is null and target.status = 'ISSUED' and coalesce(target.deposit_applied, 0) = 0
     and not exists (select 1 from public.payments p where p.invoice_id = target.id and p.reversed_at is null) then
    v_deposit := greatest(0, public.contract_deposit_paid(p_contract_id) - coalesce((
      select sum(i.deposit_applied) from public.invoices i
      where i.contract_id = p_contract_id and i.quote_id is null and i.status = 'ISSUED' and i.id <> target.id
    ), 0));
    v_deposit := least(v_deposit, target.total);
    if v_deposit > 0 then
      update public.invoices i set deposit_applied = v_deposit, amount_due = i.total - v_deposit
      where i.id = target.id returning * into target;
    end if;
  end if;
  return target;
end;
$$;

grant execute on function public.link_invoice_contract(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
