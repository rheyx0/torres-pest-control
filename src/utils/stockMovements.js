// Reading the stock-out log by reason.
//
// Migration 040 made every stock-out carry a reason, but the history table
// only printed it. Missing and damaged stock are the two reasons someone has
// to follow up on, so they need to be findable (a filter), visible at a glance
// (a coloured badge, a count on the item) and totalled (what they cost).
// The logic lives here, not in InventoryPage, so it can be tested on its own.

import { STOCK_OUT_REASON_LABELS } from "./constants";
import { isPlausibleMovement } from "./dashboardMetrics";

/** The reasons a person follows up on. */
export const LOSS_REASONS = ["MISSING", "DAMAGED"];

/** Reason of an OUT movement; rows from before migration 040 fall back on the appointment link. */
export function reasonOf(movement) {
  if (movement.stockOutReason) return movement.stockOutReason;
  return movement.appointmentId ? "APPOINTMENT" : "";
}

/** Filter chips for the Stock Out section, in display order. */
export const REASON_FILTERS = [
  { value: "ALL", label: "All reasons" },
  { value: "APPOINTMENT", label: STOCK_OUT_REASON_LABELS.APPOINTMENT },
  { value: "TECHNICIAN_CHECKOUT", label: STOCK_OUT_REASON_LABELS.TECHNICIAN_CHECKOUT },
  { value: "MISSING", label: STOCK_OUT_REASON_LABELS.MISSING },
  { value: "DAMAGED", label: STOCK_OUT_REASON_LABELS.DAMAGED },
  { value: "EXPIRED", label: STOCK_OUT_REASON_LABELS.EXPIRED },
];

/**
 * Narrow OUT movements by reason and, for checkouts, by technician.
 * `technicianId` is ignored unless the reason is TECHNICIAN_CHECKOUT.
 */
export function filterByReason(movements, { reason = "ALL", technicianId = "ALL" } = {}) {
  return movements.filter((movement) => {
    if (reason !== "ALL" && reasonOf(movement) !== reason) return false;
    if (reason === "TECHNICIAN_CHECKOUT" && technicianId !== "ALL" && movement.technicianId !== technicianId) return false;
    return true;
  });
}

/** { ALL, APPOINTMENT, TECHNICIAN_CHECKOUT, MISSING, DAMAGED, EXPIRED } counts for the chips. */
export function countByReason(movements) {
  const counts = { ALL: movements.length };
  REASON_FILTERS.forEach(({ value }) => {
    if (value !== "ALL") counts[value] = 0;
  });
  movements.forEach((movement) => {
    const reason = reasonOf(movement);
    if (reason in counts) counts[reason] += 1;
  });
  return counts;
}

/**
 * Missing and damaged totals for a set of movements: how many rows, how many
 * units, and the estimated value (quantity × the movement's cost, which for a
 * stock-out is the item's cost at the time — an estimate, not spend).
 */
export function summarizeLosses(movements) {
  const summary = {};
  LOSS_REASONS.forEach((reason) => {
    summary[reason] = { count: 0, quantity: 0, value: 0 };
  });
  movements.forEach((movement) => {
    const reason = reasonOf(movement);
    if (!summary[reason]) return;
    const quantity = Math.abs(Number(movement.quantityDelta ?? movement.amount) || 0);
    summary[reason].count += 1;
    summary[reason].quantity += quantity;
    // A row from before the limits with an impossible figure adds no value (058).
    if (isPlausibleMovement(movement)) summary[reason].value += Number(movement.totalCost) || 0;
  });
  return summary;
}

/**
 * Per-item missing/damaged counts within the last `days` days, for the badge
 * on the inventory list. Returns Map<itemId, { MISSING, DAMAGED }>.
 */
export function recentLossesByItem(movements, { days = 30, now = new Date() } = {}) {
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - days);
  const byItem = new Map();
  movements.forEach((movement) => {
    const reason = reasonOf(movement);
    if (!LOSS_REASONS.includes(reason)) return;
    const when = new Date(`${String(movement.movementDate).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(when.getTime()) || when < since) return;
    const entry = byItem.get(movement.itemId) || { MISSING: 0, DAMAGED: 0 };
    entry[reason] += 1;
    byItem.set(movement.itemId, entry);
  });
  return byItem;
}

/** "2 missing · 1 damaged" — empty string when there is nothing to say. */
export function describeLosses(entry) {
  if (!entry) return "";
  return [entry.MISSING ? `${entry.MISSING} missing` : "", entry.DAMAGED ? `${entry.DAMAGED} damaged` : ""]
    .filter(Boolean)
    .join(" · ");
}
