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

const addDays = (day, count) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + count));
};
const shortDay = (day) => {
  const [y, m, d] = dayOf(day).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
 * The warranty's checkup periods (migration 086): one per step (1 month for
 * Monthly, 3 for Quarterly) counted from the day it started, as many as fit
 * whole in it. A period runs from the day after one step to the next step
 * day, both included: a 1-year Quarterly warranty from Oct 15 has Oct 16 –
 * Jan 15, Jan 16 – Apr 15, Apr 16 – Jul 15 and Jul 16 – Oct 15. Each period
 * takes one checkup, on any day inside it. [{ index, from, to }]
 */
export function checkupPeriods(warranty) {
  const step = CHECKUP_STEP_MONTHS[warranty?.frequency];
  if (!step || !warranty?.start) return [];
  const periods = [];
  for (let index = 0; index < plannedCheckupCount(warranty); index += 1) {
    const opens = addMonths(warranty.start, index * step);
    periods.push({ index, from: addDays(opens, 1), to: addMonths(warranty.start, (index + 1) * step) });
  }
  return periods;
}

/** The period "YYYY-MM-DD" falls in, or null (outside every period). */
export function checkupPeriodOf(warranty, day) {
  const key = dayOf(day);
  return checkupPeriods(warranty).find((period) => key >= period.from && key <= period.to) || null;
}

/** The live checkup already in each period: index -> visit. */
function checkupsByPeriod(warranty, appointments = [], now = new Date(), exceptId = null) {
  const taken = new Map();
  warrantyVisits(warranty, appointments, now).checkups
    .filter((visit) => visit.id !== exceptId)
    .forEach((visit) => {
      const period = checkupPeriodOf(warranty, localDay(visit.scheduledAt));
      if (period && !taken.has(period.index)) taken.set(period.index, visit);
    });
  return taken;
}

/**
 * The checkup dates still to book: one per period with no checkup yet that
 * has not ended, on the period's last day (its due date). "YYYY-MM-DD",
 * soonest first.
 */
export function checkupDatesToBook(warranty, appointments = [], now = new Date()) {
  const today = localDay(now);
  const taken = checkupsByPeriod(warranty, appointments, now);
  return checkupPeriods(warranty)
    .filter((period) => period.to >= today && !taken.has(period.index))
    .map((period) => period.to);
}

/**
 * What is wrong with booking checkups on `days`, or "": a day outside every
 * period, two days in one period, or a period that already has its checkup.
 * The server says the same (086).
 */
export function checkupProblem(warranty, appointments = [], days = [], now = new Date()) {
  const taken = checkupsByPeriod(warranty, appointments, now);
  const chosen = new Map();
  for (const day of days) {
    const period = checkupPeriodOf(warranty, day);
    if (!period) return `${shortDay(day)} is not inside one of this warranty's checkup periods.`;
    const range = `${shortDay(period.from)} – ${shortDay(period.to)}`;
    if (taken.has(period.index)) return `This warranty already has its checkup for ${range}. One checkup per period.`;
    if (chosen.has(period.index)) return `${shortDay(chosen.get(period.index))} and ${shortDay(day)} are both in ${range}. One checkup per period.`;
    chosen.set(period.index, day);
  }
  return "";
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
    const taken = checkupsByPeriod(warranty, appointments, now);
    const next = checkupPeriods(warranty)
      .filter((period) => !taken.has(period.index))
      .map((period) => ({ period, days: Math.round((new Date(period.to).getTime() - today) / 86400000) }))
      .find(({ days }) => days >= -14);
    if (next && next.days <= withinDays) due.push({ warranty, dueOn: next.period.to, days: next.days });
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

/**
 * Everything booked under a warranty, for its list: each checkup period with
 * the checkup in it (or none yet), checkups outside every period (booked
 * before 086), and the re-treatments, soonest first. Cancelled visits are
 * left out.
 */
export function warrantySchedule(warranty, appointments = [], now = new Date()) {
  const visits = warrantyVisits(warranty, appointments, now);
  const byDate = (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt);
  const placed = new Set();
  const periods = checkupPeriods(warranty).map((period) => {
    const visit = visits.checkups
      .filter((entry) => !placed.has(entry.id) && checkupPeriodOf(warranty, localDay(entry.scheduledAt))?.index === period.index)
      .sort(byDate)[0] || null;
    if (visit) placed.add(visit.id);
    return { period, visit };
  });
  return {
    periods,
    extras: visits.checkups.filter((entry) => !placed.has(entry.id)).sort(byDate),
    retreatments: [...visits.retreatments].sort(byDate),
  };
}
