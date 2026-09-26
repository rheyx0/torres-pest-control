-- ---------------------------------------------------------------------------
-- Migration 062 - Invoices, extras on a visit, and invoice payments.
--
-- Run after 061-quotes-and-down-payments.sql.
--
-- After the service, the office bills it with an INVOICE:
--
--   invoices          TPC-INV-00001. Issued for a client, usually from an
--                     approved quote and the visit(s) booked from it, or for
--                     visits with no quote. The lines are a snapshot: the
--                     quote's lines (or the visits' services), plus approved
--                     extras. Discount and VAT as on a quote. The down payment
--                     already received on the quote is DEDUCTED
--                     (deposit_applied), so amount_due is what is left to pay.
--                     The due date comes from the payment terms (on receipt,
--                     15 or 30 days).
--
--                     An invoice is never edited or deleted. A mistake is
--                     VOIDED, by an admin, with a reason, once its payments
--                     have been reversed; its visits and extras are released
--                     so a corrected invoice can be issued.
--
--                     Paid / Partly paid / Overdue / Unpaid are not stored:
--                     they follow from the payments and the due date.
--
--   invoice_lines     the lines, in order; each may name the visit and the
--                     extra it came from.
--
--   appointment_extras  work or material beyond what was quoted, found on the
--                     day (more termites than expected, an extra room). The
--                     office records it on the visit as PROPOSED, or APPROVED
--                     straight away when the client agreed on site; only an
--                     APPROVED extra can go on an invoice, and only once.
--
--   payments          061's table, now also kind PAYMENT against an invoice
--                     (invoice_id): full or partial, any method; a check counts
--                     once it clears, a bounced check puts the balance back.
--
-- This is now the source of truth for record_payment (from 061). Re-running
-- 061 restores the deposit-only version; re-run 062 after it.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Invoices.
-- ---------------------------------------------------------------------------

create sequence if not exists public.invoice_reference_seq as bigint start 1;

create table if not exists public.invoices (
  id               uuid        primary key default gen_random_uuid(),
  reference        text        not null default 'TPC-INV-' || lpad(nextval('public.invoice_reference_seq')::text, 5, '0'),
  client_id        uuid        not null references public.clients(id) on delete restrict,
  quote_id         uuid        references public.quotes(id) on delete restrict,
  status           text        not null default 'ISSUED' check (status in ('ISSUED', 'VOID')),
  issued_on        date        not null,
  payment_terms    text        not null default 'DUE_ON_RECEIPT' check (payment_terms in ('DUE_ON_RECEIPT', 'NET_15', 'NET_30')),
  due_on           date        not null,
  discount_type    text        not null default 'AMOUNT' check (discount_type in ('AMOUNT', 'PERCENT')),
  discount_value   numeric     not null default 0 check (discount_value >= 0),
  vat_mode         text        not null default 'ADDED' check (vat_mode in ('ADDED', 'INCLUSIVE', 'NONE')),
  vat_rate         numeric     not null default 12 check (vat_rate >= 0 and vat_rate <= 100),
  subtotal         numeric     not null default 0,
  discount_amount  numeric     not null default 0,
  vat_amount       numeric     not null default 0,
  total            numeric     not null default 0 check (total >= 0 and total <= 9999999999),
  deposit_applied  numeric     not null default 0 check (deposit_applied >= 0),
  amount_due       numeric     not null default 0 check (amount_due >= 0),
  notes            text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text,
  constraint invoices_due_after_issue check (due_on >= issued_on),
  constraint invoices_deposit_within_total check (deposit_applied <= total),
  constraint invoices_void_fields check ((status = 'VOID') = (voided_at is not null))
);

create unique index if not exists invoices_reference_key on public.invoices (reference);
create index if not exists invoices_client_idx on public.invoices (client_id);
create index if not exists invoices_quote_idx on public.invoices (quote_id) where quote_id is not null;

comment on table public.invoices is
  'A bill issued after the service (TPC-INV). Never edited or deleted: voided with a reason. amount_due = total - deposit_applied.';

create table if not exists public.appointment_extras (
  id              uuid        primary key default gen_random_uuid(),
  appointment_id  uuid        not null references public.appointments(id) on delete cascade,
  kind            text        not null default 'EXTRA' check (kind in ('EXTRA', 'MATERIAL')),
  item_id         uuid        references public.inventory(id) on delete set null,
  description     text        not null check (char_length(description) between 1 and 300),
  quantity        numeric     not null check (quantity > 0 and quantity <= 1000000),
  unit            text,
  unit_price      numeric     not null check (unit_price >= 0 and unit_price <= 999999.99),
  status          text        not null default 'PROPOSED' check (status in ('PROPOSED', 'APPROVED', 'DECLINED')),
  decision_note   text,
  invoice_id      uuid        references public.invoices(id) on delete set null,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid
);

create index if not exists appointment_extras_appointment_idx on public.appointment_extras (appointment_id);

create table if not exists public.invoice_lines (
  id             uuid    primary key default gen_random_uuid(),
  invoice_id     uuid    not null references public.invoices(id) on delete cascade,
  position       integer not null,
  kind           text    not null check (kind in ('SERVICE', 'MATERIAL', 'EXTRA')),
  service_id     uuid    references public.services(id) on delete set null,
  item_id        uuid    references public.inventory(id) on delete set null,
  appointment_id uuid    references public.appointments(id) on delete set null,
  extra_id       uuid    references public.appointment_extras(id) on delete set null,
  description    text    not null check (char_length(description) between 1 and 300),
  quantity       numeric not null check (quantity > 0 and quantity <= 1000000),
  unit           text,
  unit_price     numeric not null check (unit_price >= 0 and unit_price <= 999999.99),
  amount         numeric not null check (amount >= 0)
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);
create index if not exists invoice_lines_service_idx on public.invoice_lines (service_id) where service_id is not null;

-- A visit is invoiced once (until that invoice is voided).
alter table public.appointments
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists appointments_invoice_idx on public.appointments (invoice_id) where invoice_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Payments against an invoice.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists invoice_id uuid references public.invoices(id) on delete restrict;

create index if not exists payments_invoice_idx on public.payments (invoice_id) where invoice_id is not null;

-- A down payment belongs to a quote; a payment to an invoice.
alter table public.payments drop constraint if exists payments_target;
alter table public.payments add constraint payments_target check (
  (kind = 'DEPOSIT' and quote_id is not null and invoice_id is null)
  or (kind = 'PAYMENT' and invoice_id is not null)
);

-- Paid on an invoice so far: counted payments only (cleared checks).
create or replace function public.invoice_paid(p_invoice_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(p.amount), 0)
  from public.payments p
  where p.invoice_id = p_invoice_id and p.kind = 'PAYMENT' and public.payment_counts(p);
$$;

-- ---------------------------------------------------------------------------
-- 3. Reading: the office only.
-- ---------------------------------------------------------------------------

alter table public.invoices           enable row level security;
alter table public.invoice_lines      enable row level security;
alter table public.appointment_extras enable row level security;

drop policy if exists "Invoice read" on public.invoices;
create policy "Invoice read" on public.invoices
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

drop policy if exists "Invoice line read" on public.invoice_lines;
create policy "Invoice line read" on public.invoice_lines
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

drop policy if exists "Visit extra read" on public.appointment_extras;
create policy "Visit extra read" on public.appointment_extras
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

revoke all on public.invoices, public.invoice_lines, public.appointment_extras from anon, authenticated;
grant select on public.invoices, public.invoice_lines, public.appointment_extras to anon, authenticated;

-- A service on an invoice is in use too (060's rule).
create or replace function public.service_in_use(p_service_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.appointments a where a.service_id = p_service_id)
      or exists (select 1 from public.appointment_services s where s.service_id = p_service_id)
      or exists (select 1 from public.quote_lines l where l.service_id = p_service_id)
      or exists (select 1 from public.invoice_lines l where l.service_id = p_service_id);
$$;

-- ---------------------------------------------------------------------------
-- 4. Extras on a visit.
-- ---------------------------------------------------------------------------

drop function if exists public.add_visit_extra(uuid, jsonb);

create function public.add_visit_extra(p_appointment_id uuid, p_extra jsonb)
returns public.appointment_extras
language plpgsql security definer set search_path = public
as $$
declare
  visit public.appointments;
  created public.appointment_extras;
  v_quantity numeric := (p_extra->>'quantity')::numeric;
  v_price numeric := (p_extra->>'unit_price')::numeric;
  v_status text := upper(coalesce(p_extra->>'status', 'PROPOSED'));
begin
  perform public.assert_billing_office();
  select * into visit from public.appointments a where a.id = p_appointment_id;
  if visit.id is null then raise exception 'That visit was not found.'; end if;
  if visit.status = 'Cancelled' then raise exception 'A cancelled visit takes no extras.'; end if;
  if visit.invoice_id is not null then raise exception 'That visit has already been invoiced. Void the invoice to add to it.'; end if;
  if nullif(trim(coalesce(p_extra->>'description', '')), '') is null then raise exception 'Describe the extra work or material.'; end if;
  if v_quantity is null or v_quantity <= 0 then raise exception 'Enter a quantity above zero.'; end if;
  if v_price is null or v_price < 0 then raise exception 'Enter the price agreed with the client.'; end if;
  if v_status not in ('PROPOSED', 'APPROVED') then raise exception 'A new extra is either proposed or already approved.'; end if;

  insert into public.appointment_extras (
    appointment_id, kind, item_id, description, quantity, unit, unit_price, status,
    created_by, created_by_name, decided_at, decided_by
  )
  values (
    visit.id, case when nullif(p_extra->>'item_id', '') is null then 'EXTRA' else 'MATERIAL' end,
    nullif(p_extra->>'item_id', '')::uuid, trim(p_extra->>'description'), v_quantity,
    nullif(trim(coalesce(p_extra->>'unit', '')), ''), round(v_price, 2), v_status,
    public.current_account_id(), public.billing_actor_name(),
    case when v_status = 'APPROVED' then now() end,
    case when v_status = 'APPROVED' then public.current_account_id() end
  )
  returning * into created;
  return created;
end;
$$;

grant execute on function public.add_visit_extra(uuid, jsonb) to anon, authenticated;

-- The client's answer on a proposed extra.
drop function if exists public.decide_visit_extra(uuid, boolean, text);

create function public.decide_visit_extra(p_extra_id uuid, p_approved boolean, p_note text default null)
returns public.appointment_extras
language plpgsql security definer set search_path = public
as $$
declare target public.appointment_extras;
begin
  perform public.assert_billing_office();
  select * into target from public.appointment_extras e where e.id = p_extra_id for update;
  if target.id is null then raise exception 'That extra was not found.'; end if;
  if target.status <> 'PROPOSED' then raise exception 'That extra was already %.', lower(target.status); end if;
  update public.appointment_extras e set
    status = case when p_approved then 'APPROVED' else 'DECLINED' end,
    decision_note = nullif(trim(coalesce(p_note, '')), ''),
    decided_at = now(), decided_by = public.current_account_id()
  where e.id = p_extra_id returning * into target;
  return target;
end;
$$;

grant execute on function public.decide_visit_extra(uuid, boolean, text) to anon, authenticated;

-- An extra not yet invoiced can be taken off (entered by mistake).
drop function if exists public.delete_visit_extra(uuid);

create function public.delete_visit_extra(p_extra_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare target public.appointment_extras;
begin
  perform public.assert_billing_office();
  select * into target from public.appointment_extras e where e.id = p_extra_id for update;
  if target.id is null then raise exception 'That extra was not found.'; end if;
  if target.invoice_id is not null then raise exception 'That extra is on an invoice. Void the invoice first.'; end if;
  delete from public.appointment_extras e where e.id = p_extra_id;
  return true;
end;
$$;

grant execute on function public.delete_visit_extra(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Issuing an invoice.
--
--    p_invoice: client_id, quote_id?, appointment_ids[], issued_on?,
--               payment_terms, discount_type/value, vat_mode, vat_rate, notes
--    p_lines:   [{ kind, service_id?, item_id?, appointment_id?, extra_id?,
--                  description, quantity, unit, unit_price }]
--
--    Totals as save_quote (061). The down payment deducted is what the quote
--    has received and counts (cleared), less what earlier invoices on the
--    same quote already deducted, and never more than this invoice's total.
-- ---------------------------------------------------------------------------

drop function if exists public.create_invoice(jsonb, jsonb);

create function public.create_invoice(p_invoice jsonb, p_lines jsonb)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  target public.invoices;
  q_row public.quotes;
  entry_row record;
  extra_row public.appointment_extras;
  lines_total numeric := 0;
  discount numeric;
  net numeric;
  vat numeric;
  grand numeric;
  deposit numeric := 0;
  line_no integer := 0;
  visit_ids uuid[] := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_invoice->'appointment_ids', '[]'::jsonb))),
    '{}'::uuid[]
  );
  v_client uuid := (p_invoice->>'client_id')::uuid;
  v_quote uuid := nullif(p_invoice->>'quote_id', '')::uuid;
  v_issued date := coalesce(nullif(p_invoice->>'issued_on', '')::date, today);
  v_terms text := coalesce(p_invoice->>'payment_terms', 'DUE_ON_RECEIPT');
  v_discount_type text := coalesce(p_invoice->>'discount_type', 'AMOUNT');
  v_discount_value numeric := coalesce((p_invoice->>'discount_value')::numeric, 0);
  v_vat_mode text := coalesce(p_invoice->>'vat_mode', 'ADDED');
  v_vat_rate numeric := coalesce((p_invoice->>'vat_rate')::numeric, 12);
begin
  perform public.assert_billing_office();

  if v_client is null or not exists (select 1 from public.clients c where c.id = v_client) then
    raise exception 'Choose the client to invoice.';
  end if;
  if v_issued > today then raise exception 'An invoice cannot be dated in the future.'; end if;
  if v_terms not in ('DUE_ON_RECEIPT', 'NET_15', 'NET_30') then raise exception 'Choose the payment terms.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line.';
  end if;
  if v_discount_type = 'PERCENT' and v_discount_value > 100 then raise exception 'A discount cannot be more than 100%%.'; end if;

  if v_quote is not null then
    select * into q_row from public.quotes q where q.id = v_quote for update;
    if q_row.id is null then raise exception 'That quote was not found.'; end if;
    if q_row.status <> 'APPROVED' then raise exception 'Only an approved quote can be invoiced.'; end if;
    if q_row.client_id <> v_client then raise exception 'That quote is for a different client.'; end if;
  end if;

  -- The visits: this client's, done, and not on another invoice.
  if exists (
    select 1 from unnest(visit_ids) as wanted(id)
    left join public.appointments a on a.id = wanted.id
    where a.id is null or a.client_id <> v_client
  ) then
    raise exception 'Every visit on the invoice must be this client''s.';
  end if;
  if exists (select 1 from public.appointments a where a.id = any(visit_ids) and a.status <> 'Completed') then
    raise exception 'Only completed visits can be invoiced.';
  end if;
  if exists (select 1 from public.appointments a where a.id = any(visit_ids) and a.invoice_id is not null) then
    raise exception 'One of those visits is already on an invoice.';
  end if;
  perform 1 from public.appointments a where a.id = any(visit_ids) for update;

  for entry_row in
    select entries.quantity, entries.unit_price, entries.extra_id, entries.appointment_id, entries.description
    from jsonb_to_recordset(p_lines) as entries(quantity numeric, unit_price numeric, extra_id uuid, appointment_id uuid, description text)
  loop
    if nullif(trim(coalesce(entry_row.description, '')), '') is null then raise exception 'Every line needs a description.'; end if;
    if entry_row.quantity is null or entry_row.quantity <= 0 then raise exception 'Every line needs a quantity above zero.'; end if;
    if entry_row.unit_price is null or entry_row.unit_price < 0 then raise exception 'Every line needs a price.'; end if;
    if entry_row.appointment_id is not null and not (entry_row.appointment_id = any(visit_ids)) then
      raise exception 'A line names a visit that is not on this invoice.';
    end if;
    if entry_row.extra_id is not null then
      select * into extra_row from public.appointment_extras e where e.id = entry_row.extra_id for update;
      if extra_row.id is null then raise exception 'An extra on the invoice was not found.'; end if;
      if extra_row.status <> 'APPROVED' then raise exception 'Only an approved extra can be invoiced (% is %).', extra_row.description, lower(extra_row.status); end if;
      if extra_row.invoice_id is not null then raise exception 'The extra "%" is already on an invoice.', extra_row.description; end if;
      if not exists (select 1 from public.appointments a where a.id = extra_row.appointment_id and a.client_id = v_client) then
        raise exception 'The extra "%" is on another client''s visit.', extra_row.description;
      end if;
    end if;
    lines_total := lines_total + round(entry_row.quantity * entry_row.unit_price, 2);
  end loop;

  discount := round(case when v_discount_type = 'PERCENT' then lines_total * v_discount_value / 100 else least(v_discount_value, lines_total) end, 2);
  net := lines_total - discount;
  vat := round(case v_vat_mode
    when 'ADDED' then net * v_vat_rate / 100
    when 'INCLUSIVE' then net - net / (1 + v_vat_rate / 100)
    else 0 end, 2);
  grand := case when v_vat_mode = 'ADDED' then net + vat else net end;

  if v_quote is not null then
    deposit := greatest(0, public.quote_deposit_paid(v_quote) - coalesce((
      select sum(i.deposit_applied) from public.invoices i where i.quote_id = v_quote and i.status = 'ISSUED'
    ), 0));
    deposit := least(deposit, grand);
  end if;

  insert into public.invoices (
    client_id, quote_id, issued_on, payment_terms, due_on, discount_type, discount_value, vat_mode, vat_rate,
    subtotal, discount_amount, vat_amount, total, deposit_applied, amount_due, notes, created_by, created_by_name
  )
  values (
    v_client, v_quote, v_issued, v_terms,
    v_issued + case v_terms when 'NET_15' then 15 when 'NET_30' then 30 else 0 end,
    v_discount_type, v_discount_value, v_vat_mode, v_vat_rate,
    lines_total, discount, vat, grand, deposit, grand - deposit,
    nullif(trim(coalesce(p_invoice->>'notes', '')), ''),
    public.current_account_id(), public.billing_actor_name()
  )
  returning * into target;

  for entry_row in
    select entries.kind, entries.service_id, entries.item_id, entries.appointment_id, entries.extra_id,
           entries.description, entries.quantity, entries.unit, entries.unit_price
    from jsonb_to_recordset(p_lines) as entries(kind text, service_id uuid, item_id uuid, appointment_id uuid, extra_id uuid,
                                                description text, quantity numeric, unit text, unit_price numeric)
  loop
    insert into public.invoice_lines (invoice_id, position, kind, service_id, item_id, appointment_id, extra_id, description, quantity, unit, unit_price, amount)
    values (
      target.id, line_no, upper(coalesce(entry_row.kind, 'EXTRA')), entry_row.service_id, entry_row.item_id,
      entry_row.appointment_id, entry_row.extra_id, trim(entry_row.description), entry_row.quantity,
      nullif(trim(coalesce(entry_row.unit, '')), ''), entry_row.unit_price, round(entry_row.quantity * entry_row.unit_price, 2)
    );
    if entry_row.extra_id is not null then
      update public.appointment_extras e set invoice_id = target.id where e.id = entry_row.extra_id;
    end if;
    line_no := line_no + 1;
  end loop;

  update public.appointments a set invoice_id = target.id where a.id = any(visit_ids);

  return target;
end;
$$;

grant execute on function public.create_invoice(jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Voiding: admin only, with a reason, once no payment on it still stands.
-- ---------------------------------------------------------------------------

drop function if exists public.void_invoice(uuid, text);

create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare target public.invoices;
begin
  perform public.assert_billing_office();
  if public.current_account_role() <> 'ADMIN' then raise exception 'Only an admin can void an invoice.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Write why the invoice is being voided.'; end if;
  select * into target from public.invoices i where i.id = p_invoice_id for update;
  if target.id is null then raise exception 'That invoice was not found.'; end if;
  if target.status = 'VOID' then raise exception 'That invoice was already voided.'; end if;
  if exists (
    select 1 from public.payments p
    where p.invoice_id = target.id and p.reversed_at is null
      and not (p.method = 'CHECK' and p.check_status = 'BOUNCED')
  ) then
    raise exception 'Invoice % has payments on it. Reverse them first.', target.reference;
  end if;

  update public.invoices i set status = 'VOID', voided_at = now(), voided_by = public.current_account_id(), void_reason = trim(p_reason)
  where i.id = target.id returning * into target;
  -- Free the visits and extras for a corrected invoice. The void keeps its
  -- lines, which still name them, as the record of what it billed.
  update public.appointments a set invoice_id = null where a.invoice_id = target.id;
  update public.appointment_extras e set invoice_id = null where e.invoice_id = target.id;
  return target;
end;
$$;

grant execute on function public.void_invoice(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. record_payment: the down payment on a quote (061), or a payment on an
--    invoice, full or partial. What is still due counts pending checks too,
--    so two checks for the same balance are not both accepted; a bounced
--    check drops out, which puts the balance back.
-- ---------------------------------------------------------------------------

drop function if exists public.record_payment(jsonb);

create function public.record_payment(p_payment jsonb)
returns public.payments
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  q_row public.quotes;
  inv public.invoices;
  created public.payments;
  v_kind text := upper(coalesce(p_payment->>'kind', ''));
  v_amount numeric := (p_payment->>'amount')::numeric;
  v_paid_on date := coalesce((p_payment->>'paid_on')::date, today);
  v_method text := upper(coalesce(p_payment->>'method', ''));
  v_client uuid;
  already numeric;
begin
  perform public.assert_billing_office();

  if v_kind not in ('DEPOSIT', 'PAYMENT') then raise exception 'A payment is a down payment or a payment on an invoice.'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if v_paid_on > today then raise exception 'A payment cannot be dated in the future.'; end if;
  if v_method not in ('CASH', 'BANK_TRANSFER', 'GCASH', 'CHECK') then raise exception 'Choose how it was paid.'; end if;
  if v_method = 'CHECK' and nullif(trim(coalesce(p_payment->>'check_number', '')), '') is null then
    raise exception 'Enter the check number.';
  end if;

  if v_kind = 'DEPOSIT' then
    select * into q_row from public.quotes q where q.id = nullif(p_payment->>'quote_id', '')::uuid for update;
    if q_row.id is null then raise exception 'That quote was not found.'; end if;
    if q_row.status <> 'APPROVED' then raise exception 'A down payment is taken on an approved quote.'; end if;
    select coalesce(sum(p.amount), 0) into already
    from public.payments p where p.quote_id = q_row.id and p.kind = 'DEPOSIT' and p.reversed_at is null
      and not (p.method = 'CHECK' and p.check_status = 'BOUNCED');
    if already + v_amount > q_row.total then
      raise exception 'That would take more than the quote total (₱%). Already received: ₱%.', q_row.total, already;
    end if;
    v_client := q_row.client_id;
  else
    select * into inv from public.invoices i where i.id = nullif(p_payment->>'invoice_id', '')::uuid for update;
    if inv.id is null then raise exception 'That invoice was not found.'; end if;
    if inv.status = 'VOID' then raise exception 'Invoice % was voided.', inv.reference; end if;
    select coalesce(sum(p.amount), 0) into already
    from public.payments p where p.invoice_id = inv.id and p.kind = 'PAYMENT' and p.reversed_at is null
      and not (p.method = 'CHECK' and p.check_status = 'BOUNCED');
    if already + v_amount > inv.amount_due then
      raise exception 'That is more than the ₱% still due on %.', greatest(inv.amount_due - already, 0), inv.reference;
    end if;
    v_client := inv.client_id;
  end if;

  insert into public.payments (
    client_id, quote_id, invoice_id, kind, amount, paid_on, method, reference_no,
    check_number, check_bank, check_date, check_status, notes, received_by, received_by_name
  )
  values (
    v_client, q_row.id, inv.id, v_kind, round(v_amount, 2), v_paid_on, v_method,
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

grant execute on function public.record_payment(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
