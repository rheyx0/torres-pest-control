import { useMemo } from "react";
import { useBillingContext, useOptionalBillingContext } from "../context/BillingContext";

function withLookups(context) {
  const { quotes, payments, invoices = [], extras = [], contracts = [] } = context;
  const quotesById = new Map(quotes.map((quote) => [quote.id, quote]));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  return {
    ...context,
    quoteById: (id) => (id ? quotesById.get(id) || null : null),
    invoiceById: (id) => (id ? invoicesById.get(id) || null : null),
    contractById: (id) => (id ? contractsById.get(id) || null : null),
    contractsForClient: (clientId) => contracts.filter((contract) => contract.clientId === clientId),
    quotesForClient: (clientId) => quotes.filter((quote) => quote.clientId === clientId),
    invoicesForClient: (clientId) => invoices.filter((invoice) => invoice.clientId === clientId),
    invoicesForQuote: (quoteId) => invoices.filter((invoice) => invoice.quoteId === quoteId),
    paymentsForClient: (clientId) => payments.filter((payment) => payment.clientId === clientId),
    paymentsForQuote: (quoteId) => payments.filter((payment) => payment.quoteId === quoteId),
    paymentsForInvoice: (invoiceId) => payments.filter((payment) => payment.invoiceId === invoiceId),
    extrasForVisit: (appointmentId) => extras.filter((extra) => extra.appointmentId === appointmentId),
  };
}

// Adds lookups: a quote, invoice or contract by id, and a client's, quote's, invoice's
// or visit's records. Components use this, not the context directly.
export default function useBilling() {
  const context = useBillingContext();
  return useMemo(() => withLookups(context), [context]);
}

/** The same, or null when no BillingProvider is mounted. */
export function useOptionalBilling() {
  const context = useOptionalBillingContext();
  return useMemo(() => (context ? withLookups(context) : null), [context]);
}
