import { billingOverview } from "../billing";
import { collectionsByMonth } from "../reports";

const now = new Date("2026-09-28T10:00:00");

describe("billingOverview", () => {
  it("adds up what is still owed, what is overdue, this month's money and down payments due", () => {
    const invoices = [
      { id: "i1", amountDue: 5000, dueOn: "2026-09-20", status: "ISSUED" }, // overdue
      { id: "i2", amountDue: 3000, dueOn: "2026-10-20", status: "ISSUED" }, // partly paid
      { id: "i3", amountDue: 1000, dueOn: "2026-10-20", status: "ISSUED" }, // paid
      { id: "i4", amountDue: 9000, dueOn: "2026-09-01", status: "VOID" },
    ];
    const quotes = [
      { id: "q1", status: "APPROVED", depositAmount: 2240 },
      { id: "q2", status: "APPROVED", depositAmount: 1000 }, // paid
      { id: "q3", status: "SENT", depositAmount: 500 },
    ];
    const payments = [
      { invoiceId: "i2", kind: "PAYMENT", method: "CASH", amount: 1000, paidOn: "2026-09-10" },
      { invoiceId: "i3", kind: "PAYMENT", method: "CASH", amount: 1000, paidOn: "2026-08-30" },
      { quoteId: "q2", kind: "DEPOSIT", method: "GCASH", amount: 1000, paidOn: "2026-09-02" },
      { invoiceId: "i2", kind: "PAYMENT", method: "CHECK", checkStatus: "PENDING", amount: 500, paidOn: "2026-09-15" },
    ];
    expect(billingOverview({ quotes, invoices, payments }, now)).toEqual({
      toCollect: 7000,
      toCollectCount: 2,
      overdue: 5000,
      overdueCount: 1,
      collectedThisMonth: 2000,
      depositsDue: 2240,
      depositsDueCount: 1,
    });
  });
});

describe("collectionsByMonth", () => {
  it("lists every month in the range, empty ones as zero", () => {
    const payments = [
      { kind: "PAYMENT", method: "CASH", amount: 1500, paidOn: "2026-07-03" },
      { kind: "PAYMENT", method: "CASH", amount: 500, paidOn: "2026-07-20" },
      { kind: "PAYMENT", method: "CASH", amount: 800, paidOn: "2026-09-01", reversedAt: "2026-09-02" },
    ];
    const rows = collectionsByMonth(payments, { from: "2026-07-01", to: "2026-09-28" });
    expect(rows.map((row) => [row.month, row.value])).toEqual([["2026-07", 2000], ["2026-08", 0], ["2026-09", 0]]);
  });
});
