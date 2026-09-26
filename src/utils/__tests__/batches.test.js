// Chemical batches (migration 055): the order a stock-out takes them in, which
// mirrors take_from_batches() / stock_out_batch() on the server.

import { batchLabel, batchName, byExpiry, describePlan, expiredBatches, isExpired, liveBatches, planDraw, usableBatches } from "../batches";

const batch = (id, quantity, expirationDate, extra = {}) => ({
  id, reference: `TPC-B-${id}`, itemId: "termidor", lotNumber: `LOT-${id}`,
  quantity, expirationDate, receivedDate: "2026-01-01", ...extra,
});

// March expires before December; "old" is already expired on the test day.
const march = batch("mar", 3, "2027-03-05");
const december = batch("dec", 5, "2027-12-01");
const expired = batch("old", 2, "2026-08-01");
const batches = [december, expired, march, batch("empty", 0, "2026-12-01"), batch("other", 9, "2026-10-01", { itemId: "bait" })];
const ON = "2026-09-26";

describe("which batches exist", () => {
  it("sorts soonest expiry first, with no expiry last", () => {
    const sorted = [batch("none", 1, ""), december, march].sort(byExpiry);
    expect(sorted.map((entry) => entry.id)).toEqual(["mar", "dec", "none"]);
  });

  it("separates usable stock from expired stock, ignoring empty batches and other items", () => {
    expect(liveBatches(batches, "termidor").map((entry) => entry.id)).toEqual(["old", "mar", "dec"]);
    expect(usableBatches(batches, "termidor", ON).map((entry) => entry.id)).toEqual(["mar", "dec"]);
    expect(expiredBatches(batches, "termidor", ON).map((entry) => entry.id)).toEqual(["old"]);
  });

  it("counts a batch as usable on its expiry day, expired the day after", () => {
    expect(isExpired(march, "2027-03-05")).toBe(false);
    expect(isExpired(march, "2027-03-06")).toBe(true);
    expect(isExpired(batch("forever", 1, ""), "2099-01-01")).toBe(false);
  });

  it("is not on the shelf before it was received", () => {
    const late = batch("late", 4, "2027-01-01", { receivedDate: "2026-10-01" });
    expect(usableBatches([late], "termidor", ON)).toEqual([]);
  });

  it("names a batch by its lot, or its reference when none is printed", () => {
    expect(batchName(march)).toBe("LOT-mar");
    expect(batchName({ ...march, lotNumber: "" })).toBe("TPC-B-mar");
    expect(batchLabel(march)).toMatch(/^LOT-mar · exp Mar 5, 2027$/);
  });
});

describe("planDraw", () => {
  const plan = (options) => planDraw({ itemId: "termidor", onDate: ON, batches, ...options });

  it("takes the soonest-expiring usable batch first and splits across batches", () => {
    const { portions, short } = plan({ amount: 4 });
    expect(portions).toEqual([
      { batchId: "mar", amount: 3, fromCrew: false },
      { batchId: "dec", amount: 1, fromCrew: false },
    ]);
    expect(short).toBe(0);
  });

  it("never uses an expired batch, and says what cannot be covered", () => {
    const { portions, short } = plan({ amount: 10 });
    expect(portions.map((portion) => portion.batchId)).toEqual(["mar", "dec"]);
    expect(short).toBe(2);
  });

  it("uses a chosen batch first, then the rest by expiry", () => {
    const { portions } = plan({ amount: 6, chosenBatchId: "dec" });
    expect(portions).toEqual([
      { batchId: "dec", amount: 5, fromCrew: false },
      { batchId: "mar", amount: 1, fromCrew: false },
    ]);
  });

  it("refuses a chosen batch that has expired", () => {
    expect(plan({ amount: 1, chosenBatchId: "old" }).error).toMatch(/^Batch LOT-old expired on Aug 1, 2026/);
  });

  it("uses what the crew checked out before the shelf, a checkout for this visit first", () => {
    const held = [
      { checkout: { itemId: "termidor", batchId: "dec", movementDate: "2026-09-20" }, remaining: 1 },
      { checkout: { itemId: "termidor", batchId: "dec", movementDate: "2026-09-25", forAppointmentId: "v1" }, remaining: 0.5 },
    ];
    const { portions } = plan({ amount: 2, held, visitId: "v1" });
    expect(portions).toEqual([
      { batchId: "dec", amount: 0.5, fromCrew: true },
      { batchId: "dec", amount: 1, fromCrew: true },
      { batchId: "mar", amount: 0.5, fromCrew: false },
    ]);
  });

  it("skips checked-out stock of an expired batch", () => {
    const held = [{ checkout: { itemId: "termidor", batchId: "old", movementDate: "2026-07-01" }, remaining: 2 }];
    expect(plan({ amount: 1, held }).portions).toEqual([{ batchId: "mar", amount: 1, fromCrew: false }]);
  });

  it("with a chosen batch, takes the crew's stock of it, then the shelf's, before anything else", () => {
    const held = [
      { checkout: { itemId: "termidor", batchId: "mar", movementDate: "2026-09-20" }, remaining: 1 },
      { checkout: { itemId: "termidor", batchId: "dec", movementDate: "2026-09-20" }, remaining: 1 },
    ];
    const { portions } = plan({ amount: 5, held, chosenBatchId: "mar" });
    expect(portions).toEqual([
      { batchId: "mar", amount: 1, fromCrew: true },
      { batchId: "mar", amount: 3, fromCrew: false },
      { batchId: "dec", amount: 1, fromCrew: true },
    ]);
  });

  it("describes the plan in words", () => {
    const { portions } = plan({ amount: 4, held: [{ checkout: { itemId: "termidor", batchId: "dec", movementDate: "2026-09-20" }, remaining: 1 }] });
    expect(describePlan(portions, "L", batches)).toBe("1 L from LOT-dec (checked out), 3 L from LOT-mar");
  });
});
