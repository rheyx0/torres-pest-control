-- ---------------------------------------------------------------------------
-- Migration 071 - a paid invoice covers the down payment for booking.
--
-- Run after 070-staff-run-the-office.sql.
--
-- Booking under a quote (link_quote_appointments, 061) looked only at the
-- down payment recorded on the quote itself. A client who paid up front, on
-- an invoice issued from that quote, was still told the down payment had not
-- been received. What counts towards it now is the quote's cleared down
-- payment plus the cleared payments on the quote's live (not voided)
-- invoices: quote_booking_paid().
--
-- And once a quote has a live invoice, no more down payments are taken on
-- it (trigger payments_no_deposit_after_invoice): money goes on the invoice.
--
-- quote_deposit_paid() is left alone: it is still what an invoice deducts as
-- the down payment (062), so nothing is deducted twice.
--
-- This is now the source of truth for link_quote_appointments (from 061);
-- re-running 061 restores the deposit-only check, so re-run 071 after it.
-- The app's canBookFromQuote() (src/utils/billing.js) is the same rule.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create or replace function public.quote_booking_paid(p_quote_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select public.quote_deposit_paid(p_quote_id) + coalesce((
    select sum(p.amount)
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    where i.quote_id = p_quote_id
      and i.status <> 'VOID'
      and p.kind = 'PAYMENT'
      and public.payment_counts(p)
  ), 0);
$$;

grant execute on function public.quote_booking_paid(uuid) to anon, authenticated;

create or replace function public.link_quote_appointments(p_quote_id uuid, p_appointment_ids uuid[])
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
  paid := public.quote_booking_paid(q_row.id);
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

-- No down payment once the quote has a live invoice. The invoice deducted
-- the down payment received when it was issued; one recorded after it would
-- never be deducted, and the client would pay it twice. Money then goes on
-- the invoice. A trigger, so record_payment (062) is left as it is.
create or replace function public.payments_no_deposit_after_invoice()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.kind = 'DEPOSIT' and exists (
    select 1 from public.invoices i where i.quote_id = new.quote_id and i.status <> 'VOID'
  ) then
    raise exception 'This quotation already has an invoice. Record the payment on the invoice instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_no_deposit_after_invoice on public.payments;
create trigger payments_no_deposit_after_invoice
  before insert on public.payments
  for each row execute function public.payments_no_deposit_after_invoice();

notify pgrst, 'reload schema';
