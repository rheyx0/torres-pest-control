// Billing (Sprint 3): quotes and payments (migration 061), invoices and extras
// on a visit (062). Every write is an RPC that carries the rules and works out
// the totals; reads are the office's only (RLS). Before 061 the tables do not
// exist and billing reports itself unavailable rather than failing the app;
// before 062 there are simply no invoices.

import { supabase } from "./supabaseClient";

export function describeError(error) {
  if (!error) return "Unknown error";
  return [error.message || "Unknown error", error.details ? ` - ${error.details}` : "", error.hint ? ` (hint: ${error.hint})` : ""].join("");
}

const missingTable = (error) => /quotes|payments|quote_lines|does not exist|schema cache/i.test(`${error?.message || ""} ${error?.details || ""}`);
const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

// ---------------------------------------------------------------------------
// Row <-> app shape
// ---------------------------------------------------------------------------

export function mapQuoteLine(row) {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    serviceId: row.service_id || "",
    itemId: row.item_id || "",
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit || "",
    unitPrice: Number(row.unit_price),
    amount: Number(row.amount),
  };
}

export function mapQuoteRow(row) {
  return {
    id: row.id,
    reference: row.reference,
    clientId: row.client_id,
    status: row.status,
    validUntil: String(row.valid_until).slice(0, 10),
    paymentTerms: row.payment_terms,
    areaSqm: numberOrNull(row.area_sqm),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    vatMode: row.vat_mode,
    vatRate: Number(row.vat_rate),
    depositType: row.deposit_type,
    depositValue: Number(row.deposit_value) || 0,
    subtotal: Number(row.subtotal) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    vatAmount: Number(row.vat_amount) || 0,
    total: Number(row.total) || 0,
    depositAmount: Number(row.deposit_amount) || 0,
    notes: row.notes || "",
    revisionOf: row.revision_of || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at || "",
    decidedAt: row.decided_at || "",
    decisionNote: row.decision_note || "",
    lines: [...(row.quote_lines || [])].map(mapQuoteLine).sort((a, b) => a.position - b.position),
  };
}

export function mapPaymentRow(row) {
  return {
    id: row.id,
    reference: row.reference,
    clientId: row.client_id,
    quoteId: row.quote_id || "",
    invoiceId: row.invoice_id || "",
    kind: row.kind,
    amount: Number(row.amount),
    paidOn: String(row.paid_on).slice(0, 10),
    method: row.method,
    referenceNo: row.reference_no || "",
    checkNumber: row.check_number || "",
    checkBank: row.check_bank || "",
    checkDate: row.check_date ? String(row.check_date).slice(0, 10) : "",
    checkStatus: row.check_status || "",
    checkStatusOn: row.check_status_on ? String(row.check_status_on).slice(0, 10) : "",
    checkStatusNote: row.check_status_note || "",
    notes: row.notes || "",
    receivedByName: row.received_by_name || "",
    createdAt: row.created_at,
    reversedAt: row.reversed_at || "",
    reversalReason: row.reversal_reason || "",
  };
}

export function mapInvoiceLine(row) {
  return {
    ...mapQuoteLine(row),
    appointmentId: row.appointment_id || "",
    extraId: row.extra_id || "",
  };
}

export function mapInvoiceRow(row) {
  return {
    id: row.id,
    reference: row.reference,
    clientId: row.client_id,
    quoteId: row.quote_id || "",
    status: row.status,
    issuedOn: String(row.issued_on).slice(0, 10),
    paymentTerms: row.payment_terms,
    dueOn: String(row.due_on).slice(0, 10),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    vatMode: row.vat_mode,
    vatRate: Number(row.vat_rate),
    subtotal: Number(row.subtotal) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    vatAmount: Number(row.vat_amount) || 0,
    total: Number(row.total) || 0,
    depositApplied: Number(row.deposit_applied) || 0,
    amountDue: Number(row.amount_due) || 0,
    notes: row.notes || "",
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    voidedAt: row.voided_at || "",
    voidReason: row.void_reason || "",
    lines: [...(row.invoice_lines || [])].map(mapInvoiceLine).sort((a, b) => a.position - b.position),
  };
}

export function mapExtraRow(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    kind: row.kind,
    itemId: row.item_id || "",
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit || "",
    unitPrice: Number(row.unit_price),
    status: row.status,
    decisionNote: row.decision_note || "",
    invoiceId: row.invoice_id || "",
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const missingInvoices = (error) => /invoices|invoice_lines|appointment_extras|does not exist|schema cache/i.test(`${error?.message || ""} ${error?.details || ""}`);

/**
 * { quotes, payments, invoices, extras, available, invoicesAvailable, error }.
 * `available` is false before 061, `invoicesAvailable` before 062.
 */
export async function fetchBilling() {
  const [quotes, payments, invoices, extras] = await Promise.all([
    supabase.from("quotes").select("*, quote_lines(*)").order("created_at", { ascending: false }),
    supabase.from("payments").select("*").order("created_at", { ascending: false }),
    supabase.from("invoices").select("*, invoice_lines(*)").order("created_at", { ascending: false }),
    supabase.from("appointment_extras").select("*").order("created_at", { ascending: true }),
  ]);
  const empty = { quotes: [], payments: [], invoices: [], extras: [], invoicesAvailable: false };
  const error = quotes.error || payments.error;
  if (error && missingTable(error)) return { ...empty, available: false, error: null };
  if (error) return { ...empty, available: true, error: describeError(error) };
  const invoiceError = invoices.error || extras.error;
  if (invoiceError && !missingInvoices(invoiceError)) return { ...empty, available: true, error: describeError(invoiceError) };
  return {
    quotes: (quotes.data || []).map(mapQuoteRow),
    payments: (payments.data || []).map(mapPaymentRow),
    invoices: invoiceError ? [] : (invoices.data || []).map(mapInvoiceRow),
    extras: invoiceError ? [] : (extras.data || []).map(mapExtraRow),
    available: true,
    invoicesAvailable: !invoiceError,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

async function call(name, params, map = (data) => data) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) return { error: describeError(error) };
  return { data: map(Array.isArray(data) ? data[0] : data) };
}

/** Create (`quoteId` null) or change a draft/sent quote. The server computes the totals. */
export const saveQuote = (quoteId, quote, lines) => call("save_quote", {
  p_quote_id: quoteId || null,
  p_quote: {
    client_id: quote.clientId,
    valid_until: quote.validUntil,
    payment_terms: quote.paymentTerms,
    area_sqm: quote.areaSqm === "" || quote.areaSqm === null || quote.areaSqm === undefined ? null : Number(quote.areaSqm),
    discount_type: quote.discountType,
    discount_value: Number(quote.discountValue) || 0,
    vat_mode: quote.vatMode,
    vat_rate: Number(quote.vatRate),
    deposit_type: quote.depositType,
    deposit_value: Number(quote.depositValue) || 0,
    notes: quote.notes || null,
    revision_of: quote.revisionOf || null,
  },
  p_lines: lines.map((line) => ({
    kind: line.kind,
    service_id: line.serviceId || null,
    item_id: line.itemId || null,
    description: line.description,
    quantity: Number(line.quantity),
    unit: line.unit || null,
    unit_price: Number(line.unitPrice),
  })),
}, (row) => row && mapQuoteRow(row));

export const sendQuote = (quoteId) => call("send_quote", { p_quote_id: quoteId });
export const decideQuote = (quoteId, approved, note) => call("decide_quote", { p_quote_id: quoteId, p_approved: approved, p_note: note || null });
export const reviseQuote = (quoteId) => call("revise_quote", { p_quote_id: quoteId }, (row) => row && mapQuoteRow(row));
export const deleteQuote = (quoteId) => call("delete_quote", { p_quote_id: quoteId });
export const linkQuoteAppointments = (quoteId, appointmentIds) =>
  call("link_quote_appointments", { p_quote_id: quoteId, p_appointment_ids: appointmentIds });

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** A down payment on a quote (kind DEPOSIT, quoteId) or a payment on an invoice (kind PAYMENT, invoiceId). */
export const recordPayment = (payment) => call("record_payment", {
  p_payment: {
    kind: payment.kind,
    quote_id: payment.quoteId || null,
    invoice_id: payment.invoiceId || null,
    amount: Number(payment.amount),
    paid_on: payment.paidOn,
    method: payment.method,
    reference_no: payment.referenceNo || null,
    check_number: payment.checkNumber || null,
    check_bank: payment.checkBank || null,
    check_date: payment.checkDate || null,
    notes: payment.notes || null,
  },
}, (row) => row && mapPaymentRow(row));

export const reversePayment = (paymentId, reason) => call("reverse_payment", { p_payment_id: paymentId, p_reason: reason });
export const setCheckStatus = (paymentId, status, on, note) =>
  call("set_check_status", { p_payment_id: paymentId, p_status: status, p_on: on || null, p_note: note || null });

// ---------------------------------------------------------------------------
// Invoices and extras (062)
// ---------------------------------------------------------------------------

/** Issue an invoice. The server checks the visits and extras and works out the totals. */
export const createInvoice = (invoice, lines) => call("create_invoice", {
  p_invoice: {
    client_id: invoice.clientId,
    quote_id: invoice.quoteId || null,
    appointment_ids: invoice.appointmentIds || [],
    issued_on: invoice.issuedOn || null,
    payment_terms: invoice.paymentTerms,
    discount_type: invoice.discountType,
    discount_value: Number(invoice.discountValue) || 0,
    vat_mode: invoice.vatMode,
    vat_rate: Number(invoice.vatRate),
    notes: invoice.notes || null,
  },
  p_lines: lines.map((line) => ({
    kind: line.kind,
    service_id: line.serviceId || null,
    item_id: line.itemId || null,
    appointment_id: line.appointmentId || null,
    extra_id: line.extraId || null,
    description: line.description,
    quantity: Number(line.quantity),
    unit: line.unit || null,
    unit_price: Number(line.unitPrice),
  })),
}, (row) => row && mapInvoiceRow(row));

export const voidInvoice = (invoiceId, reason) => call("void_invoice", { p_invoice_id: invoiceId, p_reason: reason });

export const addVisitExtra = (appointmentId, extra) => call("add_visit_extra", {
  p_appointment_id: appointmentId,
  p_extra: {
    item_id: extra.itemId || null,
    description: extra.description,
    quantity: Number(extra.quantity),
    unit: extra.unit || null,
    unit_price: Number(extra.unitPrice),
    status: extra.status || "PROPOSED",
  },
}, (row) => row && mapExtraRow(row));

export const decideVisitExtra = (extraId, approved, note) =>
  call("decide_visit_extra", { p_extra_id: extraId, p_approved: approved, p_note: note || null });
export const deleteVisitExtra = (extraId) => call("delete_visit_extra", { p_extra_id: extraId });

// ---------------------------------------------------------------------------
// Contracts (063)
// ---------------------------------------------------------------------------

export function mapContractRow(row) {
  return {
    id: row.id,
    reference: row.reference,
    clientId: row.client_id,
    quoteId: row.quote_id || "",
    planId: row.plan_id || "",
    title: row.title,
    serviceIds: row.service_ids || [],
    serviceNames: row.service_names || "",
    frequency: row.frequency,
    visitCount: row.visit_count ?? null,
    startsOn: String(row.starts_on).slice(0, 10),
    endsOn: row.ends_on ? String(row.ends_on).slice(0, 10) : "",
    pricePerVisit: Number(row.price_per_visit) || 0,
    billingSchedule: row.billing_schedule,
    paymentTerms: row.payment_terms,
    inclusions: row.inclusions || "",
    cancellationTerms: row.cancellation_terms || "",
    notes: row.notes || "",
    signedDocumentId: row.signed_document_id || "",
    status: row.status,
    activatedAt: row.activated_at || "",
    endedAt: row.ended_at || "",
    cancelledAt: row.cancelled_at || "",
    cancellationReason: row.cancellation_reason || "",
    createdAt: row.created_at,
  };
}

/** { contracts, available }. Before 063 there is no table: no contracts. */
export async function fetchContracts() {
  const { data, error } = await supabase.from("contracts").select("*").order("created_at", { ascending: false });
  if (error && /contracts|does not exist|schema cache/i.test(`${error.message || ""} ${error.details || ""}`)) return { contracts: [], available: false, error: null };
  if (error) return { contracts: [], available: true, error: describeError(error) };
  return { contracts: (data || []).map(mapContractRow), available: true, error: null };
}

export const saveContract = (contractId, contract) => call("save_contract", {
  p_contract_id: contractId || null,
  p_contract: {
    client_id: contract.clientId,
    quote_id: contract.quoteId || null,
    title: contract.title,
    service_ids: contract.serviceIds || [],
    frequency: contract.frequency,
    visit_count: contract.visitCount === "" || contract.visitCount === null || contract.visitCount === undefined ? null : Number(contract.visitCount),
    starts_on: contract.startsOn,
    ends_on: contract.endsOn || null,
    price_per_visit: Number(contract.pricePerVisit) || 0,
    billing_schedule: contract.billingSchedule,
    payment_terms: contract.paymentTerms,
    inclusions: contract.inclusions || null,
    cancellation_terms: contract.cancellationTerms || null,
    notes: contract.notes || null,
  },
}, (row) => row && mapContractRow(row));

export const attachContractDocument = (contractId, documentId) =>
  call("attach_contract_document", { p_contract_id: contractId, p_document_id: documentId }, (row) => row && mapContractRow(row));
export const setContractStatus = (contractId, status) =>
  call("set_contract_status", { p_contract_id: contractId, p_status: status }, (row) => row && mapContractRow(row));
export const cancelContract = (contractId, reason) =>
  call("cancel_contract", { p_contract_id: contractId, p_reason: reason }, (row) => row && mapContractRow(row));
export const linkContractPlan = (contractId, appointmentId) =>
  call("link_contract_plan", { p_contract_id: contractId, p_appointment_id: appointmentId }, (row) => row && mapContractRow(row));
export const deleteContract = (contractId) => call("delete_contract", { p_contract_id: contractId });
