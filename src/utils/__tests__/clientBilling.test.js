import { clientBalance, clientBillingEvents } from "../billing";
import { activityTrend, timelineEvents } from "../clientTimeline";

describe("activityTrend", () => {
  const visit = (id, day, level, fields) => ({ id, clientId: "c1", status: "Completed", scheduledAt: `2026-0${day}-01T09:00:00`, durationMinutes: 60, activityLevel: level, ...fields });

  test("oldest first, with the direction from the last two", () => {
    const trend = activityTrend([visit("a3", 3, "LOW"), visit("a1", 1, "HIGH"), visit("a2", 2, "MEDIUM")]);
    expect(trend.points.map((point) => point.label)).toEqual(["High", "Medium", "Low"]);
    expect(trend.direction).toBe("better");
  });

  test("worse, steady, and nothing to compare", () => {
    expect(activityTrend([visit("a1", 1, "LOW"), visit("a2", 2, "HIGH")]).direction).toBe("worse");
    expect(activityTrend([visit("a1", 1, "LOW"), visit("a2", 2, "LOW")]).direction).toBe("steady");
    expect(activityTrend([visit("a1", 1, "LOW")]).direction).toBe("none");
  });

  test("skips cancelled visits and visits with nothing recorded", () => {
    const trend = activityTrend([visit("a1", 1, "HIGH", { status: "Cancelled" }), visit("a2", 2, ""), visit("a3", 3, "NONE")]);
    expect(trend.points.map((point) => point.id)).toEqual(["a3"]);
  });

  test("open issues come from the latest visit that recorded any", () => {
    const trend = activityTrend([visit("a1", 1, "HIGH", { openIssues: "Leaking pipe" }), visit("a2", 2, "LOW", { openIssues: "Gap under the door" }), visit("a3", 3, "LOW")]);
    expect(trend.openIssues).toBe("Gap under the door");
    expect(trend.issuesFrom.id).toBe("a2");
  });
});

const quote = { id: "q1", reference: "TPC-Q-00001", status: "APPROVED", validUntil: "2099-01-01", total: 2800, depositAmount: 1400, createdAt: "2026-09-01T00:00:00Z" };
const invoice = { id: "i1", reference: "TPC-INV-00001", quoteId: "q1", status: "ISSUED", amountDue: 1400, depositApplied: 1400, dueOn: "2026-09-15", issuedOn: "2026-09-01", createdAt: "2026-09-02T00:00:00Z" };
const deposit = { id: "p1", reference: "TPC-R-00001", kind: "DEPOSIT", quoteId: "q1", method: "CASH", amount: 1400, paidOn: "2026-09-01", createdAt: "2026-09-01T01:00:00Z" };
const payment = { id: "p2", reference: "TPC-R-00002", kind: "PAYMENT", invoiceId: "i1", method: "GCASH", amount: 400, paidOn: "2026-09-05", createdAt: "2026-09-05T01:00:00Z" };
const contract = { id: "k1", reference: "TPC-K-00001", title: "Quarterly termite", status: "ACTIVE", frequency: "Quarterly", pricePerVisit: 2500, createdAt: "2026-09-03T00:00:00Z" };
const now = new Date(2026, 8, 26);

test("clientBalance: outstanding, overdue, paid and down payments not yet deducted", () => {
  expect(clientBalance({ quotes: [quote], invoices: [invoice], payments: [deposit, payment] }, now))
    .toEqual({ outstanding: 1000, overdue: 1000, paid: 1800, depositsHeld: 0 });
  // Before the invoice, the down payment is held.
  expect(clientBalance({ quotes: [quote], invoices: [], payments: [deposit] }, now).depositsHeld).toBe(1400);
});

test("clientBillingEvents: one event per record, each opening it on the Billing page", () => {
  const events = clientBillingEvents({ quotes: [quote], invoices: [invoice], payments: [deposit, payment], contracts: [contract] }, now);
  expect(events.map((event) => event.title)).toEqual([
    "Quote TPC-Q-00001", "Invoice TPC-INV-00001", "Down payment TPC-R-00001", "Payment TPC-R-00002", "Contract TPC-K-00001 · Quarterly termite",
  ]);
  expect(events.map((event) => event.to)).toEqual(["/billing?quote=q1", "/billing?invoice=i1", "/billing?quote=q1", "/billing?invoice=i1", "/billing?contract=k1"]);
  expect(events[1].pill).toEqual({ status: "Overdue", tone: "danger" });
  expect(events[3].detail).toBe("₱400.00 · GCash · on TPC-INV-00001");
});

test("timelineEvents puts billing on the same line, newest first", () => {
  const events = timelineEvents({ createdAt: "2026-08-01T00:00:00Z" }, [], now, clientBillingEvents({ quotes: [quote], contracts: [contract] }, now));
  expect(events.map((event) => event.key)).toEqual(["contract-k1", "quote-q1", "created"]);
});
