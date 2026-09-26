import { billingSegments } from "../BillingPanel";

test("the bar's segments: collected, owed but not due, overdue", () => {
  const segments = billingSegments({
    collected: { count: 3, amount: 9000 },
    outstanding: { count: 2, amount: 5000 },
    overdue: { count: 1, amount: 2000 },
  });
  expect(segments.map((segment) => [segment.key, segment.amount, segment.note])).toEqual([
    ["collected", 9000, "3 payments"],
    ["due", 3000, "1 invoice"],
    ["overdue", 2000, "1 invoice"],
  ]);
});
