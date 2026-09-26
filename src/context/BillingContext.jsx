// Billing (Sprint 3): quotes, payments, invoices and extras on a visit.
//
// Loaded for the office only (admin and staff) — technicians have no billing,
// and the database would return nothing to them anyway. Every change goes
// through an RPC that works out the totals, then the lists are reloaded and
// the action is written to the activity log.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as billingService from "../services/billingService";
import { addLog, LOG_TYPES } from "../services/logService";
import { ROLES } from "../utils/constants";
import { useAuthContext } from "./AuthContext";
import { useOptionalScheduling } from "./SchedulingContext";

const BillingContext = createContext(null);

const OFFICE = [ROLES.ADMIN, ROLES.STAFF];
const EMPTY = { quotes: [], payments: [], invoices: [], extras: [], contracts: [], available: true, invoicesAvailable: true, contractsAvailable: true, loading: false, error: "" };

export function BillingProvider({ children }) {
  const { currentUser, session, sessionVerified } = useAuthContext();
  const office = OFFICE.includes(currentUser?.role);
  // Starts loading so a page reading ?quote= waits for the first fetch.
  const scheduling = useOptionalScheduling();
  const refreshSchedule = scheduling?.refresh;
  const [state, setState] = useState({ ...EMPTY, loading: true });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const [result, contractResult] = await Promise.all([billingService.fetchBilling(), billingService.fetchContracts()]);
    setState({
      quotes: result.quotes, payments: result.payments, invoices: result.invoices, extras: result.extras, contracts: contractResult.contracts,
      available: result.available, invoicesAvailable: result.invoicesAvailable, contractsAvailable: contractResult.available,
      loading: false, error: result.error || contractResult.error || "",
    });
    return result;
  }, []);

  useEffect(() => {
    if (!session || !sessionVerified || !office) {
      // Still loading while an office session is being verified.
      setState({ ...EMPTY, loading: Boolean(session && office && !sessionVerified) });
      return;
    }
    refresh();
  }, [session, sessionVerified, office, refresh]);

  // Runs a billing RPC; on success reloads and logs. Resolves to the returned
  // row (or true) on success, the error message otherwise.
  const run = useCallback(async (call, logLine) => {
    const result = await call();
    if (result.error) return result.error;
    await refresh();
    if (logLine) addLog(currentUser?.name, typeof logLine === "function" ? logLine(result.data) : logLine, LOG_TYPES.CLIENT);
    return result.data ?? true;
  }, [refresh, currentUser?.name]);

  const actions = useMemo(() => ({
    saveQuote: (quoteId, quote, lines) => run(
      () => billingService.saveQuote(quoteId, quote, lines),
      (saved) => `${quoteId ? "Updated" : "Created"} quote ${saved?.reference || ""}.`.replace(" .", ".")
    ),
    sendQuote: (quote) => run(() => billingService.sendQuote(quote.id), `Marked quote ${quote.reference} as sent.`),
    decideQuote: (quote, approved, note) => run(
      () => billingService.decideQuote(quote.id, approved, note),
      `${approved ? "Approved" : "Rejected"} quote ${quote.reference}.`
    ),
    reviseQuote: (quote) => run(() => billingService.reviseQuote(quote.id), (created) => `Revised quote ${quote.reference} as ${created?.reference || "a new draft"}.`),
    deleteQuote: (quote) => run(() => billingService.deleteQuote(quote.id), `Deleted draft quote ${quote.reference}.`),
    // Sets appointments.quote_id, so the schedule reloads too.
    linkQuoteAppointments: async (quoteId, appointmentIds) => {
      const result = await run(() => billingService.linkQuoteAppointments(quoteId, appointmentIds));
      if (typeof result !== "string") await refreshSchedule?.();
      return result;
    },
    recordPayment: (payment, label) => run(
      () => billingService.recordPayment(payment),
      (saved) => `Recorded ${label || "a payment"} ${saved?.reference || ""} of ₱${Number(payment.amount).toLocaleString()}.`
    ),
    reversePayment: (payment, reason) => run(() => billingService.reversePayment(payment.id, reason), `Reversed payment ${payment.reference}: ${reason}`),
    setCheckStatus: (payment, status, on, note) => run(
      () => billingService.setCheckStatus(payment.id, status, on, note),
      `Marked check ${payment.checkNumber} (${payment.reference}) ${status.toLowerCase()}.`
    ),
    // Issuing and voiding move appointments.invoice_id, so the schedule reloads too.
    createInvoice: async (invoice, lines) => {
      const result = await run(() => billingService.createInvoice(invoice, lines), (saved) => `Issued invoice ${saved?.reference || ""}.`.replace(" .", "."));
      if (typeof result !== "string") await refreshSchedule?.();
      return result;
    },
    voidInvoice: async (invoice, reason) => {
      const result = await run(() => billingService.voidInvoice(invoice.id, reason), `Voided invoice ${invoice.reference}: ${reason}`);
      if (typeof result !== "string") await refreshSchedule?.();
      return result;
    },
    addVisitExtra: (appointmentId, extra, visitLabel) => run(
      () => billingService.addVisitExtra(appointmentId, extra),
      `Added extra "${extra.description}" to ${visitLabel || "a visit"}.`
    ),
    decideVisitExtra: (extra, approved, note) => run(
      () => billingService.decideVisitExtra(extra.id, approved, note),
      `${approved ? "Client approved" : "Client declined"} extra "${extra.description}".`
    ),
    deleteVisitExtra: (extra) => run(() => billingService.deleteVisitExtra(extra.id), `Removed extra "${extra.description}".`),
    // Contracts (063).
    saveContract: (contractId, contract) => run(
      () => billingService.saveContract(contractId, contract),
      (saved) => `${contractId ? "Updated" : "Created"} contract ${saved?.reference || ""}.`.replace(" .", ".")
    ),
    attachContractDocument: (contract, documentId) => run(() => billingService.attachContractDocument(contract.id, documentId), `Attached the signed copy of contract ${contract.reference}.`),
    setContractStatus: (contract, status) => run(
      () => billingService.setContractStatus(contract.id, status),
      `${status === "ACTIVE" ? "Activated" : "Ended"} contract ${contract.reference}.`
    ),
    // Cancelling cancels the plan's visits still to come, so the schedule reloads too.
    cancelContract: async (contract, reason) => {
      const result = await run(() => billingService.cancelContract(contract.id, reason), `Cancelled contract ${contract.reference}: ${reason}`);
      if (typeof result !== "string") await refreshSchedule?.();
      return result;
    },
    linkContractPlan: (contractId, appointmentId) => run(() => billingService.linkContractPlan(contractId, appointmentId)),
    deleteContract: (contract) => run(() => billingService.deleteContract(contract.id), `Deleted draft contract ${contract.reference}.`),
  }), [run, refreshSchedule]);

  const value = useMemo(() => ({ ...state, office, refresh, ...actions }), [state, office, refresh, actions]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBillingContext() {
  const context = useContext(BillingContext);
  if (!context) throw new Error("useBillingContext must be used inside <BillingProvider>.");
  return context;
}

/** The billing context, or null outside a BillingProvider (pages that only
 *  sometimes deal with money, like the Schedule's "book from a quote"). */
export function useOptionalBillingContext() {
  return useContext(BillingContext);
}
