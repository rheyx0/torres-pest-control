// What is going on with a client right now, and the story of one job.
// Pure, unit-tested; drawn by the client profile.
//
//   clientNow     a few short lines for the top of the client profile:
//                 "Visit today at 9:00 AM · Karl", "Waiting for the down
//                 payment on TPC-Q-00013", "Invoice TPC-INV-00012 overdue"…
//   jobTimeline   one visit's steps, in order: quotation, down payment,
//                 booked, each status change, started, report, signed,
//                 invoiced, paid.

import { depositStatus, invoiceBalance, quoteStatus } from "./billing";
import { appointmentReference, crewOf, reportOwed } from "./scheduling";
import { formatPeso } from "./formatters";

const dayKey = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const time = (value) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (value) => new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * Short lines about what is happening now, most urgent first, at most `limit`.
 * tone: "now" (on site, today), "wait" (waiting on someone), "alert" (late,
 * overdue), "info".   [{ key, tone, text }]
 */
export function clientNow({ visits = [], quotes = [], invoices = [], payments = [], contracts = [], nameOf = () => "" } = {}, now = new Date(), limit = 4) {
  const notes = [];
  const today = dayKey(now);
  const crew = (visit) => crewOf(visit).map(nameOf).filter(Boolean).join(", ") || "no technician yet";
  const live = visits.filter((visit) => visit.status !== "Cancelled");

  live.filter((visit) => visit.status === "In progress").forEach((visit) => {
    notes.push({ key: `on-${visit.id}`, tone: "now", text: `${visit.serviceType || "Visit"} in progress now · ${crew(visit)} on site` });
  });
  live
    .filter((visit) => visit.status !== "In progress" && visit.status !== "Completed" && dayKey(visit.scheduledAt) === today)
    .forEach((visit) => notes.push({ key: `today-${visit.id}`, tone: "now", text: `Visit today at ${time(visit.scheduledAt)} · ${visit.serviceType || "service"} · ${crew(visit)}` }));
  if (!notes.length) {
    const next = live
      .filter((visit) => visit.status !== "Completed" && new Date(visit.scheduledAt) > now)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0];
    if (next) notes.push({ key: `next-${next.id}`, tone: "info", text: `Next visit ${day(next.scheduledAt)}, ${time(next.scheduledAt)} · ${next.serviceType || "service"} · ${crew(next)}` });
  }

  live
    .filter((visit) => new Date(visit.scheduledAt) < now && visit.status !== "Completed" && visit.status !== "In progress" && reportOwed(visit) && dayKey(visit.scheduledAt) !== today)
    .forEach((visit) => notes.push({ key: `report-${visit.id}`, tone: "alert", text: `${appointmentReference(visit)} (${day(visit.scheduledAt)}) has no report yet` }));
  live
    .filter((visit) => visit.status === "Completed" && !visit.invoiceId)
    .slice(0, 2)
    .forEach((visit) => notes.push({ key: `bill-${visit.id}`, tone: "wait", text: `${appointmentReference(visit)} is done, not invoiced yet` }));

  invoices.forEach((invoice) => {
    const balance = invoiceBalance(invoice, payments, now);
    if (balance.state === "OVERDUE") notes.push({ key: `inv-${invoice.id}`, tone: "alert", text: `Invoice ${invoice.reference} is overdue · ${formatPeso(balance.balance)} still owed` });
    else if (balance.state === "UNPAID" || balance.state === "PARTIAL") notes.push({ key: `inv-${invoice.id}`, tone: "wait", text: `Invoice ${invoice.reference} · ${formatPeso(balance.balance)} due ${day(`${invoice.dueOn}T00:00:00`)}` });
  });
  quotes.forEach((quote) => {
    const status = quoteStatus(quote, now);
    if (status === "SENT") notes.push({ key: `q-${quote.id}`, tone: "wait", text: `Quotation ${quote.reference} sent · waiting for the client's answer` });
    if (status === "APPROVED") {
      const deposit = depositStatus(quote, payments);
      if (deposit.state === "DUE" || deposit.state === "PARTIAL") notes.push({ key: `q-${quote.id}`, tone: "wait", text: `Quotation ${quote.reference} approved · waiting for the down payment (${formatPeso(deposit.remaining)})` });
      if (deposit.state === "PENDING_CHECK") notes.push({ key: `q-${quote.id}`, tone: "wait", text: `Quotation ${quote.reference} · down payment check not cleared yet` });
    }
  });
  live
    .filter((visit) => visit.followUpDate && visit.status === "Completed")
    .forEach((visit) => {
      const booked = live.some((other) => other.followUpOf === visit.id || (other.id !== visit.id && new Date(other.scheduledAt) > new Date(visit.scheduledAt)));
      if (!booked) notes.push({ key: `fu-${visit.id}`, tone: "wait", text: `Follow-up due ${day(`${String(visit.followUpDate).slice(0, 10)}T00:00:00`)} · not booked yet` });
    });
  contracts.filter((contract) => contract.status === "ACTIVE").forEach((contract) => {
    const planVisits = contract.planId ? live.filter((visit) => visit.planId === contract.planId) : [];
    const done = planVisits.filter((visit) => visit.status === "Completed").length;
    notes.push({ key: `k-${contract.id}`, tone: "info", text: `On contract ${contract.reference}${planVisits.length ? ` · ${done} of ${planVisits.length} visits done` : " · visits not booked yet"}` });
  });

  const order = { now: 0, alert: 1, wait: 2, info: 3 };
  return notes.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, limit);
}

/**
 * One job's story, oldest first: [{ key, at, label, detail, done }]. A step
 * still to come (not booked, not invoiced…) has done false and no date.
 * statusHistory = [{ fromStatus, toStatus, changedAt, changedByName }] (066).
 */
export function jobTimeline(visit, { quote = null, invoice = null, payments = [], statusHistory = [], nameOf = () => "" } = {}) {
  if (!visit) return [];
  const steps = [];
  const add = (key, at, label, detail = "") => steps.push({ key, at: at || null, label, detail, done: Boolean(at) });

  if (quote) {
    if (quote.sentAt) add("q-sent", quote.sentAt, `Quotation ${quote.reference} sent`, formatPeso(quote.total));
    if (quote.status === "APPROVED" || quote.decidedAt) add("q-ok", quote.decidedAt || quote.sentAt, `Quotation ${quote.reference} ${quote.status === "REJECTED" ? "rejected" : "approved"}`);
    payments
      .filter((payment) => payment.quoteId === quote.id && payment.kind === "DEPOSIT" && !payment.reversedAt)
      .forEach((payment) => add(`dp-${payment.id}`, `${payment.paidOn}T12:00:00`, "Down payment received", `${formatPeso(payment.amount)} · ${payment.reference || ""}`.trim()));
  }

  add("booked", visit.createdAt, `Booked ${appointmentReference(visit)}`, `For ${new Date(visit.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
  statusHistory
    .filter((entry) => entry.fromStatus)
    .forEach((entry, index) => add(`s-${index}`, entry.changedAt, `${entry.fromStatus} → ${entry.toStatus}`, entry.changedByName || ""));
  if (visit.startedAt) add("started", visit.startedAt, "Started on site", crewOf(visit).map(nameOf).filter(Boolean).join(", "));
  if (visit.reportSubmittedAt) add("report", visit.reportSubmittedAt, "Report filed", visit.serviceType || "");
  if (visit.signedAt) add("signed", visit.signedAt, "Signed by the customer", visit.customerName || "");

  if (invoice) {
    add("invoiced", `${invoice.issuedOn}T12:00:00`, `Invoiced on ${invoice.reference}`, formatPeso(invoice.amountDue));
    payments
      .filter((payment) => payment.invoiceId === invoice.id && payment.kind === "PAYMENT" && !payment.reversedAt)
      .forEach((payment) => add(`pay-${payment.id}`, `${payment.paidOn}T12:00:00`, "Payment received", `${formatPeso(payment.amount)} · ${payment.reference || ""}`.trim()));
  }

  const dated = steps.filter((step) => step.at).sort((a, b) => new Date(a.at) - new Date(b.at));
  // What is still to come, in the order a job goes.
  const pending = [];
  if (visit.status !== "Cancelled") {
    if (!visit.reportSubmittedAt && visit.status !== "Completed") pending.push({ key: "todo-visit", at: null, label: "Visit to be done", detail: "", done: false });
    if (!invoice) pending.push({ key: "todo-invoice", at: null, label: "To be invoiced", detail: "", done: false });
    else if (invoiceBalance(invoice, payments).state !== "PAID" && invoiceBalance(invoice, payments).state !== "VOID") {
      pending.push({ key: "todo-pay", at: null, label: "Payment still owed", detail: formatPeso(invoiceBalance(invoice, payments).balance), done: false });
    }
  }
  return [...dated, ...pending];
}
