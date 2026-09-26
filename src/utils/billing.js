// Billing arithmetic and states (Sprint 3, migrations 061+).
//
// The server works the totals out and is the authority (save_quote); this is
// the same formula, so a form can show them while they are typed:
//
//   subtotal  = sum of lines (quantity × unit price)
//   discount  = a ₱ amount (at most the subtotal) or a % of it
//   VAT       ADDED on top of what remains, INCLUSIVE already inside it, NONE
//   total
//   down payment  none, a ₱ amount (at most the total), or a % of the total

import {
  CONTRACT_STATUS_LABELS,
  INVOICE_STATE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TERMS,
  QUOTE_STATUS_LABELS,
  VAT_RATE,
} from "./constants";
import { formatPeso } from "./formatters";
import { materialCharge } from "./pricing";
import { appointmentReference } from "./scheduling";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const lineAmount = (line) => round2((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));

/** { subtotal, discountAmount, vatAmount, total, depositAmount } */
export function quoteTotals(lines = [], {
  discountType = "AMOUNT",
  discountValue = 0,
  vatMode = "ADDED",
  vatRate = VAT_RATE,
  depositType = "NONE",
  depositValue = 0,
} = {}) {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineAmount(line), 0));
  const discountAmount = round2(discountType === "PERCENT"
    ? subtotal * (Number(discountValue) || 0) / 100
    : Math.min(Number(discountValue) || 0, subtotal));
  const net = round2(subtotal - discountAmount);
  const rate = Number(vatRate) || 0;
  const vatAmount = round2(vatMode === "ADDED" ? net * rate / 100 : vatMode === "INCLUSIVE" ? net - net / (1 + rate / 100) : 0);
  const total = round2(vatMode === "ADDED" ? net + vatAmount : net);
  const depositAmount = round2(depositType === "PERCENT"
    ? total * (Number(depositValue) || 0) / 100
    : depositType === "AMOUNT" ? Math.min(Number(depositValue) || 0, total) : 0);
  return { subtotal, discountAmount, vatAmount, total, depositAmount };
}

/** A local "YYYY-MM-DD" for today. */
const todayKey = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The status to show: a sent quote past its validity date is Expired. */
export function quoteStatus(quote, now = new Date()) {
  if (quote?.status === "SENT" && quote.validUntil && quote.validUntil < todayKey(now)) return "EXPIRED";
  return quote?.status || "DRAFT";
}

/** A payment that counts: not reversed, and a check only once cleared. */
export const paymentCounts = (payment) =>
  !payment.reversedAt && (payment.method !== "CHECK" || payment.checkStatus === "CLEARED");

/**
 * Where a quote's down payment stands:
 * { required, paid, pending, remaining, state: NONE | DUE | PARTIAL | PENDING_CHECK | PAID }.
 * `pending` is checks received but not yet cleared.
 */
export function depositStatus(quote, payments = []) {
  const required = round2(quote?.depositAmount);
  const own = payments.filter((payment) => payment.quoteId === quote?.id && payment.kind === "DEPOSIT" && !payment.reversedAt);
  const paid = round2(own.filter(paymentCounts).reduce((sum, payment) => sum + payment.amount, 0));
  const pending = round2(own.filter((payment) => payment.method === "CHECK" && payment.checkStatus === "PENDING").reduce((sum, payment) => sum + payment.amount, 0));
  const remaining = round2(Math.max(0, required - paid));
  let state = "NONE";
  if (required > 0) {
    if (paid >= required) state = "PAID";
    else if (paid + pending >= required) state = "PENDING_CHECK";
    else if (paid > 0 || pending > 0) state = "PARTIAL";
    else state = "DUE";
  }
  return { required, paid, pending, remaining, state };
}

/** Whether visits can be booked from this quote now, and if not why. */
export function canBookFromQuote(quote, payments = [], now = new Date()) {
  if (quoteStatus(quote, now) !== "APPROVED") return { ok: false, reason: "Only an approved quote can be booked." };
  const deposit = depositStatus(quote, payments);
  if (deposit.state === "DUE" || deposit.state === "PARTIAL" || deposit.state === "PENDING_CHECK") {
    return { ok: false, reason: deposit.state === "PENDING_CHECK" ? "The down payment check has not cleared yet." : "The down payment has not been received yet." };
  }
  return { ok: true, reason: "" };
}

/** A validity date `days` from today, as "YYYY-MM-DD". */
export function validUntilFrom(days = 30, now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return todayKey(date);
}

// ---------------------------------------------------------------------------
// Invoices (migration 062).
// ---------------------------------------------------------------------------

/** The due date: the issue date plus the payment terms' days. */
export function dueDateFor(issuedOn, terms) {
  if (!issuedOn) return "";
  const days = PAYMENT_TERMS.find((term) => term.value === terms)?.days || 0;
  const [year, month, day] = issuedOn.split("-").map(Number);
  return todayKey(new Date(year, month - 1, day + days));
}

/**
 * Where an invoice stands:
 * { amountDue, paid, pending, balance, state: VOID | PAID | OVERDUE | PARTIAL | UNPAID }.
 * amountDue is after the down payment; `pending` is checks not yet cleared.
 * A bounced or reversed payment counts for nothing, so the balance comes back.
 */
export function invoiceBalance(invoice, payments = [], now = new Date()) {
  const own = payments.filter((payment) => payment.invoiceId === invoice?.id && payment.kind === "PAYMENT" && !payment.reversedAt);
  const paid = round2(own.filter(paymentCounts).reduce((sum, payment) => sum + payment.amount, 0));
  const pending = round2(own.filter((payment) => payment.method === "CHECK" && payment.checkStatus === "PENDING").reduce((sum, payment) => sum + payment.amount, 0));
  const amountDue = round2(invoice?.amountDue);
  const balance = round2(Math.max(0, amountDue - paid));
  let state = "UNPAID";
  if (invoice?.status === "VOID") state = "VOID";
  else if (balance <= 0) state = "PAID";
  else if (invoice?.dueOn && invoice.dueOn < todayKey(now)) state = "OVERDUE";
  else if (paid > 0) state = "PARTIAL";
  return { amountDue, paid, pending, balance, state };
}

/**
 * The down payment a new invoice on this quote deducts: what the quote has
 * received and counts, less what its other live invoices already deducted,
 * at most `total`. The server works it out the same way (create_invoice).
 */
export function depositToApply(quote, payments = [], invoices = [], total = Infinity) {
  if (!quote) return 0;
  const received = depositStatus(quote, payments).paid;
  const applied = invoices
    .filter((invoice) => invoice.quoteId === quote.id && invoice.status !== "VOID")
    .reduce((sum, invoice) => sum + (Number(invoice.depositApplied) || 0), 0);
  return round2(Math.max(0, Math.min(received - applied, total)));
}

/**
 * Every material a visit used, one invoice line per item, so the client sees
 * what went into the job:
 *   - covered by the service (Included, or within a "Charge extra" amount):
 *     a ₱0 line marked "included";
 *   - used beyond the included amount of a "Charge extra" material (060):
 *     charged at the item's customer price;
 *   - not in the service's list at all: a ₱0 line the office can price.
 * Two services listing the same item include both amounts.
 */
export function visitMaterialLines(visit, services = [], itemById = () => null) {
  const rules = new Map();
  services.forEach((service) => (service.materials || []).forEach((material) => {
    const rule = rules.get(material.itemId) || { itemId: material.itemId, billingMode: "INCLUDED", defaultAmount: 0 };
    rule.defaultAmount += Number(material.defaultAmount) || 0;
    if (material.billingMode === "EXTRA_CHARGED") rule.billingMode = "EXTRA_CHARGED";
    rules.set(material.itemId, rule);
  }));
  const used = new Map();
  (visit.stockUsed || []).forEach((entry) => used.set(entry.itemId, (used.get(entry.itemId) || 0) + (Number(entry.amount) || 0)));

  const reference = appointmentReference(visit);
  const lines = [];
  used.forEach((amount, itemId) => {
    const item = itemById(itemId);
    if (!item || !(amount > 0)) return;
    const unit = item.unit || "";
    const quantity = round2(amount);
    const rule = rules.get(itemId);
    const base = { kind: "MATERIAL", itemId: item.id, appointmentId: visit.id, unit };
    if (!rule) {
      lines.push({ ...base, description: `${item.name} (used, not in the service) · ${reference}`, quantity, unitPrice: 0 });
      return;
    }
    const charge = materialCharge(rule, amount, item);
    if (charge.amount > 0) {
      lines.push({ ...base, description: `${item.name}: ${quantity} ${unit} used, ${rule.defaultAmount} ${unit} included, extra charged · ${reference}`.replace(/\s+/g, " "), quantity: charge.extraQuantity, unitPrice: charge.unitPrice });
    } else {
      lines.push({ ...base, description: `${item.name} (included) · ${reference}`, quantity, unitPrice: 0 });
    }
  });
  return lines;
}

/**
 * The lines a new invoice starts with, all editable before it is issued:
 *   - the quote's lines, unless an earlier invoice already billed the quote;
 *   - without a quote, each visit at the price it was booked for (a
 *     multi-day job carries its price on Day 1 only, so the other days add
 *     no line);
 *   - every material the visits used (visitMaterialLines): included ones at
 *     ₱0, extra ones charged;
 *   - the visits' approved extras not yet on an invoice.
 */
export function draftInvoiceLines({ quote = null, quoteInvoiced = false, visits = [], extras = [], servicesFor = () => [], itemById = () => null }) {
  const lines = [];
  if (quote && !quoteInvoiced) {
    quote.lines.forEach((line) => lines.push({
      kind: line.kind,
      serviceId: line.serviceId || "",
      itemId: line.itemId || "",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit || "",
      unitPrice: line.unitPrice,
    }));
  }
  if (!quote) {
    visits.forEach((visit) => {
      if (!(Number(visit.price) > 0)) return;
      lines.push({
        kind: "SERVICE",
        serviceId: visit.serviceId || "",
        appointmentId: visit.id,
        description: `${visit.serviceType || "Service visit"} · ${appointmentReference(visit)}`,
        quantity: 1,
        unit: "visit",
        unitPrice: Number(visit.price),
      });
    });
  }
  visits.forEach((visit) => lines.push(...visitMaterialLines(visit, servicesFor(visit), itemById)));
  const visitIds = new Set(visits.map((visit) => visit.id));
  extras
    .filter((extra) => extra.status === "APPROVED" && !extra.invoiceId && visitIds.has(extra.appointmentId))
    .forEach((extra) => lines.push({
      kind: extra.itemId ? "MATERIAL" : "EXTRA",
      itemId: extra.itemId || "",
      appointmentId: extra.appointmentId,
      extraId: extra.id,
      description: extra.description,
      quantity: extra.quantity,
      unit: extra.unit || "",
      unitPrice: extra.unitPrice,
    }));
  return lines;
}

/** Visits that can go on an invoice: completed and not on a live one. */
export const invoiceableVisits = (appointments = [], clientId) =>
  appointments.filter((visit) => visit.clientId === clientId && visit.status === "Completed" && !visit.invoiceId);

/**
 * The billing figures on the office Today page (Sprint 3):
 *   outstanding     balance left on live invoices
 *   overdue         of which past the due date
 *   collected       money that counts, received this month (down payments too)
 *   pendingChecks   checks received but not yet cleared
 *   awaiting        quotes sent and still valid, waiting for the client
 *   depositsDue     approved quotes whose down payment hasn't come in
 *   toInvoice       completed visits not yet invoiced, since billing began
 *                   (the first quote or invoice), so older history isn't flagged
 * Each is { count, amount } (toInvoice: { count }).
 */
export function billingSummary({ quotes = [], invoices = [], payments = [], appointments = [] } = {}, now = new Date()) {
  const tally = () => ({ count: 0, amount: 0 });
  const add = (bucket, amount) => { bucket.count += 1; bucket.amount = round2(bucket.amount + amount); };
  const summary = { outstanding: tally(), overdue: tally(), collected: tally(), pendingChecks: tally(), awaiting: tally(), depositsDue: tally(), toInvoice: { count: 0 } };

  invoices.forEach((invoice) => {
    const balance = invoiceBalance(invoice, payments, now);
    if (balance.state === "VOID" || balance.balance <= 0) return;
    add(summary.outstanding, balance.balance);
    if (balance.state === "OVERDUE") add(summary.overdue, balance.balance);
  });

  const month = todayKey(now).slice(0, 7);
  payments.forEach((payment) => {
    if (paymentCounts(payment) && payment.paidOn?.slice(0, 7) === month) add(summary.collected, payment.amount);
    if (!payment.reversedAt && payment.method === "CHECK" && payment.checkStatus === "PENDING") add(summary.pendingChecks, payment.amount);
  });

  quotes.forEach((quote) => {
    const state = quoteStatus(quote, now);
    if (state === "SENT") add(summary.awaiting, quote.total);
    if (state === "APPROVED") {
      const deposit = depositStatus(quote, payments);
      if (deposit.state === "DUE" || deposit.state === "PARTIAL") add(summary.depositsDue, deposit.remaining);
    }
  });

  const starts = [...quotes, ...invoices].map((record) => record.createdAt).filter(Boolean).sort();
  if (starts.length) {
    const since = new Date(starts[0]);
    summary.toInvoice.count = appointments.filter((visit) => visit.status === "Completed" && !visit.invoiceId && new Date(visit.scheduledAt) >= since).length;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// A client's billing, for the client profile (Sprint 3).
// ---------------------------------------------------------------------------

const paymentPill = (payment) => {
  if (payment.reversedAt) return { status: "Reversed", tone: "neutral" };
  if (payment.method === "CHECK" && payment.checkStatus === "PENDING") return { status: "Pending check", tone: "warning" };
  if (payment.method === "CHECK" && payment.checkStatus === "BOUNCED") return { status: "Bounced", tone: "danger" };
  return { status: "Received", tone: "success" };
};

/**
 * Where a client stands:
 *   outstanding   balance left on their live invoices
 *   overdue       of which past the due date
 *   paid          money that counts, down payments and payments alike
 *   depositsHeld  down payments received but not yet deducted on an invoice
 */
export function clientBalance({ quotes = [], invoices = [], payments = [] } = {}, now = new Date()) {
  let outstanding = 0;
  let overdue = 0;
  invoices.forEach((invoice) => {
    const balance = invoiceBalance(invoice, payments, now);
    if (balance.state === "VOID") return;
    outstanding += balance.balance;
    if (balance.state === "OVERDUE") overdue += balance.balance;
  });
  const paid = payments.filter(paymentCounts).reduce((sum, payment) => sum + payment.amount, 0);
  const depositsHeld = quotes.reduce((sum, quote) => sum + depositToApply(quote, payments, invoices), 0);
  return { outstanding: round2(outstanding), overdue: round2(overdue), paid: round2(paid), depositsHeld: round2(depositsHeld) };
}

/**
 * The client's quotes, invoices, payments and contracts as timeline events:
 * { key, kind: "billing", at, title, detail, pill: { status, tone }, to }.
 * `to` opens the record on the Billing page.
 */
export function clientBillingEvents({ quotes = [], invoices = [], payments = [], contracts = [] } = {}, now = new Date()) {
  const QUOTE_TONES = { DRAFT: "neutral", SENT: "brand", APPROVED: "success", REJECTED: "danger", EXPIRED: "neutral" };
  const INVOICE_TONES = { VOID: "neutral", PAID: "success", PARTIAL: "warning", OVERDUE: "danger", UNPAID: "warning" };
  const CONTRACT_TONES = { DRAFT: "neutral", ACTIVE: "success", ENDED: "neutral", CANCELLED: "danger" };
  const byId = (list) => new Map(list.map((record) => [record.id, record]));
  const quotesById = byId(quotes);
  const invoicesById = byId(invoices);
  const events = [];

  quotes.forEach((quote) => {
    const state = quoteStatus(quote, now);
    events.push({
      key: `quote-${quote.id}`, kind: "billing", at: quote.createdAt,
      title: `Quote ${quote.reference}`,
      detail: [formatPeso(quote.total), quote.depositAmount > 0 ? `down payment ${formatPeso(quote.depositAmount)}` : null].filter(Boolean).join(" · "),
      pill: { status: QUOTE_STATUS_LABELS[state], tone: QUOTE_TONES[state] },
      to: `/billing?quote=${quote.id}`,
    });
  });
  invoices.forEach((invoice) => {
    const balance = invoiceBalance(invoice, payments, now);
    events.push({
      key: `invoice-${invoice.id}`, kind: "billing", at: invoice.createdAt || invoice.issuedOn,
      title: `Invoice ${invoice.reference}`,
      detail: invoice.status === "VOID"
        ? `Voided: ${invoice.voidReason}`
        : `${formatPeso(invoice.amountDue)} due ${invoice.dueOn}${balance.paid > 0 && balance.balance > 0 ? ` · ${formatPeso(balance.balance)} left` : ""}`,
      pill: { status: INVOICE_STATE_LABELS[balance.state], tone: INVOICE_TONES[balance.state] },
      to: `/billing?invoice=${invoice.id}`,
    });
  });
  payments.forEach((payment) => {
    const source = payment.kind === "DEPOSIT" ? quotesById.get(payment.quoteId) : invoicesById.get(payment.invoiceId);
    events.push({
      key: `payment-${payment.id}`, kind: "billing", at: payment.createdAt || payment.paidOn,
      title: `${payment.kind === "DEPOSIT" ? "Down payment" : "Payment"} ${payment.reference}`,
      detail: [formatPeso(payment.amount), PAYMENT_METHOD_LABELS[payment.method], source ? `on ${source.reference}` : null].filter(Boolean).join(" · "),
      pill: paymentPill(payment),
      to: payment.kind === "DEPOSIT" ? `/billing?quote=${payment.quoteId}` : `/billing?invoice=${payment.invoiceId}`,
    });
  });
  contracts.forEach((contract) => {
    events.push({
      key: `contract-${contract.id}`, kind: "billing", at: contract.createdAt,
      title: `Contract ${contract.reference} · ${contract.title}`,
      detail: `${contract.frequency} · ${formatPeso(contract.pricePerVisit)} per visit${contract.status === "CANCELLED" ? ` · ${contract.cancellationReason}` : ""}`,
      pill: { status: CONTRACT_STATUS_LABELS[contract.status], tone: CONTRACT_TONES[contract.status] },
      to: `/billing?contract=${contract.id}`,
    });
  });
  return events.filter((event) => event.at);
}
