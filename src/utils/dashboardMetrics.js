// Dashboard figures, in one place.
//
// Every number here is a filter over lists the app already holds in context —
// no new queries. That is fine at this size; it stops being fine once the
// appointment table runs to thousands of rows and "this week" means fetching
// everything to count six of them.
//
// On the money side: every figure below is COST. Migration 041 added
// appointments.price, so an agreed price per visit now exists, but it is
// optional and entered by hand — there is still no invoice, no payment and no
// record of what was actually collected, so revenue and margin cannot be
// derived from it and nothing here tries to.

import { crewOf, endOf, isAssignedTo, reportOwed } from "./scheduling";

const startOfDay = (date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const dayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const isToday = (value) => dayKey(value) === dayKey(new Date());

export const isTomorrow = (value) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dayKey(value) === dayKey(tomorrow);
};

/** Monday-to-Sunday window containing `from`. */
export function weekWindow(from = new Date()) {
  const start = startOfDay(from);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function monthWindow(from = new Date()) {
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { start, end };
}

const within = (value, { start, end }) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= start && date < end;
};

const live = (appointment) => appointment.status !== "Cancelled";

export const byTime = (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt);

// ---------------------------------------------------------------------------
// Appointment counts
// ---------------------------------------------------------------------------

/**
 * "Is this person on this job?" — an appointment can carry a crew rather than
 * one technician (migration 041), so every per-technician figure below asks
 * the crew, not the lead.
 */
const onJob = (entry, technicianId) => isAssignedTo(entry, technicianId);
const unassigned = (entry) => crewOf(entry).length === 0;

export function appointmentsToday(appointments) {
  return appointments.filter((entry) => live(entry) && isToday(entry.scheduledAt)).sort(byTime);
}

export function appointmentsThisWeek(appointments) {
  const window = weekWindow();
  return appointments.filter((entry) => live(entry) && within(entry.scheduledAt, window));
}

/** Pending with nobody assigned — the queue an office actually works through. */
export function needsScheduling(appointments) {
  return appointments
    .filter((entry) => entry.status === "Pending" && unassigned(entry))
    .sort(byTime);
}

export function awaitingReschedule(appointments) {
  return appointments.filter((entry) => entry.status === "Reschedule").sort(byTime);
}

/** Today's visits for one technician still open (no report, day not closed). */
export function remainingToday(appointments, technicianId) {
  return appointmentsToday(appointments)
    .filter((entry) => onJob(entry, technicianId) && reportOwed(entry));
}

export function completedToday(appointments, technicianId) {
  return appointments.filter((entry) =>
    onJob(entry, technicianId)
    && entry.reportSubmitted
    && isToday(entry.reportSubmittedAt || entry.scheduledAt));
}

export function tomorrowsJobs(appointments, technicianId, limit = 3) {
  return appointments
    .filter((entry) => live(entry) && onJob(entry, technicianId) && isTomorrow(entry.scheduledAt))
    .sort(byTime)
    .slice(0, limit);
}

/** Today's load per technician, busiest first, with unassigned work last. */
export function workloadToday(appointments, technicians) {
  const today = appointmentsToday(appointments);
  const rows = technicians.map((account) => ({
    id: account.id,
    name: account.name || account.username || "Technician",
    count: today.filter((entry) => onJob(entry, account.id)).length,
  }));
  const unassignedCount = today.filter(unassigned).length;
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (unassignedCount > 0) rows.push({ id: "unassigned", name: "Unassigned", count: unassignedCount });
  return rows;
}

/**
 * What a visit is filed under in a service breakdown: the service as booked
 * (appointments.service_type, the catalog name snapshot from migration 047),
 * never the pest concern — "Rodents" is a problem, not something we sell.
 */
export const serviceLabel = (entry) => entry.serviceType || "Unspecified service";

/** Visits in a window, grouped by service and ranked. */
export function serviceMix(appointments, window) {
  const counts = new Map();
  appointments
    .filter((entry) => live(entry) && within(entry.scheduledAt, window))
    .forEach((entry) => {
      const label = serviceLabel(entry);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Service mix for the current month, ranked. */
export function serviceMixThisMonth(appointments) {
  return serviceMix(appointments, monthWindow());
}

/**
 * A technician's reports that are actually due: visits this week that have
 * ENDED and have no report. A visit later today or on Sunday is not "still
 * to file" on a Friday — it hasn't happened yet.
 */
export function reportsDue(appointments, technicianId, now = new Date()) {
  const window = weekWindow(now);
  return appointments
    .filter(
      (entry) =>
        live(entry) &&
        isAssignedTo(entry, technicianId) &&
        reportOwed(entry) &&
        within(entry.scheduledAt, window) &&
        endOf(entry) <= now.getTime()
    )
    .sort(byTime);
}

/**
 * The customer-signature state of a visit's report. Signed means a signature
 * image exists (signature_path) — a typed customer name on its own is not a
 * signature, which is how "signed by Store Manager" once sat next to an
 * UNSIGNED badge.
 */
export function signatureState(entry) {
  if (!entry.reportSubmitted) return "Report due";
  return entry.signaturePath ? "Signed" : "No signature";
}

export function recentlyCompleted(appointments, limit = 5) {
  return appointments
    .filter((entry) => entry.reportSubmitted)
    .sort((a, b) => new Date(b.reportSubmittedAt || b.scheduledAt) - new Date(a.reportSubmittedAt || a.scheduledAt))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** Items at or below their reorder level. A null level means "not tracked". */
export function lowStockItems(inventory) {
  return inventory
    .filter((item) => item.reorderLevel !== null && item.reorderLevel !== undefined
      && Number(item.quantity) <= Number(item.reorderLevel))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));
}

/** Capital sitting in the store right now. */
export function stockOnHandValue(inventory) {
  return inventory.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.cost) || 0), 0);
}

/**
 * What it would cost to bring every low item back up to its reorder level.
 * The one cost figure that answers a question somebody has to act on.
 */
export function reorderExposure(inventory) {
  return lowStockItems(inventory).reduce((total, item) => {
    const shortfall = Math.max(0, Number(item.reorderLevel) - Number(item.quantity));
    return total + shortfall * (Number(item.cost) || 0);
  }, 0);
}

/** Recorded spend on stock received inside a window. */
export function spendInWindow(movements, window) {
  return movements
    .filter((movement) => movement.movementType === "IN" && within(movement.movementDate, window))
    .reduce((total, movement) => total + (Number(movement.totalCost) || 0), 0);
}

export const spendThisMonth = (movements) => spendInWindow(movements, monthWindow());

/** Suppliers ranked by what was received from them this month. */
export function spendBySupplier(movements, inventory, limit = 4) {
  const window = monthWindow();
  const supplierOf = new Map(inventory.map((item) => [item.id, item.supplier || "Unrecorded"]));
  const totals = new Map();
  movements
    .filter((movement) => movement.movementType === "IN" && within(movement.movementDate, window))
    .forEach((movement) => {
      const supplier = supplierOf.get(movement.itemId) || "Unrecorded";
      totals.set(supplier, (totals.get(supplier) || 0) + (Number(movement.totalCost) || 0));
    });
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/**
 * Average material cost of a completed job this month.
 *
 * Priced from each item's CURRENT cost, because a stock-out row records the
 * quantity used but not what that quantity cost at the time. Close enough to
 * steer decisions, not close enough to put in a ledger — label it as an
 * estimate wherever it is shown.
 */
export function averageMaterialCost(appointments, inventory) {
  const window = monthWindow();
  const costOf = new Map(inventory.map((item) => [item.id, Number(item.cost) || 0]));
  const jobs = appointments.filter((entry) =>
    entry.reportSubmitted && within(entry.reportSubmittedAt || entry.scheduledAt, window));
  if (jobs.length === 0) return { average: 0, jobs: 0, total: 0 };

  const total = jobs.reduce((sum, job) => sum
    + (job.stockUsed || []).reduce((jobSum, used) =>
      jobSum + (Number(used.amount) || 0) * (costOf.get(used.itemId) || 0), 0), 0);

  return { average: total / jobs.length, jobs: jobs.length, total };
}

/**
 * Short form for figures too wide to sit in a stat tile. Kicks in at a million,
 * which real pest-control numbers rarely reach — so day to day this returns the
 * exact figure and only very large values get abbreviated. Always pair it with
 * the full `peso()` value in a title attribute.
 */
export function pesoCompact(value) {
  const amount = Number(value) || 0;
  const size = Math.abs(amount);
  if (size >= 1e12) return `₱${(amount / 1e12).toFixed(2)}T`;
  if (size >= 1e9) return `₱${(amount / 1e9).toFixed(2)}B`;
  if (size >= 1e6) return `₱${(amount / 1e6).toFixed(2)}M`;
  return peso(amount);
}

/** Peso formatting, used wherever a cost is shown. */
export function peso(value, { decimals = 0 } = {}) {
  return `₱${(Number(value) || 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
