// Warranty and checkups (Sprint 5, migration 078). The same rules as the
// server's warranty_window(): a contract's warranty runs from the day it was
// signed (became Active), a quotation's from the day its job was completed,
// for warranty_months. Checkups are ₱0 visits, monthly or quarterly, inside
// that window; a re-treatment is a ₱0 visit when pests come back under it.
// Visits that belong to a warranty carry warrantyKind, and are never invoiced.

export const WARRANTY_MONTH_OPTIONS = [3, 6, 12, 24];
export const CHECKUP_STEP_MONTHS = { MONTHLY: 1, QUARTERLY: 3 };

const dayOf = (value) => (value ? String(value).slice(0, 10) : "");
const localDay = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** "YYYY-MM-DD" plus whole months, clamped to the month's last day. */
export function addMonths(day, months) {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return localDay(target);
}

export const warrantyLabel = (months) => {
  if (!months) return "No warranty";
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? "" : "s"}`;
  return `${months} month${months === 1 ? "" : "s"}`;
};

/**
 * When the job behind a quotation was completed: its first completed visit,
 * on the day the client signed, else the day the report went in, else its
 * scheduled day (migration 083, the same as warranty_window()).
 */
export function quoteCompletedOn(quote, appointments = []) {
  const done = appointments
    .filter((visit) => visit.quoteId === quote?.id && visit.status === "Completed" && !visit.warrantyKind)
    .map((visit) => localDay(visit.signedAt || visit.reportSubmittedAt || visit.scheduledAt))
    .filter(Boolean)
    .sort();
  return done[0] || "";
}

/**
 * { type, source, reference, months, frequency, start, end } for a quote or
 * contract with a warranty; start/end are "" until it has started.
 */
export function warrantyOf(type, source, appointments = []) {
  if (!source?.warrantyMonths) return null;
  let start = "";
  if (type === "CONTRACT") {
    if (["ACTIVE", "ENDED"].includes(source.status)) start = localDay(source.activatedAt);
  } else if (source.status === "APPROVED") {
    start = quoteCompletedOn(source, appointments);
  }
  return {
    type,
    source,
    id: source.id,
    reference: source.reference,
    months: source.warrantyMonths,
    frequency: source.checkupFrequency || "",
    start,
    end: start ? addMonths(start, source.warrantyMonths) : "",
  };
}

/** NOT_STARTED, ACTIVE or ENDED on `now`. */
export function warrantyState(warranty, now = new Date()) {
  if (!warranty?.start) return "NOT_STARTED";
  const today = localDay(now);
  return today > warranty.end ? "ENDED" : "ACTIVE";
}

const belongsTo = (visit, warranty) => (warranty.type === "CONTRACT"
  ? visit.warrantyContractId === warranty.id
  : visit.warrantyQuoteId === warranty.id);

/** The warranty's checkups and re-treatments, and what is next. */
export function warrantyVisits(warranty, appointments = [], now = new Date()) {
  const own = appointments.filter((visit) => belongsTo(visit, warranty) && visit.status !== "Cancelled");
  const checkups = own.filter((visit) => visit.warrantyKind === "CHECKUP");
  const today = localDay(now);
  const next = checkups.filter((visit) => visit.status !== "Completed" && localDay(visit.scheduledAt) >= today)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0] || null;
  return {
    checkups,
    retreatments: own.filter((visit) => visit.warrantyKind === "RETREATMENT"),
    done: checkups.filter((visit) => visit.status === "Completed").length,
    next,
  };
}

/** How many checkups the warranty's frequency gives over its length. */
export function plannedCheckupCount(warranty) {
  const step = CHECKUP_STEP_MONTHS[warranty?.frequency];
  if (!step || !warranty?.months) return 0;
  return Math.floor(warranty.months / step);
}

/**
 * The checkup dates still to book: every step from the start, inside the
 * warranty, from today on, skipping any that already has a checkup within
 * 10 days. "YYYY-MM-DD", soonest first.
 */
export function checkupDatesToBook(warranty, appointments = [], now = new Date()) {
  const step = CHECKUP_STEP_MONTHS[warranty?.frequency];
  if (!step || !warranty?.start) return [];
  const today = localDay(now);
  const booked = warrantyVisits(warranty, appointments, now).checkups.map((visit) => new Date(localDay(visit.scheduledAt)).getTime());
  const near = (day) => booked.some((time) => Math.abs(time - new Date(day).getTime()) <= 10 * 86400000);
  const dates = [];
  for (let n = 1; n <= 120; n += 1) {
    const day = addMonths(warranty.start, n * step);
    if (day > warranty.end) break;
    if (day < today || near(day)) continue;
    dates.push(day);
  }
  return dates;
}

/** Every warranty a client has, newest first. */
export function clientWarranties(clientId, { quotes = [], contracts = [], appointments = [] } = {}) {
  const list = [
    ...contracts.filter((contract) => contract.clientId === clientId).map((contract) => warrantyOf("CONTRACT", contract, appointments)),
    ...quotes.filter((quote) => quote.clientId === clientId).map((quote) => warrantyOf("QUOTE", quote, appointments)),
  ].filter(Boolean);
  return list.sort((a, b) => (b.start || "9999").localeCompare(a.start || "9999"));
}

/**
 * The running warranty that covers `visit` on `day` (a follow-up of it), or
 * null: its contract's (by plan), or its quotation's.
 */
export function coveringWarranty(visit, { quotes = [], contracts = [], appointments = [] } = {}, day = localDay(new Date())) {
  if (!visit) return null;
  const candidates = [];
  const contract = contracts.find((entry) => entry.id === visit.warrantyContractId || (visit.planId && entry.planId === visit.planId));
  if (contract) candidates.push(warrantyOf("CONTRACT", contract, appointments));
  const quote = quotes.find((entry) => entry.id === (visit.quoteId || visit.warrantyQuoteId));
  if (quote) candidates.push(warrantyOf("QUOTE", quote, appointments));
  return candidates.find((warranty) => warranty?.start && day >= warranty.start && day <= warranty.end) || null;
}

/**
 * Checkups due within `withinDays` (or missed in the last 14) that are not
 * booked, for Needs attention. [{ warranty, dueOn, days }]
 */
export function checkupReminders({ quotes = [], contracts = [], appointments = [] } = {}, now = new Date(), withinDays = 7) {
  const today = new Date(localDay(now)).getTime();
  const warranties = [
    ...contracts.map((contract) => warrantyOf("CONTRACT", contract, appointments)),
    ...quotes.map((quote) => warrantyOf("QUOTE", quote, appointments)),
  ].filter((warranty) => warranty && warranty.frequency && warrantyState(warranty, now) === "ACTIVE");
  const due = [];
  warranties.forEach((warranty) => {
    const step = CHECKUP_STEP_MONTHS[warranty.frequency];
    const booked = warrantyVisits(warranty, appointments, now).checkups.map((visit) => new Date(localDay(visit.scheduledAt)).getTime());
    for (let n = 1; n <= 120; n += 1) {
      const day = addMonths(warranty.start, n * step);
      if (day > warranty.end) break;
      const days = Math.round((new Date(day).getTime() - today) / 86400000);
      if (days > withinDays) break;
      if (days < -14) continue;
      if (booked.some((time) => Math.abs(time - new Date(day).getTime()) <= 10 * 86400000)) continue;
      due.push({ warranty, dueOn: day, days });
      break;
    }
  });
  return due.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export { dayOf };

// ---- how a warranty visit is labelled everywhere (Sprint 5) -------------------
export const WARRANTY_KIND_LABELS = { CHECKUP: "Warranty checkup", RETREATMENT: "Warranty re-treatment" };

/** "Warranty checkup", "Warranty re-treatment", or "" for any other visit. */
export const warrantyKindLabel = (visit) => WARRANTY_KIND_LABELS[visit?.warrantyKind] || "";

/** A visit's one-line text with its warranty mark added: "General Pest Control · 🛡 Warranty re-treatment · free". */
export const withWarranty = (text, visit) => (visit?.warrantyKind
  ? [text, `🛡 ${warrantyKindLabel(visit)} · free`].filter(Boolean).join(" · ")
  : text);

/** The services a warranty's quotation or contract was sold for. */
export function warrantyServiceIds(warranty) {
  const source = warranty?.source;
  if (!source) return [];
  if (warranty.type === "CONTRACT") return source.serviceIds || [];
  return (source.lines || []).map((line) => line.serviceId).filter(Boolean);
}

/**
 * The client's warranty running on `day` that covers one of `serviceIds`, or
 * null: booking that service again is a free re-treatment, not a paid visit.
 */
export function runningWarrantyFor(clientId, serviceIds = [], records = {}, day = localDay(new Date())) {
  if (!clientId || !serviceIds.length) return null;
  return clientWarranties(clientId, records).find((warranty) => warranty.start
    && day >= warranty.start && day <= warranty.end
    && warrantyServiceIds(warranty).some((id) => serviceIds.includes(id))) || null;
}
