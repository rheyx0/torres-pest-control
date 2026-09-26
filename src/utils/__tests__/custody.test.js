// Stock a technician is holding (migration 054).

import { checkoutBalances, checkoutOf, heldBy, heldByItem, openCheckouts } from "../custody";

const checkout = (id, extra = {}) => ({
  id, itemId: "termidor", amount: 2, movementType: "OUT", stockOutReason: "TECHNICIAN_CHECKOUT",
  technicianId: "juan", movementDate: "2026-09-25", ...extra,
});
const used = (id, checkoutId, amount) => ({ id, itemId: "termidor", amount, movementType: "OUT", stockOutReason: "APPOINTMENT", appointmentId: "v12", checkoutId });
const returned = (id, checkoutId, amount) => ({ id, itemId: "termidor", amount, movementType: "RETURN", returnReason: "LEFTOVER", checkoutId });

describe("checkoutBalances", () => {
  it("takes what a visit used and what came back off the checkout", () => {
    const [entry] = checkoutBalances([checkout("c1"), used("u1", "c1", 1.5), returned("r1", "c1", 0.3)]);
    expect(entry).toMatchObject({ used: 1.5, returned: 0.3, remaining: 0.2 });
  });

  it("ignores checkouts settled before migration 054", () => {
    expect(checkoutBalances([checkout("old", { custodyClosedAt: "2026-09-26T00:00:00Z" })])).toEqual([]);
  });

  it("lists the oldest first", () => {
    const entries = checkoutBalances([checkout("late", { movementDate: "2026-09-27" }), checkout("early", { movementDate: "2026-09-20" })]);
    expect(entries.map((entry) => entry.checkout.id)).toEqual(["early", "late"]);
  });
});

describe("what is still out", () => {
  const log = [
    checkout("c1"),
    checkout("c2", { technicianId: "ana", amount: 1 }),
    checkout("c3", { itemId: "bait", amount: 4 }),
    used("u1", "c1", 2),
  ];

  it("drops a checkout once it is fully used or returned", () => {
    expect(openCheckouts(log).map((entry) => entry.checkout.id)).toEqual(["c2", "c3"]);
  });

  it("sums one item for a crew, and only that crew", () => {
    expect(heldBy(log, ["ana"], "termidor")).toBe(1);
    expect(heldBy(log, ["juan"], "termidor")).toBe(0);
    expect(heldBy(log, ["juan", "ana"], "bait")).toBe(4);
    expect(heldBy(log, [], "bait")).toBe(0);
  });

  it("totals each item across technicians", () => {
    expect(Object.fromEntries(heldByItem(log))).toEqual({ termidor: 1, bait: 4 });
  });

  it("finds the checkout a usage row came from", () => {
    expect(checkoutOf(log[3], log)).toBe(log[0]);
    expect(checkoutOf({ id: "x" }, log)).toBeNull();
  });
});
