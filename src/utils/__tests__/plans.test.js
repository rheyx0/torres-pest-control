// Recurring plans and multi-day jobs (migration 052). Dates are built with
// local constructors, so these pass in any timezone.

import {
  PLAN_KINDS,
  atTime,
  checkVisits,
  commonFreeTime,
  dayOrderProblem,
  freeTechnician,
  isEarlierJobDay,
  isLastJobDay,
  nextFreeStart,
  planLabel,
  plansEnding,
  printableJob,
  recurringDates,
  splitIntoDays,
} from "../plans";

const day = (text) => new Date(`${text}T09:00:00`);
const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const weekday = (date) => date.toLocaleDateString("en-US", { weekday: "short" });

// A Thursday in the future, so nothing below trips the past-date rule.
const THU = "2031-01-16";

describe("recurringDates", () => {
  it("keeps the same date each month rather than counting 30 days", () => {
    expect(recurringDates(day("2031-01-15"), "Monthly", { count: 4, skipSundays: false }).map(ymd))
      .toEqual(["2031-01-15", "2031-02-15", "2031-03-15", "2031-04-15"]);
  });

  it("clamps to the month's end without dragging later dates earlier", () => {
    expect(recurringDates(day("2031-01-31"), "Monthly", { count: 3, skipSundays: false }).map(ymd))
      .toEqual(["2031-01-31", "2031-02-28", "2031-03-31"]);
  });

  it("steps quarterly, weekly and every two weeks", () => {
    expect(recurringDates(day("2031-01-15"), "Quarterly", { count: 3, skipSundays: false }).map(ymd))
      .toEqual(["2031-01-15", "2031-04-15", "2031-07-15"]);
    expect(recurringDates(day(THU), "Weekly", { count: 3 }).map(ymd)).toEqual(["2031-01-16", "2031-01-23", "2031-01-30"]);
    expect(recurringDates(day(THU), "Every 2 weeks", { count: 2 }).map(ymd)).toEqual(["2031-01-16", "2031-01-30"]);
  });

  it("skips Sundays in a daily plan without counting them", () => {
    const dates = recurringDates(day(THU), "Daily", { count: 5, skipSundays: true });
    expect(dates.map(weekday)).toEqual(["Thu", "Fri", "Sat", "Mon", "Tue"]);
  });

  it("moves any other visit that lands on a Sunday to Monday", () => {
    // Feb 16, 2031 is a Sunday.
    const dates = recurringDates(day("2031-01-16"), "Monthly", { count: 2, skipSundays: true });
    expect(dates.map(ymd)).toEqual(["2031-01-16", "2031-02-17"]);
  });

  it("stops at an until date, and never books more than the cap", () => {
    expect(recurringDates(day(THU), "Weekly", { until: "2031-02-06" }).map(ymd))
      .toEqual(["2031-01-16", "2031-01-23", "2031-01-30", "2031-02-06"]);
    expect(recurringDates(day(THU), "Daily", { count: 500 })).toHaveLength(60);
  });

  it("returns nothing for a frequency that does not repeat", () => {
    expect(recurringDates(day(THU), "One-time", { count: 3 })).toEqual([]);
  });
});

describe("splitIntoDays", () => {
  it("fills the first day to 7 PM and starts later days at 6 AM", () => {
    const days = splitIntoDays(new Date(`${THU}T06:00:00`), 20 * 60);
    expect(days).toEqual([
      { scheduledAt: `${THU}T06:00`, durationMinutes: 13 * 60 },
      { scheduledAt: "2031-01-17T06:00", durationMinutes: 7 * 60 },
    ]);
  });

  it("starts from the chosen time on day one, and skips Sunday", () => {
    // Saturday 1 PM: 6 hours that day, the rest on Monday.
    const days = splitIntoDays(new Date("2031-01-18T13:00:00"), 10 * 60);
    expect(days.map((entry) => entry.scheduledAt)).toEqual(["2031-01-18T13:00", "2031-01-20T06:00"]);
    expect(days.map((entry) => entry.durationMinutes)).toEqual([360, 240]);
  });
});

describe("checkVisits and the fixes", () => {
  const jun = { id: "jun", name: "Jun" };
  const karl = { id: "karl", name: "Karl" };
  const nameOf = (id) => [jun, karl].find((account) => account.id === id)?.name;
  const visits = [
    { key: "v1", scheduledAt: `${THU}T09:00`, durationMinutes: 60 },
    { key: "v2", scheduledAt: "2031-01-23T09:00", durationMinutes: 60 },
  ];
  // Jun is busy 9–10 on both Thursdays.
  const booked = visits.map((visit, index) => ({ id: `b${index}`, scheduledAt: `${visit.scheduledAt}:00`, durationMinutes: 60, technicianIds: ["jun"], status: "Confirmed" }));
  const context = { appointments: booked, technicianIds: ["jun"], nameOf, now: new Date("2031-01-01T00:00:00") };

  it("names who clashes, and when", () => {
    const checked = checkVisits(visits, context);
    expect(checked.every((visit) => visit.problem === "clash")).toBe(true);
    expect(checked[0].message).toMatch(/^Jun already has a visit at/);
  });

  it("passes a free series", () => {
    expect(checkVisits(visits, { ...context, appointments: [] }).every((visit) => !visit.problem)).toBe(true);
  });

  it("flags past, out-of-hours and Sunday dates", () => {
    const [past] = checkVisits([{ key: "p", scheduledAt: "2030-12-01T09:00", durationMinutes: 60 }], context);
    const [late] = checkVisits([{ key: "l", scheduledAt: `${THU}T18:30`, durationMinutes: 60 }], context);
    const [sunday] = checkVisits([{ key: "s", scheduledAt: "2031-01-19T09:00", durationMinutes: 60 }], { ...context, skipSundays: true });
    expect([past.problem, late.problem, sunday.problem]).toEqual(["past", "hours", "sunday"]);
  });

  it("catches two visits of the same list overlapping each other", () => {
    const both = [
      { key: "a", scheduledAt: `${THU}T09:00`, durationMinutes: 120 },
      { key: "b", scheduledAt: `${THU}T10:00`, durationMinutes: 60 },
    ];
    expect(checkVisits(both, { ...context, appointments: [] }).map((visit) => visit.problem)).toEqual(["clash", "clash"]);
  });

  it("keeps a multi-day job's days in order", () => {
    const days = [
      { key: "d1", scheduledAt: `${THU}T06:00`, durationMinutes: 780 },
      { key: "d2", scheduledAt: `${THU}T12:00`, durationMinutes: 60 },
    ];
    expect(checkVisits(days, { ...context, appointments: [], kind: PLAN_KINDS.MULTI_DAY })[1].problem).toBe("order");
  });

  it("finds one time of day that frees every date", () => {
    expect(commonFreeTime(visits, context)).toBe("06:00");
    expect(checkVisits(visits.map((visit) => atTime(visit, "06:00")), context).every((visit) => !visit.problem)).toBe(true);
  });

  it("offers a technician free at every date", () => {
    expect(freeTechnician(visits, context, [jun, karl])).toBe(karl);
  });

  it("suggests the next free start on the same day for one date", () => {
    expect(nextFreeStart(visits[0], visits, context)).toBe(`${THU}T10:00`);
  });
});

describe("a visit in a plan", () => {
  const job = [
    { id: "d1", planId: "p", planKind: "MULTI_DAY", status: "Confirmed", scheduledAt: `${THU}T06:00:00`, attachments: [{ id: "f1" }], stockUsed: [{ itemId: "i1" }] },
    { id: "d2", planId: "p", planKind: "MULTI_DAY", status: "Confirmed", scheduledAt: "2031-01-17T06:00:00", attachments: [{ id: "f2" }], stockUsed: [] },
    { id: "d3", planId: "p", planKind: "MULTI_DAY", status: "Cancelled", scheduledAt: "2031-01-18T06:00:00" },
  ];

  it("labels days by the live days, ignoring a cancelled one", () => {
    expect(planLabel(job[0], job)).toBe("Day 1/2");
    expect(planLabel({ ...job[0], planKind: "RECURRING" }, job.map((entry) => ({ ...entry, planKind: "RECURRING" })))).toBe("1/2");
    expect(planLabel({ id: "x" }, job)).toBe("");
  });

  it("puts the report on the last live day", () => {
    expect(isLastJobDay(job[1], job)).toBe(true);
    expect(isEarlierJobDay(job[0], job)).toBe(true);
    expect(isLastJobDay({ id: "solo" }, job)).toBe(true);
  });

  it("refuses to move a day past its neighbours", () => {
    const days = [
      { id: "a", planId: "q", planKind: "MULTI_DAY", status: "Confirmed", scheduledAt: `${THU}T06:00:00`, durationMinutes: 780 },
      { id: "b", planId: "q", planKind: "MULTI_DAY", status: "Confirmed", scheduledAt: "2031-01-17T06:00:00", durationMinutes: 420 },
    ];
    expect(dayOrderProblem({ ...days[1], scheduledAt: `${THU}T10:00:00` }, days)).toMatch(/can't start before day 1 ends/);
    expect(dayOrderProblem({ ...days[0], scheduledAt: "2031-01-17T05:00:00" }, days)).toMatch(/can't run past the start of day 2/);
    expect(dayOrderProblem({ ...days[1], scheduledAt: "2031-01-18T06:00:00" }, days)).toBeNull();
    expect(dayOrderProblem({ id: "solo", scheduledAt: `${THU}T06:00:00` }, days)).toBeNull();
  });

  it("prints a job with every day's photos and materials", () => {
    const printed = printableJob(job[1], job);
    expect(printed.attachments.map((file) => file.id)).toEqual(["f1", "f2"]);
    expect(printed.stockUsed).toHaveLength(1);
    expect(printed.jobDays).toHaveLength(2);
  });
});

describe("plansEnding", () => {
  const client = { id: "c1", name: "Cruz Bakery", status: "ACTIVE" };
  const visit = (id, date, extra = {}) => ({
    id, clientId: "c1", planId: "p1", planKind: "RECURRING", planFrequency: "Monthly",
    status: "Confirmed", scheduledAt: `${date}T09:00:00`, serviceIds: ["s1"], ...extra,
  });
  const now = new Date("2031-03-01T00:00:00");

  it("reminds when two visits or fewer are left, with the next start date", () => {
    const plan = [visit("a", "2031-02-15", { status: "Completed" }), visit("b", "2031-03-15"), visit("c", "2031-04-15")];
    const [entry] = plansEnding(plan, [client], now);
    expect(entry.remaining).toBe(2);
    expect(ymd(entry.dueAt)).toBe("2031-05-15");
    expect(entry.serviceIds).toEqual(["s1"]);
  });

  it("stays quiet while plenty is left, once renewed, or when the office cancelled the plan", () => {
    const long = ["2031-03-15", "2031-04-15", "2031-05-15"].map((date, index) => visit(`v${index}`, date));
    expect(plansEnding(long, [client], now)).toEqual([]);

    const ending = [visit("b", "2031-03-15")];
    const renewedBy = { id: "r", clientId: "c1", planId: "p2", status: "Confirmed", scheduledAt: "2031-04-15T09:00:00" };
    expect(plansEnding([...ending, renewedBy], [client], now)).toEqual([]);

    const cancelled = [...ending, visit("c", "2031-04-15", { status: "Cancelled", cancellationReason: "Plan cancelled" })];
    expect(plansEnding(cancelled, [client], now)).toEqual([]);
  });

  it("stays quiet once the office chose not to renew", () => {
    const declined = [visit("b", "2031-03-15", { planRenewalDeclinedAt: "2031-02-20T08:00:00Z" })];
    expect(plansEnding(declined, [client], now)).toEqual([]);
  });
});
