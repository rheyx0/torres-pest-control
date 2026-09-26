// Stock a technician is holding (migration 054).
//
// A checkout takes stock off the shelf into a technician's hands. What is
// still out on it is its amount less every movement that points back at it
// through `checkoutId`: materials a visit drew from it, and returns. The
// server works the same sum (checkout_remaining()) and is the authority; this
// is the same arithmetic over the loaded movement log, for display and for
// the forms' "is there enough" checks.
//
// Checkouts from before 054 carry `custodyClosedAt` and count as settled.

const EPSILON = 1e-9;
const round = (value) => Math.round(value * 1e6) / 1e6;

export const isCheckout = (movement) => movement?.stockOutReason === "TECHNICIAN_CHECKOUT";

/**
 * Every live checkout with what has happened to it:
 * [{ checkout, used, returned, remaining, settledBy: [movements] }], oldest first.
 */
export function checkoutBalances(movements = []) {
  const settled = new Map();
  movements.forEach((movement) => {
    if (!movement.checkoutId) return;
    const list = settled.get(movement.checkoutId) || [];
    list.push(movement);
    settled.set(movement.checkoutId, list);
  });

  return movements
    .filter((movement) => isCheckout(movement) && !movement.custodyClosedAt)
    .map((checkout) => {
      const settledBy = settled.get(checkout.id) || [];
      const used = settledBy.filter((entry) => entry.movementType !== "RETURN").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const returned = settledBy.filter((entry) => entry.movementType === "RETURN").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      return { checkout, used: round(used), returned: round(returned), remaining: round(Math.max(0, Number(checkout.amount || 0) - used - returned)), settledBy };
    })
    .sort((a, b) => String(a.checkout.movementDate).localeCompare(String(b.checkout.movementDate))
      || String(a.checkout.createdAt || "").localeCompare(String(b.checkout.createdAt || "")));
}

/** Checkouts with something still out. */
export const openCheckouts = (movements) => checkoutBalances(movements).filter((entry) => entry.remaining > EPSILON);

/** How much of one item any of `technicianIds` is holding. */
export function heldBy(movements, technicianIds, itemId) {
  const crew = new Set(technicianIds || []);
  return round(openCheckouts(movements)
    .filter(({ checkout }) => checkout.itemId === itemId && crew.has(checkout.technicianId))
    .reduce((sum, entry) => sum + entry.remaining, 0));
}

/** Map<itemId, amount> of everything out with technicians, for the item list. */
export function heldByItem(movements) {
  const totals = new Map();
  openCheckouts(movements).forEach(({ checkout, remaining }) => {
    totals.set(checkout.itemId, round((totals.get(checkout.itemId) || 0) + remaining));
  });
  return totals;
}

/** The checkout a visit's usage row or a return row settled, if any. */
export const checkoutOf = (movement, movements = []) =>
  (movement?.checkoutId ? movements.find((entry) => entry.id === movement.checkoutId) || null : null);
