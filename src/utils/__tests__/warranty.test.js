// Migration 078: warranty, checkups and warranty re-treatment.
import { addMonths, checkupDatesToBook, checkupPeriodOf, checkupPeriods, checkupProblem, warrantySchedule, checkupReminders, clientWarranties, coveringWarranty, plannedCheckupCount, runningWarrantyFor, warrantyKindLabel, warrantyLabel, warrantyOf, warrantyServiceIds, warrantyState, withWarranty } from "../warranty";
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
  // Oct 2 – Jan 1 is taken by a checkup on Dec 20, so the next is due Apr 1.
  const booked = { id: "c1v", warrantyKind: "CHECKUP", warrantyContractId: "k1", status: "Pending", scheduledAt: "2026-12-20T09:00:00" };
  expect(checkupDatesToBook(warranty, [booked], now)[0]).toBe("2027-04-01");
  // A cancelled checkup frees its period.
  expect(checkupDatesToBook(warranty, [{ ...booked, status: "Cancelled" }], now)[0]).toBe("2027-01-01");
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

test("a warranty visit says so wherever it is listed", () => {
  const checkup = { warrantyKind: "CHECKUP" };
  expect(warrantyKindLabel(checkup)).toBe("Warranty checkup");
  expect(warrantyKindLabel({ warrantyKind: "RETREATMENT" })).toBe("Warranty re-treatment");
  expect(warrantyKindLabel({})).toBe("");
  expect(withWarranty("Termite Treatment", { warrantyKind: "RETREATMENT" })).toBe("Termite Treatment · 🛡 Warranty re-treatment · free");
  expect(withWarranty("", checkup)).toBe("🛡 Warranty checkup · free");
  expect(withWarranty("Termite Treatment", {})).toBe("Termite Treatment");
});

test("booking the warranty's service again finds the running warranty", () => {
  const quoted = { ...quote, lines: [{ serviceId: "s-termite" }, { serviceId: "" }] };
  const records = { quotes: [quoted], contracts: [{ ...contract, serviceIds: ["s-roach"] }], appointments: [job] };
  expect(warrantyServiceIds(warrantyOf("QUOTE", quoted, [job]))).toEqual(["s-termite"]);
  expect(runningWarrantyFor("c1", ["s-termite"], records, "2026-11-01")).toMatchObject({ type: "QUOTE", id: "q1" });
  expect(runningWarrantyFor("c1", ["s-roach"], records, "2026-11-01")).toMatchObject({ type: "CONTRACT", id: "k1" });
  expect(runningWarrantyFor("c1", ["s-other"], records, "2026-11-01")).toBeNull();
  expect(runningWarrantyFor("c1", ["s-termite"], records, "2028-01-01")).toBeNull(); // ended
  expect(runningWarrantyFor("c2", ["s-termite"], records, "2026-11-01")).toBeNull();
});

test("a job finished early starts its warranty that day, not on the day it was booked for", () => {
  const early = { id: "v9", clientId: "c1", quoteId: "q1", status: "Completed", scheduledAt: "2026-10-19T07:00:00", reportSubmittedAt: "2026-10-15T17:20:00" };
  expect(warrantyOf("QUOTE", quote, [early])).toMatchObject({ start: "2026-10-15", end: "2027-10-15" });
  expect(warrantyOf("QUOTE", quote, [{ ...early, signedAt: "2026-10-16T09:00:00" }])).toMatchObject({ start: "2026-10-16" });
  expect(warrantyOf("QUOTE", quote, [{ ...early, reportSubmittedAt: "" }])).toMatchObject({ start: "2026-10-19" });
});

test("checkups follow the frequency: one per period, as many as fit (086)", () => {
  const yearly = { type: "QUOTE", id: "q9", months: 12, frequency: "QUARTERLY", start: "2026-10-15", end: "2027-10-15" };
  expect(checkupPeriods(yearly)).toEqual([
    { index: 0, from: "2026-10-16", to: "2027-01-15" },
    { index: 1, from: "2027-01-16", to: "2027-04-15" },
    { index: 2, from: "2027-04-16", to: "2027-07-15" },
    { index: 3, from: "2027-07-16", to: "2027-10-15" },
  ]);
  expect(checkupPeriods({ ...yearly, frequency: "MONTHLY" })).toHaveLength(12);
  expect(checkupPeriods({ ...yearly, months: 7 })).toHaveLength(2);
  expect(checkupPeriodOf(yearly, "2026-10-15")).toBeNull(); // the day the warranty starts
  expect(checkupPeriodOf(yearly, "2027-01-15").index).toBe(0);

  const monthly = { ...yearly, frequency: "MONTHLY" };
  expect(checkupProblem(monthly, [], ["2026-10-20", "2026-11-10"])).toMatch(/both in Oct 16, 2026 – Nov 15, 2026/);
  expect(checkupProblem(monthly, [], ["2026-11-10", "2026-11-20"])).toBe("");
  const taken = { id: "t", warrantyKind: "CHECKUP", warrantyQuoteId: "q9", status: "Pending", scheduledAt: "2026-11-01T09:00:00" };
  expect(checkupProblem(monthly, [taken], ["2026-11-14"])).toMatch(/already has its checkup/);
  expect(checkupProblem(monthly, [{ ...taken, status: "Cancelled" }], ["2026-11-14"])).toBe("");
  expect(checkupProblem(yearly, [], ["2027-12-01"])).toMatch(/not inside/);
});

test("one list of everything booked under a warranty", () => {
  const yearly = { type: "QUOTE", id: "q9", months: 12, frequency: "QUARTERLY", start: "2026-10-15", end: "2027-10-15" };
  const visit = (id, kind, at, status = "Pending") => ({ id, warrantyKind: kind, warrantyQuoteId: "q9", status, scheduledAt: at });
  const list = warrantySchedule(yearly, [
    visit("a", "CHECKUP", "2027-01-15T09:00:00"),
    visit("b", "CHECKUP", "2027-02-11T09:00:00"),
    visit("c", "CHECKUP", "2027-01-10T09:00:00"), // a second one in Q1, from before 086
    visit("d", "CHECKUP", "2027-05-01T09:00:00", "Cancelled"),
    visit("e", "RETREATMENT", "2027-03-02T09:00:00"),
  ], new Date("2026-10-20T09:00:00"));
  expect(list.periods.map((entry) => entry.visit?.id || null)).toEqual(["c", "b", null, null]);
  expect(list.extras.map((entry) => entry.id)).toEqual(["a"]);
  expect(list.retreatments.map((entry) => entry.id)).toEqual(["e"]);
});

test("the Warranty page: every warranty, running first, with its service, checkups and follow-ups", () => {
  const { allWarranties, warrantyOverview } = require("../warranty");
  const ended = { id: "q0", reference: "TPC-Q-00001", clientId: "c2", status: "APPROVED", warrantyMonths: 3, checkupFrequency: "" };
  const oldJob = { id: "v0", clientId: "c2", quoteId: "q0", status: "Completed", scheduledAt: "2025-01-10T09:00:00" };
  const draft = { id: "q9", reference: "TPC-Q-00099", clientId: "c3", status: "DRAFT", warrantyMonths: 6 };
  const checkup = { id: "w1", clientId: "c1", warrantyKind: "CHECKUP", warrantyQuoteId: "q1", status: "Pending", scheduledAt: "2026-10-20T09:00:00" };
  const retreat = { id: "w2", clientId: "c1", warrantyKind: "RETREATMENT", warrantyQuoteId: "q1", status: "Completed", scheduledAt: "2026-10-08T09:00:00" };
  const followUp = { id: "f1", clientId: "c1", followUpOf: "v1", quoteId: "q1", status: "Confirmed", scheduledAt: "2026-10-15T09:00:00" };
  const gone = { id: "x1", clientId: "c1", quoteId: "q1", status: "Cancelled", scheduledAt: "2026-10-02T09:00:00" };
  const appointments = [job, oldJob, checkup, retreat, followUp, gone];

  const list = allWarranties({ quotes: [ended, quote, draft], contracts: [], appointments }, now);
  expect(list.map((entry) => entry.reference)).toEqual(["TPC-Q-00030", "TPC-Q-00099", "TPC-Q-00001"]);

  const overview = warrantyOverview(list[0], appointments, now);
  expect(overview.service.map((visit) => visit.id)).toEqual(["v1"]); // the follow-up, checkups and cancelled visit are not the job
  expect(overview.followUps.map((visit) => visit.id)).toEqual(["f1"]);
  expect(overview.retreatments.map((visit) => visit.id)).toEqual(["w2"]);
  expect(overview.periods[0].visit?.id).toBe("w1"); // Oct 2 – Nov 1
  expect(overview.checkupsPlanned).toBe(12);
  expect(overview.checkupsDone).toBe(0);
  expect(overview.next?.id).toBe("w1");

  // A contract's job is its plan's visits.
  const planVisit = { id: "pv1", clientId: "c1", planId: "p1", status: "Completed", scheduledAt: "2026-07-05T09:00:00" };
  const contractOverview = warrantyOverview(warrantyOf("CONTRACT", contract), [planVisit, job], now);
  expect(contractOverview.service.map((visit) => visit.id)).toEqual(["pv1"]);
});
