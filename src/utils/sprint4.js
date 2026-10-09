// Sprint 4 rules, pure so they can be tested (migration 066):
//
//   paymentCheck           may this booking go ahead without a payment step?
//   followUpReminders      follow-up dates from reports with nothing booked
//   paymentReminders       invoices due in a few days, and overdue ones
//   contractInvoicesDue    what each contract's billing schedule says to bill
//   prepaidPlanIds         plans whose contract was billed up front

import { canBookFromQuote, invoiceBalance } from "./billing";
import { dayKey } from "./dashboardMetrics";
import { appointmentReference } from "./scheduling";

const DAY = 86400000;
const daysFrom = (fromKey, toKey) => Math.round((new Date(`${toKey}T00:00:00`) - new Date(`${fromKey}T00:00:00`)) / DAY);

// ---------------------------------------------------------------------------
// The payment check before booking.
// ---------------------------------------------------------------------------

/**
 * Whether a treatment may be booked for `client` without a payment step.
 * It may when the booking is made under a quote or contract (the form's
 * "Quote or contract" picker), every service on it is marked "Can be booked
 * without payment" (an inspection, a follow-up), or the client is marked to
 * skip the check. Otherwise it is refused, and the office either links it to
 * the quote or contract that pays for it, or books it with "Still make
 * appointment" and a reason.
 *
 * Only an unused one pays for a new booking: an approved quote whose down
 * payment is in and that no live visit was booked from yet, or an active
 * contract whose visits are not booked yet. An old quote already used for a
 * visit does not cover the next one. When one is ready it comes back as
 * `ready`, so the form can offer to book under it.
 *   { ok, via: source | service | client | none, reason, ready? { type, id, reference } }
 */
export function paymentCheck({ client, services = [], source = null, quotes = [], payments = [], invoices = [], contracts = [], appointments = [] }, now = new Date()) {
  if (!client) return { ok: true, via: "none", reason: "" };
  if (source) return { ok: true, via: "source", reason: "" };
  if (services.length > 0 && services.every((service) => service?.skipPaymentCheck)) return { ok: true, via: "service", reason: "" };
  if (client.skipPaymentCheck) return { ok: true, via: "client", reason: "" };

  const used = new Set(appointments.filter((visit) => visit.quoteId && visit.status !== "Cancelled").map((visit) => visit.quoteId));
  const quote = quotes.find((entry) => entry.clientId === client.id && !used.has(entry.id) && canBookFromQuote(entry, payments, now, invoices).ok);
  if (quote) {
    return {
      ok: false,
      via: "",
      ready: { type: "quote", id: quote.id, reference: quote.reference },
      reason: `${client.name} has approved quotation ${quote.reference} with its down payment paid. Book this visit under it.`,
    };
  }
  const contract = contracts.find((entry) => entry.clientId === client.id && entry.status === "ACTIVE" && !entry.planId);
  if (contract) {
    return {
      ok: false,
      via: "",
      ready: { type: "contract", id: contract.id, reference: contract.reference },
      reason: `${client.name} has active contract ${contract.reference}. Book its visits under it.`,
    };
  }
  return { ok: false, via: "", reason: `${client.name} has no approved quotation with its down payment paid that is not booked yet, and no active contract to book.` };
}

// ---------------------------------------------------------------------------
// Reminders.
// ---------------------------------------------------------------------------

/**
 * Follow-up dates set on a report (the visit's followUpDate) that fall within
 * `withinDays`, or have passed in the last 30 days, with nothing booked for
 * the client since that visit. Soonest first.
 *   [{ visit, client, dueOn, days }]   days < 0 when it has passed
 */
export function followUpReminders(appointments = [], clients = [], now = new Date(), withinDays = 7) {
  const today = dayKey(now);
  const clientById = new Map(clients.map((client) => [client.id, client]));
  return appointments
    .filter((visit) => visit.followUpDate && visit.status !== "Cancelled" && (visit.reportSubmitted || visit.status === "Completed"))
    .map((visit) => ({ visit, client: clientById.get(visit.clientId) || null, dueOn: String(visit.followUpDate).slice(0, 10) }))
    .map((entry) => ({ ...entry, days: daysFrom(today, entry.dueOn) }))
    .filter(({ days }) => days <= withinDays && days >= -30)
    .filter(({ visit }) => !appointments.some((other) => other.id !== visit.id
      && other.clientId === visit.clientId
      && other.status !== "Cancelled"
      && new Date(other.scheduledAt) > new Date(visit.scheduledAt)))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/**
 * Invoices due within `soonDays` and invoices past their due date, each with
 * what is still owed.   { dueSoon: [{ invoice, balance, days }], overdue: [...] }
 */
export function paymentReminders(invoices = [], payments = [], now = new Date(), soonDays = 3) {
  const today = dayKey(now);
  const dueSoon = [];
  const overdue = [];
  invoices.forEach((invoice) => {
    const balance = invoiceBalance(invoice, payments, now);
    if (balance.state === "VOID" || balance.state === "PAID") return;
    const days = daysFrom(today, invoice.dueOn);
    if (balance.state === "OVERDUE") overdue.push({ invoice, balance: balance.balance, days });
    else if (days >= 0 && days <= soonDays) dueSoon.push({ invoice, balance: balance.balance, days });
  });
  const byDue = (a, b) => a.invoice.dueOn.localeCompare(b.invoice.dueOn);
  return { dueSoon: dueSoon.sort(byDue), overdue: overdue.sort(byDue) };
}

// ---------------------------------------------------------------------------
// Contract invoicing.
// ---------------------------------------------------------------------------

/** Plans whose contract was billed up front: their visits are already paid for. */
export function prepaidPlanIds(contracts = [], invoices = []) {
  const billed = new Set(invoices.filter((invoice) => invoice.status !== "VOID" && invoice.contractId).map((invoice) => invoice.contractId));
  return new Set(contracts
    .filter((contract) => contract.billingSchedule === "UPFRONT" && contract.planId && billed.has(contract.id))
    .map((contract) => contract.planId));
}

const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });

/**
 * What each active or ended contract's billing schedule says is ready to bill:
 *   PER_VISIT  each completed visit of its plan not yet invoiced
 *   MONTHLY    a month's completed, uninvoiced visits, once the month is over
 *   UPFRONT    the whole contract, once, when no live invoice bills it yet
 * Each item opens the invoice form filled in, for the office to review and
 * issue: { key, contract, schedule, label, visits, lines }.
 */
export function contractInvoicesDue({ contracts = [], appointments = [], invoices = [] } = {}, now = new Date()) {
  const thisMonth = dayKey(now).slice(0, 7);
  const items = [];
  contracts
    .filter((contract) => contract.status === "ACTIVE" || contract.status === "ENDED")
    .forEach((contract) => {
      const planVisits = contract.planId ? appointments.filter((visit) => visit.planId === contract.planId) : [];
      const unbilled = planVisits
        .filter((visit) => visit.status === "Completed" && !visit.invoiceId)
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

      if (contract.billingSchedule === "UPFRONT") {
        const billed = invoices.some((invoice) => invoice.contractId === contract.id && invoice.status !== "VOID");
        if (billed || contract.status !== "ACTIVE") return;
        const count = contract.visitCount || planVisits.filter((visit) => visit.status !== "Cancelled").length || 1;
        items.push({
          key: `${contract.id}-upfront`,
          contract,
          schedule: "UPFRONT",
          label: `${contract.reference} · whole contract up front (${count} visit${count === 1 ? "" : "s"})`,
          visits: [],
          lines: [{ kind: "SERVICE", serviceId: contract.serviceIds?.[0] || "", description: `${contract.title} · ${contract.reference}`, quantity: count, unit: "visit", unitPrice: contract.pricePerVisit }],
        });
        return;
      }

      if (contract.billingSchedule === "MONTHLY") {
        const byMonth = new Map();
        unbilled.forEach((visit) => {
          const month = dayKey(visit.scheduledAt).slice(0, 7);
          if (month >= thisMonth) return; // the month is not over yet
          if (!byMonth.has(month)) byMonth.set(month, []);
          byMonth.get(month).push(visit);
        });
        byMonth.forEach((visits, month) => items.push({
          key: `${contract.id}-${month}`,
          contract,
          schedule: "MONTHLY",
          label: `${contract.reference} · ${monthLabel(month)} (${visits.length} visit${visits.length === 1 ? "" : "s"})`,
          visits,
          lines: null,
        }));
        return;
      }

      unbilled.forEach((visit) => items.push({
        key: `${contract.id}-${visit.id}`,
        contract,
        schedule: "PER_VISIT",
        label: `${contract.reference} · visit ${appointmentReference(visit)} (${new Date(visit.scheduledAt).toLocaleDateString([], { month: "short", day: "numeric" })})`,
        visits: [visit],
        lines: null,
      }));
    });
  return items;
}

// ---------------------------------------------------------------------------
// Follow-up visits (migration 068).
// ---------------------------------------------------------------------------

/**
 * What a follow-up of `original` costs: the follow-up price of each service
 * the client had on that visit, added up; a service with none set counts at
 * the Follow-up Visit service's own price. Null when nothing is priced, so
 * the booking form leaves the price for the office to fill in.
 */
export function followUpPriceFor(original, originalServices = [], followUpService = null) {
  const fallback = followUpService?.defaultPrice;
  const hasFallback = fallback !== null && fallback !== undefined && fallback !== "";
  if (!original) return null;
  if (originalServices.length === 0) return hasFallback ? Number(fallback) : null;
  let total = 0;
  let priced = false;
  originalServices.forEach((service) => {
    if (service?.followUpPrice !== null && service?.followUpPrice !== undefined) {
      total += Number(service.followUpPrice);
      priced = true;
    } else if (hasFallback) {
      total += Number(fallback);
      priced = true;
    }
  });
  return priced ? Math.round(total * 100) / 100 : null;
}

/** The catalog's Follow-up Visit service, by name; null when there is none. */
export const findFollowUpService = (services = []) =>
  services.find((service) => service.isActive !== false && /follow[\s-]?up/i.test(service.name || "")) || null;

// ---------------------------------------------------------------------------
// Inspection to quote.
// ---------------------------------------------------------------------------

/**
 * An inspection visit: one of its services is an inspection by name, or it
 * already has inspection results recorded.
 */
export function isInspectionVisit(visit, visitServices = []) {
  if (!visit) return false;
  if (visit.inspectionAreaSqm || (visit.recommendedServiceIds || []).length) return true;
  const names = [...visitServices.map((service) => service?.name), visit.serviceType].filter(Boolean);
  return names.some((name) => /inspect/i.test(name));
}
