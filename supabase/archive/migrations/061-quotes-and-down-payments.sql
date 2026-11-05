-- ---------------------------------------------------------------------------
-- Migration 061 - Quotes and down payments.
--
-- Run after 060-pricing-foundations.sql.
--
-- Before any work, the office prepares a QUOTE: what the client will pay.
--
--   quotes         TPC-Q-00001. Client, validity date, payment terms, the area
--                  (sqm) for area-priced services, a discount (₱ or %), VAT
--                  (12% added, included, or none), and the DOWN PAYMENT it
--                  requires (none, ₱ or % of the total). The totals are
--                  computed here, never trusted from the browser.
--   quote_lines    the services, materials and extra work, in order. Prices
--                  start from the catalog (060) but the office may adjust a
--                  line; a quote is a negotiated price.
--
--   Status: DRAFT -> SENT -> APPROVED | REJECTED. A SENT quote past its
--   validity date counts as expired: it cannot be approved (the app shows it
--   as Expired; nothing needs to rewrite the row). APPROVED and REJECTED are
--   final — a change is a REVISION, a new draft copying the old one
--   (revision_of). Editing a SENT quote puts it back to DRAFT, to be sent again.
--
--   payments       TPC-R-00001, one row per payment received — the receipt
--                  number. Here, the down payment on an approved quote
--                  (kind DEPOSIT); migration 062 adds invoice payments. A
--                  check counts only once it clears; a bounced check never
--                  counts. A payment is never deleted: a mistake is REVERSED,
--                  with a reason, by an admin.
--
--   appointments.quote_id
--                  the visit(s) booked from an approved quote. Booking is
--                  refused until the required down payment has been paid.
--
-- Everything is written through the functions below, which carry the rules;
-- the office (admin and staff) can use them, technicians cannot see billing.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Who may use billing.
-- ---------------------------------------------------------------------------

create or replace function public.assert_billing_office()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can use billing.';
  end if;
end;
$$;

revoke all on function public.assert_billing_office() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quotes.
-- ---------------------------------------------------------------------------

create sequence if not exists public.quote_reference_seq as bigint start 1;

create table if not exists public.quotes (
  id              uuid        primary key default gen_random_uuid(),
  reference       text        not null default 'TPC-Q-' || lpad(nextval('public.quote_reference_seq')::text, 5, '0'),
  client_id       uuid        not null references public.clients(id) on delete restrict,
  status          text        not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'APPROVED', 'REJECTED')),
  valid_until     date        not null,
  payment_terms   text        not null default 'DUE_ON_RECEIPT' check (payment_terms in ('DUE_ON_RECEIPT', 'NET_15', 'NET_30')),
  area_sqm        numeric     check (area_sqm is null or (area_sqm > 0 and area_sqm <= 1000000)),
  discount_type   text        not null default 'AMOUNT' check (discount_type in ('AMOUNT', 'PERCENT')),
  discount_value  numeric     not null default 0 check (discount_value >= 0),
  vat_mode        text        not null default 'ADDED' check (vat_mode in ('ADDED', 'INCLUSIVE', 'NONE')),
  vat_rate        numeric     not null default 12 check (vat_rate >= 0 and vat_rate <= 100),
  deposit_type    text        not null default 'NONE' check (deposit_type in ('NONE', 'AMOUNT', 'PERCENT')),
  deposit_value   numeric     not null default 0 check (deposit_value >= 0),
  subtotal        numeric     not null default 0,
  discount_amount numeric     not null default 0,
  vat_amount      numeric     not null default 0,
  total           numeric     not null default 0 check (total >= 0 and total <= 9999999999),
  deposit_amount  numeric     not null default 0 check (deposit_amount >= 0),
  notes           text,
  revision_of     uuid        references public.quotes(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz,
  decided_at      timestamptz,
  decided_by      uuid,
  decision_note   text
);

create unique index if not exists quotes_reference_key on public.quotes (reference);
create index if not exists quotes_client_idx on public.quotes (client_id);

comment on table public.quotes is
  'A price offered to a client before work begins. Totals are computed by save_quote(); DRAFT -> SENT -> APPROVED | REJECTED.';

create table if not exists public.quote_lines (
  id          uuid    primary key default gen_random_uuid(),
  quote_id    uuid    not null references public.quotes(id) on delete cascade,
  position    integer not null,
  kind        text    not null check (kind in ('SERVICE', 'MATERIAL', 'EXTRA')),
  service_id  uuid    references public.services(id) on delete set null,
  item_id     uuid    references public.inventory(id) on delete set null,
  description text    not null check (char_length(description) between 1 and 300),
  quantity    numeric not null check (quantity > 0 and quantity <= 1000000),
  unit        text,
  unit_price  numeric not null check (unit_price >= 0 and unit_price <= 999999.99),
  amount      numeric not null check (amount >= 0)
);

create index if not exists quote_lines_quote_idx on public.quote_lines (quote_id, position);
create index if not exists quote_lines_service_idx on public.quote_lines (service_id) where service_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Payments.
-- ---------------------------------------------------------------------------

create sequence if not exists public.payment_reference_seq as bigint start 1;

create table if not exists public.payments (
  id                uuid        primary key default gen_random_uuid(),
  reference         text        not null default 'TPC-R-' || lpad(nextval('public.payment_reference_seq')::text, 5, '0'),
  client_id         uuid        not null references public.clients(id) on delete restrict,
  quote_id          uuid        references public.quotes(id) on delete restrict,
  kind              text        not null check (kind in ('DEPOSIT', 'PAYMENT')),
  amount            numeric     not null check (amount > 0 and amount <= 9999999999),
  paid_on           date        not null,
  method            text        not null check (method in ('CASH', 'BANK_TRANSFER', 'GCASH', 'CHECK')),
  reference_no      text,
  check_number      text,
  check_bank        text,
  check_date        date,
  check_status      text        check (check_status in ('PENDING', 'CLEARED', 'BOUNCED')),
  check_status_on   date,
  check_status_note text,
  notes             text,
  received_by       uuid,
  received_by_name  text,
  created_at        timestamptz not null default now(),
  reversed_at       timestamptz,
  reversed_by       uuid,
  reversal_reason   text,
  constraint payments_check_fields check (
    (method = 'CHECK' and check_status is not null and nullif(trim(coalesce(check_number, '')), '') is not null)
    or (method <> 'CHECK' and check_status is null)
  )
);

create unique index if not exists payments_reference_key on public.payments (reference);
create index if not exists payments_quote_idx on public.payments (quote_id) where quote_id is not null;
create index if not exists payments_client_idx on public.payments (client_id);

comment on table public.payments is
  'Money received, one row per receipt (TPC-R). Never deleted: a mistake is reversed with a reason. A check counts only when CLEARED.';

-- What a payment is worth right now: nothing once reversed, and a check only
-- once it has cleared.
create or replace function public.payment_counts(p_payment public.payments)
returns boolean
language sql immutable
as $$
  select p_payment.reversed_at is null
     and (p_payment.method <> 'CHECK' or p_payment.check_status = 'CLEARED');
$$;

-- The down payment received on a quote so far.
create or replace function public.quote_deposit_paid(p_quote_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(p.amount), 0)
  from public.payments p
  where p.quote_id = p_quote_id and p.kind = 'DEPOSIT' and public.payment_counts(p);
$$;

-- ---------------------------------------------------------------------------
-- 4. The visit a quote was booked as.
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column if not exists quote_id uuid references public.quotes(id) on delete set null;

create index if not exists appointments_quote_idx on public.appointments (quote_id) where quote_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Reading: the office only.
-- ---------------------------------------------------------------------------

alter table public.quotes      enable row level security;
alter table public.quote_lines enable row level security;
alter table public.payments    enable row level security;

drop policy if exists "Quote read" on public.quotes;
create policy "Quote read" on public.quotes
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

drop policy if exists "Quote line read" on public.quote_lines;
create policy "Quote line read" on public.quote_lines
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

drop policy if exists "Payment read" on public.payments;
create policy "Payment read" on public.payments
  for select using (public.current_account_role() in ('ADMIN', 'STAFF'));

revoke all on public.quotes, public.quote_lines, public.payments from anon, authenticated;
grant select on public.quotes, public.quote_lines, public.payments to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A service on a quote is in use (060's rule): retire it, don't delete it.
-- ---------------------------------------------------------------------------

create or replace function public.service_in_use(p_service_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.appointments a where a.service_id = p_service_id)
      or exists (select 1 from public.appointment_services s where s.service_id = p_service_id)
      or exists (select 1 from public.quote_lines l where l.service_id = p_service_id);
$$;

-- ---------------------------------------------------------------------------
-- 7. Saving a quote: the totals are worked out here.
--
--    subtotal  = sum of line amounts (quantity × unit price)
--    discount  = a ₱ amount (at most the subtotal) or a % of it
--    VAT       ADDED:     on top of what remains
--              INCLUSIVE: already inside it (shown, not added)
--              NONE
--    deposit   none, a ₱ amount (at most the total), or a % of the total
-- ---------------------------------------------------------------------------

drop function if exists public.save_quote(uuid, jsonb, jsonb);

create function public.save_quote(p_quote_id uuid, p_quote jsonb, p_lines jsonb)
returns public.quotes
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  target public.quotes;
  entry_row record;
  lines_total numeric := 0;
  discount numeric;
  net numeric;
  vat numeric;
  grand numeric;
  deposit numeric;
  line_no integer := 0;
  v_client uuid := (p_quote->>'client_id')::uuid;
  v_valid date := (p_quote->>'valid_until')::date;
  v_discount_type text := coalesce(p_quote->>'discount_type', 'AMOUNT');
  v_discount_value numeric := coalesce((p_quote->>'discount_value')::numeric, 0);
  v_vat_mode text := coalesce(p_quote->>'vat_mode', 'ADDED');
  v_vat_rate numeric := coalesce((p_quote->>'vat_rate')::numeric, 12);
  v_deposit_type text := coalesce(p_quote->>'deposit_type', 'NONE');
  v_deposit_value numeric := coalesce((p_quote->>'deposit_value')::numeric, 0);
begin
  perform public.assert_billing_office();

  if v_client is null or not exists (select 1 from public.clients c where c.id = v_client) then
    raise exception 'Choose the client for this quote.';
  end if;
  if v_valid is null then raise exception 'Set how long the quote is valid.'; end if;
  if v_valid < today then raise exception 'A quote cannot be valid only until a past date.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one service, material or extra to the quote.';
  end if;
  if v_discount_type = 'PERCENT' and v_discount_value > 100 then raise exception 'A discount cannot be more than 100%%.'; end if;
  if v_deposit_type = 'PERCENT' and v_deposit_value > 100 then raise exception 'A down payment cannot be more than 100%%.'; end if;

  if p_quote_id is not null then
    select * into target from public.quotes q where q.id = p_quote_id for update;
    if target.id is null then raise exception 'That quote was not found.'; end if;
    if target.status not in ('DRAFT', 'SENT') then
      raise exception 'Quote % is %: it can no longer be changed. Revise it to make a new version.', target.reference, lower(target.status);
    end if;
  end if;

  for entry_row in
    select entries.kind, entries.quantity, entries.unit_price
    from jsonb_to_recordset(p_lines) as entries(kind text, quantity numeric, unit_price numeric)
  loop
    if entry_row.quantity is null or entry_row.quantity <= 0 then raise exception 'Every line needs a quantity above zero.'; end if;
    if entry_row.unit_price is null or entry_row.unit_price < 0 then raise exception 'Every line needs a price.'; end if;
    lines_total := lines_total + round(entry_row.quantity * entry_row.unit_price, 2);
  end loop;

  discount := round(case when v_discount_type = 'PERCENT' then lines_total * v_discount_value / 100 else least(v_discount_value, lines_total) end, 2);
  net := lines_total - discount;
  vat := round(case v_vat_mode
    when 'ADDED' then net * v_vat_rate / 100
    when 'INCLUSIVE' then net - net / (1 + v_vat_rate / 100)
    else 0 end, 2);
  grand := case when v_vat_mode = 'ADDED' then net + vat else net end;
  deposit := round(case v_deposit_type
    when 'PERCENT' then grand * v_deposit_value / 100
    when 'AMOUNT' then least(v_deposit_value, grand)
    else 0 end, 2);

  if p_quote_id is null then
    insert into public.quotes (
      client_id, valid_until, payment_terms, area_sqm, discount_type, discount_value, vat_mode, vat_rate,
      deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount, notes,
      revision_of, created_by
    )
    values (
      v_client, v_valid, coalesce(p_quote->>'payment_terms', 'DUE_ON_RECEIPT'), nullif(p_quote->>'area_sqm', '')::numeric,
      v_discount_type, v_discount_value, v_vat_mode, v_vat_rate, v_deposit_type, v_deposit_value,
      lines_total, discount, vat, grand, deposit, nullif(trim(coalesce(p_quote->>'notes', '')), ''),
      nullif(p_quote->>'revision_of', '')::uuid, public.current_account_id()
    )
    returning * into target;
  else
    update public.quotes q set
      client_id = v_client, valid_until = v_valid,
      payment_terms = coalesce(p_quote->>'payment_terms', 'DUE_ON_RECEIPT'),
      area_sqm = nullif(p_quote->>'area_sqm', '')::numeric,
      discount_type = v_discount_type, discount_value = v_discount_value,
      vat_mode = v_vat_mode, vat_rate = v_vat_rate,
      deposit_type = v_deposit_type, deposit_value = v_deposit_value,
      subtotal = lines_total, discount_amount = discount, vat_amount = vat, total = grand, deposit_amount = deposit,
      notes = nullif(trim(coalesce(p_quote->>'notes', '')), ''),
      -- Changed after it was sent: it has to go out again.
      status = 'DRAFT', sent_at = null,
      updated_at = now()
    where q.id = p_quote_id
    returning * into target;
    delete from public.quote_lines l where l.quote_id = target.id;
  end if;

  for entry_row in
    select entries.kind, entries.service_id, entries.item_id, entries.description, entries.quantity, entries.unit, entries.unit_price
    from jsonb_to_recordset(p_lines) as entries(kind text, service_id uuid, item_id uuid, description text, quantity numeric, unit text, unit_price numeric)
  loop
    insert into public.quote_lines (quote_id, position, kind, service_id, item_id, description, quantity, unit, unit_price, amount)
    values (
      target.id, line_no, upper(entry_row.kind), entry_row.service_id, entry_row.item_id,
      trim(entry_row.description), entry_row.quantity, nullif(trim(coalesce(entry_row.unit, '')), ''),
      entry_row.unit_price, round(entry_row.quantity * entry_row.unit_price, 2)
    );
    line_no := line_no + 1;
  end loop;

  return target;
end;
$$;

grant execute on function public.save_quote(uuid, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Sending, deciding, revising, deleting.
-- ---------------------------------------------------------------------------

drop function if exists public.send_quote(uuid);

create function public.send_quote(p_quote_id uuid)
returns public.quotes
language plpgsql security definer set search_path = public
as $$
declare target public.quotes;
begin
  perform public.assert_billing_office();
  select * into target from public.quotes q where q.id = p_quote_id for update;
  if target.id is null then raise exception 'That quote was not found.'; end if;
  if target.status <> 'DRAFT' then raise exception 'Only a draft can be marked as sent.'; end if;
  if target.valid_until < (now() at time zone 'Asia/Manila')::date then
    raise exception 'This quote''s validity date has passed. Change it before sending.';
  end if;
  update public.quotes q set status = 'SENT', sent_at = now(), updated_at = now()
  where q.id = p_quote_id returning * into target;
  return target;
end;
$$;

grant execute on function public.send_quote(uuid) to anon, authenticated;

-- The client's answer. Approving an expired quote is refused: revise it.
drop function if exists public.decide_quote(uuid, boolean, text);

create function public.decide_quote(p_quote_id uuid, p_approved boolean, p_note text default null)
returns public.quotes
language plpgsql security definer set search_path = public
as $$
declare target public.quotes;
begin
  perform public.assert_billing_office();
  select * into target from public.quotes q where q.id = p_quote_id for update;
  if target.id is null then raise exception 'That quote was not found.'; end if;
  if target.status <> 'SENT' then raise exception 'Only a sent quote can be approved or rejected.'; end if;
  if p_approved and target.valid_until < (now() at time zone 'Asia/Manila')::date then
    raise exception 'Quote % expired on %. Revise it to send a new version.', target.reference, to_char(target.valid_until, 'Mon DD, YYYY');
  end if;
  if not p_approved and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Write why the quote was rejected.';
  end if;
  update public.quotes q set
    status = case when p_approved then 'APPROVED' else 'REJECTED' end,
    decided_at = now(), decided_by = public.current_account_id(),
    decision_note = nullif(trim(coalesce(p_note, '')), ''),
    updated_at = now()
  where q.id = p_quote_id returning * into target;
  return target;
end;
$$;

grant execute on function public.decide_quote(uuid, boolean, text) to anon, authenticated;

-- A new draft copying a quote, lines and all, for a changed price or an
-- expired quote. The old one stays as it was.
drop function if exists public.revise_quote(uuid);

create function public.revise_quote(p_quote_id uuid)
returns public.quotes
language plpgsql security definer set search_path = public
as $$
declare
  source public.quotes;
  created public.quotes;
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform public.assert_billing_office();
  select * into source from public.quotes q where q.id = p_quote_id;
  if source.id is null then raise exception 'That quote was not found.'; end if;

  insert into public.quotes (
    client_id, valid_until, payment_terms, area_sqm, discount_type, discount_value, vat_mode, vat_rate,
    deposit_type, deposit_value, subtotal, discount_amount, vat_amount, total, deposit_amount, notes,
    revision_of, created_by
  )
  values (
    source.client_id, greatest(source.valid_until, today + 30), source.payment_terms, source.area_sqm,
    source.discount_type, source.discount_value, source.vat_mode, source.vat_rate,
    source.deposit_type, source.deposit_value, source.subtotal, source.discount_amount, source.vat_amount,
    source.total, source.deposit_amount, source.notes, source.id, public.current_account_id()
  )
  returning * into created;

  insert into public.quote_lines (quote_id, position, kind, service_id, item_id, description, quantity, unit, unit_price, amount)
  select created.id, l.position, l.kind, l.service_id, l.item_id, l.description, l.quantity, l.unit, l.unit_price, l.amount
  from public.quote_lines l where l.quote_id = source.id;

  return created;
end;
$$;

grant execute on function public.revise_quote(uuid) to anon, authenticated;

-- A draft nobody has paid on or booked from can be thrown away.
drop function if exists public.delete_quote(uuid);

create function public.delete_quote(p_quote_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare target public.quotes;
begin
  perform public.assert_billing_office();
  select * into target from public.quotes q where q.id = p_quote_id for update;
  if target.id is null then raise exception 'That quote was not found.'; end if;
  if target.status <> 'DRAFT' then raise exception 'Only a draft can be deleted.'; end if;
  if exists (select 1 from public.payments p where p.quote_id = target.id)
     or exists (select 1 from public.appointments a where a.quote_id = target.id)
     or exists (select 1 from public.quotes q where q.revision_of = target.id) then
    raise exception 'This quote has payments, visits or revisions and is kept.';
  end if;
  delete from public.quotes q where q.id = target.id;
end;
$$;

grant execute on function public.delete_quote(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Payments: recording, reversing, and a check clearing or bouncing.
--
--    record_payment() here takes the down payment on an approved quote;
--    migration 062 recreates it to take invoice payments as well.
-- ---------------------------------------------------------------------------

create or replace function public.billing_actor_name()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(a.name, s.name, t.name)
  from (select public.current_account_id() as id) me
  left join public.admins a on a.id = me.id
  left join public.staff s on s.id = me.id
  left join public.technicians t on t.id = me.id;
$$;

revoke all on function public.billing_actor_name() from public, anon, authenticated;

drop function if exists public.record_payment(jsonb);

create function public.record_payment(p_payment jsonb)
returns public.payments
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  q_row public.quotes;
  created public.payments;
  v_kind text := upper(coalesce(p_payment->>'kind', ''));
  v_amount numeric := (p_payment->>'amount')::numeric;
  v_paid_on date := coalesce((p_payment->>'paid_on')::date, today);
  v_method text := upper(coalesce(p_payment->>'method', ''));
  already numeric;
begin
  perform public.assert_billing_office();

  if v_kind <> 'DEPOSIT' then raise exception 'Only a down payment can be recorded on a quote.'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if v_paid_on > today then raise exception 'A payment cannot be dated in the future.'; end if;
  if v_method not in ('CASH', 'BANK_TRANSFER', 'GCASH', 'CHECK') then raise exception 'Choose how it was paid.'; end if;
  if v_method = 'CHECK' and nullif(trim(coalesce(p_payment->>'check_number', '')), '') is null then
    raise exception 'Enter the check number.';
  end if;

  select * into q_row from public.quotes q where q.id = (p_payment->>'quote_id')::uuid for update;
  if q_row.id is null then raise exception 'That quote was not found.'; end if;
  if q_row.status <> 'APPROVED' then raise exception 'A down payment is taken on an approved quote.'; end if;

  -- Everything not reversed counts toward the limit, pending checks included:
  -- two checks for the whole down payment would otherwise both be accepted.
  select coalesce(sum(p.amount), 0) into already
  from public.payments p where p.quote_id = q_row.id and p.kind = 'DEPOSIT' and p.reversed_at is null
    and not (p.method = 'CHECK' and p.check_status = 'BOUNCED');
  if already + v_amount > q_row.total then
    raise exception 'That would take more than the quote total (₱%). Already received: ₱%.', q_row.total, already;
  end if;

  insert into public.payments (
    client_id, quote_id, kind, amount, paid_on, method, reference_no,
    check_number, check_bank, check_date, check_status, notes, received_by, received_by_name
  )
  values (
    q_row.client_id, q_row.id, 'DEPOSIT', round(v_amount, 2), v_paid_on, v_method,
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

-- A mistake is reversed, never deleted. Admin only.
drop function if exists public.reverse_payment(uuid, text);

create function public.reverse_payment(p_payment_id uuid, p_reason text)
returns public.payments
language plpgsql security definer set search_path = public
as $$
declare target public.payments;
begin
  perform public.assert_billing_office();
  if public.current_account_role() <> 'ADMIN' then raise exception 'Only an admin can reverse a payment.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Write why the payment is being reversed.'; end if;
  select * into target from public.payments p where p.id = p_payment_id for update;
  if target.id is null then raise exception 'That payment was not found.'; end if;
  if target.reversed_at is not null then raise exception 'That payment was already reversed.'; end if;
  update public.payments p set reversed_at = now(), reversed_by = public.current_account_id(), reversal_reason = trim(p_reason)
  where p.id = p_payment_id returning * into target;
  return target;
end;
$$;

grant execute on function public.reverse_payment(uuid, text) to anon, authenticated;

-- A check clears (it now counts) or bounces (it never will).
drop function if exists public.set_check_status(uuid, text, date, text);

create function public.set_check_status(p_payment_id uuid, p_status text, p_on date default null, p_note text default null)
returns public.payments
language plpgsql security definer set search_path = public
as $$
declare target public.payments;
begin
  perform public.assert_billing_office();
  if upper(coalesce(p_status, '')) not in ('CLEARED', 'BOUNCED') then raise exception 'A check either clears or bounces.'; end if;
  if upper(p_status) = 'BOUNCED' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Write why the check bounced.';
  end if;
  select * into target from public.payments p where p.id = p_payment_id for update;
  if target.id is null then raise exception 'That payment was not found.'; end if;
  if target.method <> 'CHECK' then raise exception 'That payment was not made by check.'; end if;
  if target.reversed_at is not null then raise exception 'That payment was reversed.'; end if;
  if target.check_status <> 'PENDING' then raise exception 'That check was already marked %.', lower(target.check_status); end if;
  update public.payments p set
    check_status = upper(p_status),
    check_status_on = coalesce(p_on, (now() at time zone 'Asia/Manila')::date),
    check_status_note = nullif(trim(coalesce(p_note, '')), '')
  where p.id = p_payment_id returning * into target;
  return target;
end;
$$;

grant execute on function public.set_check_status(uuid, text, date, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Booking from a quote.
--
--     The visit is booked the usual way (create_appointment / book_appointments,
--     with every guard), then linked here. The link is refused until an
--     approved quote's required down payment has been received.
-- ---------------------------------------------------------------------------

drop function if exists public.link_quote_appointments(uuid, uuid[]);

create function public.link_quote_appointments(p_quote_id uuid, p_appointment_ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  q_row public.quotes;
  paid numeric;
  linked integer;
begin
  perform public.assert_billing_office();
  select * into q_row from public.quotes q where q.id = p_quote_id;
  if q_row.id is null then raise exception 'That quote was not found.'; end if;
  if q_row.status <> 'APPROVED' then raise exception 'Only an approved quote can be booked.'; end if;
  paid := public.quote_deposit_paid(q_row.id);
  if q_row.deposit_amount > 0 and paid < q_row.deposit_amount then
    raise exception 'The down payment of ₱% has not been received yet (₱% so far).', q_row.deposit_amount, paid;
  end if;
  if exists (
    select 1 from public.appointments a
    where a.id = any(p_appointment_ids) and a.client_id is distinct from q_row.client_id
  ) then
    raise exception 'Those visits are for a different client.';
  end if;
  update public.appointments a set quote_id = q_row.id where a.id = any(p_appointment_ids);
  get diagnostics linked = row_count;
  return linked;
end;
$$;

grant execute on function public.link_quote_appointments(uuid, uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   select q.reference, q.status, q.total, q.deposit_amount,
--          public.quote_deposit_paid(q.id) as deposit_paid
--   from public.quotes q order by q.created_at desc;
-- ---------------------------------------------------------------------------
