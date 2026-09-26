import {
  attentionItems,
  bookingReminders,
  dispatchLanes,
  localDate,
  nowPlacement,
  overdueReports,
  recentVisits,
  reserviceDue,
  trackPlacement,
  unassignedUpcoming,
  weekBars,
  weekRevenue,
} from "../dispatch";

// Friday 25 Sep 2026, 9:12 AM — the handoff's example morning.
const now = new Date(2026, 8, 25, 9, 12);
const at = (day, hour, minute = 0, month = 8) => new Date(2026, month, day, hour, minute).toISOString();
const visit = (id, scheduledAt, extra = {}) => ({
  id,
  clientId: "c1",
  scheduledAt,
  durationMinutes: 60,
  status: "Confirmed",
  technicianId: "jun",
  technicianIds: ["jun"],
  reportSubmitted: false,
  signaturePath: "",
  price: "",
  ...extra,
});
const jun = { id: "jun", name: "Jun Dela Cruz" };
const ramon = { id: "ramon", name: "Ramon Reyes" };

describe("localDate", () => {
  // new Date("2026-10-05") is UTC midnight: Oct 4 in the Americas.
  it("reads a date-only string as a local calendar day", () => {
    const date = localDate("2026-10-05");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 5]);
  });

  it("returns null for nothing", () => {
    expect(localDate("")).toBeNull();
    expect(localDate("not a date")).toBeNull();
  });
});

describe("trackPlacement", () => {
  const day = new Date(2026, 8, 25);

  it("places a visit on the 7 AM – 6 PM track", () => {
    const placement = trackPlacement(visit("a", at(25, 8), { durationMinutes: 110 }), day);
    expect(placement.left).toBeCloseTo((60 / 660) * 100);
    expect(placement.width).toBeCloseTo((110 / 660) * 100);
  });

  it("clips a visit that starts before 7 instead of dropping it", () => {
    const placement = trackPlacement(visit("a", at(25, 6, 30)), day);
    expect(placement.left).toBe(0);
    expect(placement.clippedStart).toBe(true);
  });

  it("drops a visit wholly outside the track", () => {
    expect(trackPlacement(visit("a", at(25, 19)), day)).toBeNull();
  });
});

describe("nowPlacement", () => {
  it("draws the now line only on today, inside the window", () => {
    expect(nowPlacement(new Date(2026, 8, 25), now)).toBeCloseTo(((9 * 60 + 12 - 420) / 660) * 100);
    expect(nowPlacement(new Date(2026, 8, 26), now)).toBeNull();
    expect(nowPlacement(new Date(2026, 8, 25), new Date(2026, 8, 25, 20))).toBeNull();
  });
});

describe("dispatchLanes", () => {
  const appointments = [
    visit("solo", at(25, 8)),
    visit("crew", at(25, 10), { technicianId: "ramon", technicianIds: ["ramon", "jun"] }),
    visit("open", at(25, 9), { technicianId: "", technicianIds: [], status: "Pending" }),
    visit("cancelled", at(25, 14), { status: "Cancelled" }),
    visit("tomorrow", at(26, 8)),
  ];

  it("gives each technician a lane and puts crew visits in every member's", () => {
    const lanes = dispatchLanes(appointments, [jun, ramon], new Date(2026, 8, 25));
    const ids = (key) => lanes.find((lane) => lane.key === key).jobs.map((job) => job.appointment.id);

    expect(ids("jun")).toEqual(["solo", "crew"]);
    expect(ids("ramon")).toEqual(["crew"]);
    expect(ids("unassigned")).toEqual(["open"]);
  });

  it("leaves cancelled visits and other days off the board", () => {
    const all = dispatchLanes(appointments, [jun, ramon], new Date(2026, 8, 25)).flatMap((lane) => lane.jobs.map((job) => job.appointment.id));
    expect(all).not.toContain("cancelled");
    expect(all).not.toContain("tomorrow");
  });
});

describe("figures", () => {
  it("counts unassigned visits still to come, not past or finished ones", () => {
    const appointments = [
      visit("later", at(25, 15), { technicianIds: [], technicianId: "" }),
      visit("yesterday", at(24, 9), { technicianIds: [], technicianId: "" }),
      visit("done", at(25, 8), { technicianIds: [], technicianId: "", status: "Completed" }),
      visit("assigned", at(25, 15)),
    ];
    expect(unassignedUpcoming(appointments, now).map((entry) => entry.id)).toEqual(["later"]);
  });

  it("calls a report overdue only a day after the visit ended", () => {
    const appointments = [
      visit("old", at(23, 9)),
      visit("this-morning", at(25, 7)),
      visit("filed", at(22, 9), { reportSubmitted: true }),
      visit("ancient", at(1, 9, 0, 6)),
    ];
    expect(overdueReports(appointments, now).map((entry) => entry.id)).toEqual(["old"]);
  });

  it("totals this week's agreed prices and says how many had one", () => {
    const revenue = weekRevenue(
      [
        visit("a", at(22, 9), { price: 6000 }),
        visit("b", at(23, 9), { price: "4000" }),
        visit("c", at(24, 9), { price: "" }),
        visit("x", at(24, 11), { price: 9000, status: "Cancelled" }),
        visit("next-week", at(29, 9), { price: 9000 }),
      ],
      now
    );
    expect(revenue).toEqual({ total: 10000, visits: 3, priced: 2, average: 5000 });
  });

  it("marks today and the days still ahead in the week chart", () => {
    const bars = weekBars([visit("a", at(25, 9)), visit("b", at(25, 11)), visit("c", at(27, 9))], now);
    expect(bars).toHaveLength(7);
    expect(bars[4]).toMatchObject({ value: 2, isToday: true, isFuture: false });
    expect(bars[6]).toMatchObject({ value: 1, isFuture: true });
    expect(bars[0].isFuture).toBe(false);
  });

  it("lists finished visits newest first, filed or not", () => {
    const appointments = [
      visit("early", at(25, 7)),
      visit("yesterday", at(24, 15), { reportSubmitted: true }),
      visit("running", at(25, 9)),
      visit("later", at(25, 14)),
    ];
    expect(recentVisits(appointments, now).map((entry) => entry.id)).toEqual(["early", "yesterday"]);
  });
});

describe("reserviceDue", () => {
  const clients = [
    { id: "c1", name: "Jollibee Katipunan", status: "ACTIVE" },
    { id: "c2", name: "Tan Family Home", status: "ACTIVE" },
    { id: "c3", name: "Santos Residence", status: "ACTIVE" },
    { id: "c4", name: "Archived Co", status: "ARCHIVED" },
  ];

  it("finds recurring clients who are due with nothing booked", () => {
    const appointments = [
      // Quarterly, last done in June: due late September.
      visit("j", at(20, 9, 0, 5), { clientId: "c1", status: "Completed", serviceFrequency: "Quarterly" }),
      // Same, but the next visit is already booked.
      visit("t", at(20, 9, 0, 5), { clientId: "c2", status: "Completed", serviceFrequency: "Quarterly" }),
      visit("t-next", at(30, 9), { clientId: "c2" }),
      // One-time job: never due again.
      visit("s", at(1, 9, 0, 3), { clientId: "c3", status: "Completed", serviceFrequency: "One-time" }),
      visit("a", at(1, 9, 0, 3), { clientId: "c4", status: "Completed", serviceFrequency: "Monthly" }),
    ];
    expect(reserviceDue(appointments, clients, now).map((entry) => entry.client.id)).toEqual(["c1"]);
  });

  it("counts a visit earlier today as the next one booked", () => {
    const appointments = [
      visit("j", at(20, 9, 0, 5), { clientId: "c1", status: "Completed", serviceFrequency: "Quarterly" }),
      visit("today", at(25, 8), { clientId: "c1" }),
    ];
    expect(reserviceDue(appointments, clients, now)).toEqual([]);
  });

  it("is not due yet when the next visit is weeks away", () => {
    const appointments = [visit("j", at(15, 9), { clientId: "c1", status: "Completed", serviceFrequency: "Monthly" })];
    expect(reserviceDue(appointments, clients, now)).toEqual([]);
  });

  // A plan books every visit up front and reminds through its own renewal.
  it("leaves visits that belong to a plan to the plan", () => {
    const appointments = [visit("j", at(20, 9, 0, 5), { clientId: "c1", status: "Completed", serviceFrequency: "Quarterly", planId: "p1", planKind: "RECURRING" })];
    expect(reserviceDue(appointments, clients, now)).toEqual([]);
  });

  it("carries every service the last visit had", () => {
    const appointments = [visit("j", at(20, 9, 0, 5), { clientId: "c1", status: "Completed", serviceFrequency: "Quarterly", serviceIds: ["s1", "s2"] })];
    expect(reserviceDue(appointments, clients, now)[0].serviceIds).toEqual(["s1", "s2"]);
  });
});

describe("bookingReminders", () => {
  const clients = [{ id: "c1", name: "Cruz Bakery", status: "ACTIVE" }];

  it("reminds to renew a plan with two visits or fewer left", () => {
    const plan = [at(10, 9), at(10, 9, 0, 9)].map((scheduledAt, index) =>
      visit(`p${index}`, scheduledAt, { planId: "p1", planKind: "RECURRING", planFrequency: "Monthly", status: index === 0 ? "Completed" : "Confirmed" }));
    const [entry] = bookingReminders(plan, clients, now);
    expect(entry).toMatchObject({ renewal: true, remaining: 1, frequency: "Monthly" });
  });
});

describe("overdueReports and multi-day jobs", () => {
  it("does not chase a report for a job day that was closed", () => {
    const appointments = [
      visit("closed-day", at(23, 9), { planId: "j1", planKind: "MULTI_DAY", dayDoneAt: at(23, 18) }),
      visit("open", at(23, 9)),
    ];
    expect(overdueReports(appointments, now).map((entry) => entry.id)).toEqual(["open"]);
  });
});

describe("attentionItems", () => {
  const clients = [{ id: "c1", name: "Cruz Bakery", status: "ACTIVE" }];
  const inventory = [
    { id: "i1", name: "Demand CS", type: "CHEMICAL", quantity: 0.8, unit: "L", expirationDate: "2026-10-05", status: "ACTIVE", reorderLevel: 2 },
    { id: "i2", name: "Termidor SC", type: "CHEMICAL", quantity: 4, unit: "L", expirationDate: "2027-08-01", status: "ACTIVE", reorderLevel: 1 },
    { id: "i3", name: "B&G Sprayer", type: "EQUIPMENT", quantity: 6, unit: "unit", nextMaintenanceDate: "2026-09-20", serialNumber: "SN-1004", status: "ACTIVE", reorderLevel: null },
    { id: "i4", name: "Old spray", type: "CHEMICAL", quantity: 0, unit: "L", expirationDate: "2026-09-01", status: "ACTIVE", reorderLevel: null },
  ];
  const appointments = [
    visit("open", at(25, 12), { technicianIds: [], technicianId: "", status: "Pending" }),
    visit("overdue", at(23, 9)),
    visit("unsigned", at(24, 9), { reportSubmitted: true }),
  ];

  const items = attentionItems({ appointments, clients, inventory, users: [jun] }, { now });
  const byKind = (kind) => items.filter((item) => item.kind === kind);

  it("lists each kind of work in the handoff's order, each with one action", () => {
    expect(items.map((item) => item.kind)).toEqual(["unassigned", "report", "expiry", "maintenance", "reorder", "signature"]);
    items.forEach((item) => {
      expect(item.action.label).toBeTruthy();
      expect(item.action.to).toMatch(/^\//);
    });
  });

  it("says how long a chemical has left, from its local expiry date", () => {
    expect(byKind("expiry")[0].title).toBe("Demand CS expires in 10 days");
  });

  it("ignores an expired chemical with none left on hand", () => {
    expect(byKind("expiry").map((item) => item.key)).toEqual(["expiry-i1"]);
  });

  it("flags overdue equipment maintenance with its serial number", () => {
    expect(byKind("maintenance")[0]).toMatchObject({ title: "B&G Sprayer maintenance overdue" });
    expect(byKind("maintenance")[0].detail).toMatch(/SN-1004/);
  });

  it("names the oldest overdue report and who led it", () => {
    expect(byKind("report")[0].detail).toMatch(/Cruz Bakery.*Jun Dela Cruz/);
    expect(byKind("report")[0].action.to).toBe("/scheduling?appointment=overdue&tab=Report");
  });

  it("drops stock items for someone who cannot see stock", () => {
    const kinds = attentionItems({ appointments, clients, inventory, users: [] }, { now, canSeeStock: false }).map((item) => item.kind);
    expect(kinds).not.toContain("expiry");
    expect(kinds).not.toContain("reorder");
  });

  it("offers View instead of Book to someone who cannot book", () => {
    const due = [visit("j", at(20, 9, 0, 5), { clientId: "c1", status: "Completed", serviceFrequency: "Quarterly", reportSubmitted: true, signaturePath: "s.png" })];
    const reservice = attentionItems({ appointments: due, clients }, { now, canBook: false }).find((item) => item.kind === "reservice");
    expect(reservice.action.label).toBe("View");
    expect(reservice.title).toBe("Cruz Bakery is due for re-service");
  });

  it("books straight from the last visit", () => {
    const due = [visit("j", at(20, 9, 0, 5), { clientId: "c1", status: "Completed", serviceFrequency: "Quarterly", reportSubmitted: true, signaturePath: "s.png" })];
    const reservice = attentionItems({ appointments: due, clients }, { now }).find((item) => item.kind === "reservice");
    expect(reservice.action).toEqual({ label: "Book", to: "/scheduling?book=j" });
  });

  it("offers Renew for a plan running out", () => {
    const plan = [visit("last", at(10, 9, 0, 9), { planId: "p1", planKind: "RECURRING", planFrequency: "Monthly" })];
    const reservice = attentionItems({ appointments: plan, clients }, { now }).find((item) => item.kind === "reservice");
    expect(reservice.title).toBe("Cruz Bakery's monthly plan ends in 1 visit");
    expect(reservice.action).toEqual({ label: "Renew", to: "/scheduling?book=last" });
  });

  it("returns nothing when all is well", () => {
    expect(attentionItems({}, { now })).toEqual([]);
  });

  // Migration 057.
  it("says who is out today, and not who is out another day", () => {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const users = [{ id: "juan", name: "Juan" }, { id: "ana", name: "Ana" }];
    const absences = [
      { id: "a", technicianId: "juan", startsOn: today, endsOn: today, reason: "Sick" },
      { id: "b", technicianId: "ana", startsOn: "2099-01-01", endsOn: "2099-01-02", reason: "" },
    ];
    const out = attentionItems({ users, absences }, { now }).find((item) => item.kind === "absence");
    expect(out.title).toBe("Juan is out today");
    expect(out.detail).toMatch(/^Juan \(\(Sick\) until /);
  });
});
