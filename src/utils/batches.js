// Chemical batches (migration 055): which batch a stock-out will use.
//
// The server decides — take_from_batches() and stock_out_batch() — and this is
// the same order worked over the loaded batches and checkouts, so a form can
// show "1.5 L from L24-0917, 0.5 L from L25-0142" before anything is saved:
//
//   1. a chosen batch (the container in the technician's hand): first from
//      what the crew checked out, then from the shelf;
//   2. the rest of what the crew checked out — a checkout made for this visit
//      first, then soonest expiry;
//   3. the shelf, soonest expiry first.
//
// Expired batches are never used, and a batch received after the day of use
// is not on the shelf yet. Dates are "YYYY-MM-DD" strings, compared as text.

const round = (value) => Math.round(value * 1e6) / 1e6;

/** Expired by `onDate`: past its expiry, not on it. */
export const isExpired = (batch, onDate) => Boolean(batch?.expirationDate) && batch.expirationDate < onDate;

/** Soonest expiry first; no expiry last; then oldest delivery. */
export function byExpiry(a, b) {
  const expiryA = a.expirationDate || "9999-12-31";
  const expiryB = b.expirationDate || "9999-12-31";
  return expiryA.localeCompare(expiryB)
    || String(a.receivedDate || "").localeCompare(String(b.receivedDate || ""))
    || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

/** An item's batches with stock on the shelf, soonest expiry first. */
export const liveBatches = (batches, itemId) =>
  (batches || []).filter((batch) => batch.itemId === itemId && batch.quantity > 0).sort(byExpiry);

/** The live batches that can be used on `onDate`: not expired, already received. */
export const usableBatches = (batches, itemId, onDate) =>
  liveBatches(batches, itemId).filter((batch) => !isExpired(batch, onDate) && (!batch.receivedDate || batch.receivedDate <= onDate));

/** The live batches past their expiry — to be written off. */
export const expiredBatches = (batches, itemId, onDate) =>
  liveBatches(batches, itemId).filter((batch) => isExpired(batch, onDate));

const shortDate = (value) => (value
  ? new Date(`${value}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
  : "");

/** "L24-0917" — or the system reference when no lot is printed. */
export const batchName = (batch) => (batch ? batch.lotNumber || batch.reference || "Unknown batch" : "Unknown batch");

/** "L24-0917 · exp Mar 5, 2027" */
export function batchLabel(batch) {
  if (!batch) return "Unknown batch";
  const expiry = batch.expirationDate ? `exp ${shortDate(batch.expirationDate)}` : "no expiry";
  return `${batchName(batch)} · ${expiry}`;
}

/**
 * How `amount` of `itemId` would be taken on `onDate`.
 *
 * `held` is the crew's open checkouts of this item — entries from
 * openCheckouts() in custody.js: { checkout, remaining }.
 *
 * Returns { portions: [{ batchId, amount, fromCrew }], short, error }:
 * `short` is what neither the crew nor the shelf can cover; `error` is set
 * when the chosen batch cannot be used.
 */
export function planDraw({ itemId, amount, onDate, batches = [], held = [], chosenBatchId = "", visitId = "" }) {
  const byId = new Map((batches || []).map((batch) => [batch.id, batch]));
  const chosen = chosenBatchId ? byId.get(chosenBatchId) : null;
  if (chosenBatchId && !chosen) return { portions: [], short: amount, error: "That batch is not one of this item's batches." };
  if (chosen && isExpired(chosen, onDate)) {
    return { portions: [], short: amount, error: `Batch ${batchName(chosen)} expired on ${shortDate(chosen.expirationDate)}. Choose another batch.` };
  }

  let still = Number(amount) || 0;
  const portions = [];
  const shelfLeft = new Map((batches || []).map((batch) => [batch.id, batch.quantity]));
  const take = (batchId, available, fromCrew) => {
    if (still <= 0 || available <= 0) return 0;
    const drawn = round(Math.min(available, still));
    still = round(still - drawn);
    portions.push({ batchId: batchId || "", amount: drawn, fromCrew });
    return drawn;
  };

  const crew = (held || [])
    .filter(({ checkout }) => checkout.itemId === itemId && String(checkout.movementDate || "").slice(0, 10) <= onDate)
    .filter(({ checkout }) => !checkout.batchId || !isExpired(byId.get(checkout.batchId), onDate))
    .sort((a, b) => (Number(b.checkout.forAppointmentId === visitId && Boolean(visitId)) - Number(a.checkout.forAppointmentId === visitId && Boolean(visitId)))
      || byExpiry(byId.get(a.checkout.batchId) || {}, byId.get(b.checkout.batchId) || {})
      || String(a.checkout.movementDate).localeCompare(String(b.checkout.movementDate)));

  const takeShelf = (batch) => {
    const drawn = take(batch.id, shelfLeft.get(batch.id) || 0, false);
    shelfLeft.set(batch.id, round((shelfLeft.get(batch.id) || 0) - drawn));
  };

  if (chosen) {
    crew.filter(({ checkout }) => checkout.batchId === chosen.id).forEach(({ remaining }) => take(chosen.id, remaining, true));
    if (!chosen.receivedDate || chosen.receivedDate <= onDate) takeShelf(chosen);
  }
  crew.filter(({ checkout }) => !chosen || checkout.batchId !== chosen.id)
    .forEach(({ checkout, remaining }) => take(checkout.batchId, remaining, true));
  usableBatches(batches, itemId, onDate).forEach(takeShelf);

  return { portions, short: round(Math.max(0, still)), error: "" };
}

/** "1.5 L from L24-0917 (checked out), 0.5 L from L25-0142" */
export function describePlan(portions, unit, batches = []) {
  const byId = new Map((batches || []).map((batch) => [batch.id, batch]));
  return portions
    .map((portion) => {
      const name = portion.batchId ? batchName(byId.get(portion.batchId)) : "stock of unknown batch";
      return `${portion.amount} ${unit || ""} from ${name}${portion.fromCrew ? " (checked out)" : ""}`.replace("  ", " ");
    })
    .join(", ");
}
