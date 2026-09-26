import {
  averageMaterialCost,
  hasPlausiblePrice,
  reorderExposure,
  reportsDue,
  serviceMix,
  serviceMixThisMonth,
  signatureState,
  spendBySupplier,
  spendThisMonth,
  stockOnHandValue,
  weekWindow,
} from "../dashboardMetrics";
import { todayISO } from "../validators";

// Migration 058: rows from before the limits with figures the system could
// not accept today are left out of every total, not shown.
describe("figures the system could not accept", () => {
  const thisMonth = todayISO();
  const inventory = [
    { id: "ok", supplier: "Bayer", cost: 100, quantity: 10, reorderLevel: 20 },
    { id: "bad-cost", supplier: "Baygon", cost: 1e284, quantity: 5, reorderLevel: 10 },
    { id: "bad-qty", supplier: "Acme", cost: 10, quantity: 5e9, reorderLevel: null },
  ];
  const delivery = (itemId, amount, unitCost) => ({ itemId, movementType: "IN", movementDate: thisMonth, amount, unitCost, totalCost: amount * unitCost });
  const movements = [delivery("ok", 10, 100), delivery("bad-cost", 5, 1e284), delivery("ok", 2e6, 1)];

  it("leaves them out of stock received and spend by supplier", () => {
    expect(spendThisMonth(movements)).toBe(1000);
    expect(spendBySupplier(movements, inventory)).toEqual([{ label: "Bayer", value: 1000 }]);
  });

  it("leaves impossible items out of stock on hand and restock cost", () => {
    expect(stockOnHandValue(inventory)).toBe(1000);
    expect(reorderExposure(inventory)).toBe(1000);
  });

  it("prices materials per job with sensible items only", () => {
    const jobs = [{ reportSubmitted: true, reportSubmittedAt: new Date().toISOString(), stockUsed: [{ itemId: "ok", amount: 2 }, { itemId: "bad-cost", amount: 1 }] }];
    expect(averageMaterialCost(jobs, inventory)).toMatchObject({ jobs: 1, total: 200 });
  });

  it("only counts prices from ₱0 to ₱999,999.99", () => {
    expect([1500, 0, "", null, 1e12, -5, "abc"].map((price) => hasPlausiblePrice({ price }))).toEqual([true, true, false, false, false, false, false]);
  });
});

// Friday 25 Sep 2026, 9:12 AM — the handoff's example day.
const now = new Date(2026, 8, 25, 9, 12);
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
const visit = (id, scheduledAt, extra = {}) => ({
  id,
  scheduledAt,
  durationMinutes: 60,
  status: "Confirmed",
  technicianId: "jun",
  technicianIds: ["jun"],
  reportSubmitted: false,
  ...extra,
});

describe("reportsDue", () => {
  const appointments = [
    visit("wed", at(23, 9)),
    visit("fri-early", at(25, 7)), // ended 8:00, before now
    visit("fri-now", at(25, 9)), // still in progress at 9:12
    visit("sun", at(27, 10)), // the handoff's "Sunday visit on a Friday"
    visit("filed", at(24, 9), { reportSubmitted: true }),
    visit("cancelled", at(22, 9), { status: "Cancelled" }),
    visit("someone-else", at(22, 9), { technicianId: "ramon", technicianIds: ["ramon"] }),
    visit("last-week", at(18, 9)),
  ];

  it("lists only this week's visits that have ended without a report", () => {
    expect(reportsDue(appointments, "jun", now).map((entry) => entry.id)).toEqual(["wed", "fri-early"]);
  });

  it("never includes a visit that hasn't finished yet", () => {
    const ids = reportsDue(appointments, "jun", now).map((entry) => entry.id);
    expect(ids).not.toContain("sun");
    expect(ids).not.toContain("fri-now");
  });

  it("counts a crew member, not just the lead", () => {
    const crew = [visit("crew", at(23, 9), { technicianId: "ramon", technicianIds: ["ramon", "jun"] })];
    expect(reportsDue(crew, "jun", now)).toHaveLength(1);
  });
});

describe("signatureState", () => {
  // The contradiction in the handoff: "signed by Store Manager" beside UNSIGNED.
  it("does not treat a typed customer name as a signature", () => {
    expect(signatureState({ reportSubmitted: true, customerName: "Store Manager", signaturePath: "" })).toBe("No signature");
  });

  it("calls a report with a signature image signed", () => {
    expect(signatureState({ reportSubmitted: true, customerName: "", signaturePath: "sig/a.png" })).toBe("Signed");
  });

  it("says the report is due when there is none", () => {
    expect(signatureState({ reportSubmitted: false })).toBe("Report due");
  });
});

describe("serviceMix", () => {
  const window = weekWindow(now);

  it("groups by the service as booked, not the pest concern", () => {
    const rows = serviceMix(
      [
        visit("a", at(22, 9), { serviceType: "General Pest Control", pestConcern: "Rodents" }),
        visit("b", at(23, 9), { serviceType: "General Pest Control", pestConcern: "Cockroaches" }),
        visit("c", at(24, 9), { serviceType: "Termite Baiting", pestConcern: "Termites" }),
        visit("d", at(24, 11), { serviceType: "", pestConcern: "Flies" }),
      ],
      window
    );

    expect(rows).toEqual([
      { label: "General Pest Control", count: 2 },
      { label: "Termite Baiting", count: 1 },
      { label: "Unspecified service", count: 1 },
    ]);
  });

  it("leaves cancelled visits out", () => {
    expect(serviceMix([visit("x", at(22, 9), { status: "Cancelled", serviceType: "X" })], window)).toEqual([]);
  });

  it("keeps the monthly helper on the same rule", () => {
    expect(typeof serviceMixThisMonth([])).toBe("object");
  });
});
