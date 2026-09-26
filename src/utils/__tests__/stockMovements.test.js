import {
  countByReason,
  describeLosses,
  filterByReason,
  reasonOf,
  recentLossesByItem,
  summarizeLosses,
} from "../stockMovements";

const out = (id, fields) => ({ id, movementType: "OUT", itemId: "i1", quantityDelta: -1, totalCost: 100, movementDate: "2026-09-20", ...fields });

const movements = [
  out("m1", { stockOutReason: "APPOINTMENT", appointmentId: "a1" }),
  out("m2", { stockOutReason: "TECHNICIAN_CHECKOUT", technicianId: "t1" }),
  out("m3", { stockOutReason: "TECHNICIAN_CHECKOUT", technicianId: "t2" }),
  out("m4", { stockOutReason: "MISSING", quantityDelta: -2, totalCost: 250 }),
  out("m5", { stockOutReason: "DAMAGED", itemId: "i2", movementDate: "2026-06-01" }),
  // Written before migration 040: no reason column, only the appointment link.
  out("m6", { stockOutReason: "", appointmentId: "a2" }),
];

describe("reasonOf", () => {
  it("reads the recorded reason", () => {
    expect(reasonOf(movements[3])).toBe("MISSING");
  });

  it("treats a pre-040 appointment row as an appointment", () => {
    expect(reasonOf(movements[5])).toBe("APPOINTMENT");
  });
});

describe("filterByReason", () => {
  it("returns everything for ALL", () => {
    expect(filterByReason(movements)).toHaveLength(6);
  });

  it("isolates missing and damaged stock", () => {
    expect(filterByReason(movements, { reason: "MISSING" }).map((m) => m.id)).toEqual(["m4"]);
    expect(filterByReason(movements, { reason: "DAMAGED" }).map((m) => m.id)).toEqual(["m5"]);
  });

  it("narrows checkouts to one technician", () => {
    expect(filterByReason(movements, { reason: "TECHNICIAN_CHECKOUT", technicianId: "t2" }).map((m) => m.id)).toEqual(["m3"]);
  });

  it("ignores the technician unless the reason is a checkout", () => {
    expect(filterByReason(movements, { reason: "ALL", technicianId: "t2" })).toHaveLength(6);
  });
});

describe("countByReason", () => {
  it("counts every chip", () => {
    expect(countByReason(movements)).toEqual({ ALL: 6, APPOINTMENT: 2, TECHNICIAN_CHECKOUT: 2, MISSING: 1, DAMAGED: 1, EXPIRED: 0 });
  });
});

describe("summarizeLosses", () => {
  it("totals rows, units and estimated value per loss reason", () => {
    expect(summarizeLosses(movements)).toEqual({
      MISSING: { count: 1, quantity: 2, value: 250 },
      DAMAGED: { count: 1, quantity: 1, value: 100 },
    });
  });
});

describe("recentLossesByItem", () => {
  const now = new Date(2026, 8, 24);

  it("counts losses per item inside the window", () => {
    const byItem = recentLossesByItem(movements, { now, days: 30 });
    expect(byItem.get("i1")).toEqual({ MISSING: 1, DAMAGED: 0 });
    // m5 is from June — outside the last 30 days.
    expect(byItem.has("i2")).toBe(false);
  });

  it("widens with the window", () => {
    expect(recentLossesByItem(movements, { now, days: 180 }).get("i2")).toEqual({ MISSING: 0, DAMAGED: 1 });
  });
});

describe("describeLosses", () => {
  it("reads naturally", () => {
    expect(describeLosses({ MISSING: 2, DAMAGED: 1 })).toBe("2 missing · 1 damaged");
    expect(describeLosses({ MISSING: 0, DAMAGED: 3 })).toBe("3 damaged");
    expect(describeLosses(undefined)).toBe("");
  });
});
