// Migration 078: warranty, checkups and warranty re-treatment.
import { addMonths, checkupDatesToBook, checkupReminders, clientWarranties, coveringWarranty, plannedCheckupCount, warrantyLabel, warrantyOf, warrantyState } from "../warranty";
import { invoiceableVisits } from "../billing";

const now = new Date("2026-10-12T10:00:00");
const contract = { id: "k1", reference: "TPC-K-00002", clientId: "c1", status: "ACTIVE", activatedAt: "2026-07-01T08:00:00", warrantyMonths: 24, checkupFrequency: "QUARTERLY", planId: "p1" };
const quote = { id: "q1", reference: "TPC-Q-00030", clientId: "c1", status: "APPROVED", warrantyMonths: 12, checkupFrequency: "MONTHLY" };
const job = { id: "v1", clientId: "c1", quoteId: "q1", status: "Completed", scheduledAt: "2026-10-01T09:00:00", signedAt: "2026-10-01T11:00:00" };

test("months add up, clamped to the month's end", () => {
  expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  expect(addMonths("2026-10-01", 24)).toBe("2028-10-01");
  expect(warrantyLabel(24)).toBe("2 years");
  expect(warrantyLabel(6)).toBe("6 months");
});

test("a contract's warranty runs from signing, a quotation's from the job's completion", () => {
  expect(warrantyOf("CONTRACT", contract)).toMatchObject({ start: "2026-07-01", end: "2028-07-01" });
  expect(warrantyOf("QUOTE", quote, [])).toMatchObject({ start: "", end: "" });
  expect(warrantyState(warrantyOf("QUOTE", quote, []), now)).toBe("NOT_STARTED");
  const started = warrantyOf("QUOTE", quote, [job]);
  expect(started).toMatchObject({ start: "2026-10-01", end: "2027-10-01" });
  expect(warrantyState(started, now)).toBe("ACTIVE");
  expect(warrantyState(started, new Date("2027-10-02T09:00:00"))).toBe("ENDED");
  expect(warrantyOf("QUOTE", { ...quote, warrantyMonths: null }, [job])).toBeNull();
});

test("checkups: the dates still to book, and how many it gives", () => {
  const warranty = warrantyOf("CONTRACT", contract);
  expect(plannedCheckupCount(warranty)).toBe(8);
  const dates = checkupDatesToBook(warranty, [], now);
  expect(dates[0]).toBe("2027-01-01"); // Oct 1 has passed
  expect(dates).toHaveLength(7); // 8 in two years, the first already past
  const booked = { id: "c1v", warrantyKind: "CHECKUP", warrantyContractId: "k1", status: "Pending", scheduledAt: "2027-01-05T09:00:00" };
  expect(checkupDatesToBook(warranty, [booked], now)[0]).toBe("2027-04-01");
});

test("a follow-up is covered while the warranty runs", () => {
  const visit = { id: "v2", clientId: "c1", planId: "p1", status: "Completed" };
  expect(coveringWarranty(visit, { contracts: [contract], quotes: [] }, "2026-11-01")).toMatchObject({ type: "CONTRACT", id: "k1" });
  expect(coveringWarranty(visit, { contracts: [contract], quotes: [] }, "2028-08-01")).toBeNull();
  expect(coveringWarranty(job, { quotes: [quote], contracts: [], appointments: [job] }, "2026-12-01")).toMatchObject({ type: "QUOTE" });
});

test("checkups due and not booked are reminded; warranty visits are never invoiced", () => {
  const due = checkupReminders({ quotes: [quote], contracts: [], appointments: [job] }, new Date("2026-10-28T09:00:00"));
  expect(due).toEqual([expect.objectContaining({ dueOn: "2026-11-01", days: 4 })]);
  expect(clientWarranties("c1", { quotes: [quote], contracts: [contract], appointments: [job] })).toHaveLength(2);
  const checkup = { id: "x", clientId: "c1", status: "Completed", warrantyKind: "CHECKUP" };
  expect(invoiceableVisits([job, checkup], "c1")).toEqual([job]);
});
