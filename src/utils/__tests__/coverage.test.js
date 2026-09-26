// Covering for a technician who cannot work (migration 056).

import { COVER_ACTIONS, coverCandidates, coverChanges, coverProblems, crewAfter, suggestCover, visitsToCover } from "../coverage";

const DAY = "2031-01-16";
const at = (time, day = DAY) => `${day}T${time}:00`;
const visit = (id, time, crew, extra = {}) => ({
  id, clientId: `c-${id}`, scheduledAt: at(time), durationMinutes: 60, status: "Confirmed",
  technicianIds: crew, technicianId: crew[0] || "", ...extra,
});

const technicians = [
  { id: "juan", name: "Juan", status: "ACTIVE" },
  { id: "karl", name: "Karl", status: "ACTIVE" },
  { id: "ana", name: "Ana", status: "ACTIVE" },
  { id: "old", name: "Old", status: "INACTIVE" },
];

describe("visitsToCover", () => {
  const appointments = [
    visit("a", "09:00", ["juan"]),
    visit("b", "13:00", ["karl", "juan"]),
    visit("c", "08:00", ["juan"], { status: "In progress" }),
    visit("d", "10:00", ["juan"], { status: "Completed" }),
    visit("e", "10:00", ["juan"], { status: "Cancelled" }),
    visit("f", "09:00", ["juan"], { scheduledAt: at("09:00", "2031-01-17") }),
    visit("g", "11:00", ["karl"]),
  ];

  it("lists their open visits in the dates, in time order, and sets aside the one in progress", () => {
    const { visits, inProgress } = visitsToCover(appointments, "juan", DAY, DAY);
    expect(visits.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(inProgress.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("covers every day in the range", () => {
    expect(visitsToCover(appointments, "juan", DAY, "2031-01-17").visits.map((entry) => entry.id)).toEqual(["a", "b", "f"]);
  });
});

describe("crewAfter", () => {
  it("puts the cover in the absent technician's place, leading if they led", () => {
    expect(crewAfter(visit("x", "09:00", ["juan", "ana"]), "juan", { action: "ASSIGN", technicianId: "karl" })).toEqual(["karl", "ana"]);
    expect(crewAfter(visit("x", "09:00", ["ana", "juan"]), "juan", { action: "ASSIGN", technicianId: "karl" })).toEqual(["ana", "karl"]);
  });

  it("just removes them otherwise", () => {
    expect(crewAfter(visit("x", "09:00", ["juan", "ana"]), "juan", { action: "REMOVE" })).toEqual(["ana"]);
    expect(crewAfter(visit("x", "09:00", ["juan"]), "juan", { action: "RESCHEDULE" })).toEqual([]);
  });
});

describe("coverCandidates and suggestCover", () => {
  it("offers free, active technicians, lightest day first", () => {
    const appointments = [
      visit("sick", "09:00", ["juan"]),
      visit("karl-busy-day", "14:00", ["karl"], { durationMinutes: 180 }),
    ];
    const candidates = coverCandidates(appointments[0], { appointments, technicians, absentId: "juan" });
    expect(candidates.map((account) => account.id)).toEqual(["ana", "karl"]);
  });

  it("never offers someone busy at that time", () => {
    const appointments = [visit("sick", "09:00", ["juan"]), visit("ana-busy", "09:30", ["ana"])];
    expect(coverCandidates(appointments[0], { appointments, technicians, absentId: "juan" }).map((account) => account.id)).toEqual(["karl"]);
  });

  it("does not give one person two visits at the same time", () => {
    // Two overlapping visits to cover: whoever takes the first is busy for the second.
    const appointments = [
      visit("one", "09:00", ["juan"]),
      visit("two", "09:30", ["juan"], { durationMinutes: 30 }),
    ];
    const choices = suggestCover(appointments, { appointments, technicians, absentId: "juan" });
    expect(choices.one.technicianId).not.toBe(choices.two.technicianId);
    expect([choices.one.action, choices.two.action]).toEqual(["ASSIGN", "ASSIGN"]);
  });

  it("falls back on the rest of the crew, then on Reschedule, when nobody is free", () => {
    const appointments = [
      visit("crew", "09:00", ["juan", "ana"]),
      visit("alone", "13:00", ["juan"]),
      visit("karl-all-day", "06:00", ["karl"], { durationMinutes: 780 }),
      visit("ana-afternoon", "12:00", ["ana"], { durationMinutes: 240 }),
    ];
    const choices = suggestCover(appointments.slice(0, 2), { appointments, technicians, absentId: "juan" });
    expect(choices).toEqual({
      crew: { action: COVER_ACTIONS.REMOVE },
      alone: { action: COVER_ACTIONS.RESCHEDULE },
    });
  });
});

describe("coverProblems and coverChanges", () => {
  const appointments = [visit("one", "09:00", ["juan"]), visit("two", "09:00", ["juan", "ana"])];

  it("flags a cover given two visits at once", () => {
    const choices = { one: { action: "ASSIGN", technicianId: "karl" }, two: { action: "ASSIGN", technicianId: "karl" } };
    const problems = coverProblems(appointments, { appointments, technicians, absentId: "juan", choices });
    expect(Object.values(problems)).toContain("Already busy at this time. Choose someone else.");
  });

  it("builds one change per visit with the crew it will have", () => {
    const choices = { one: { action: "ASSIGN", technicianId: "karl" }, two: { action: "REMOVE" } };
    expect(coverChanges(appointments, "juan", choices)).toEqual([
      { appointment_id: "one", action: "ASSIGN", technician_ids: ["karl"] },
      { appointment_id: "two", action: "REMOVE", technician_ids: ["ana"] },
    ]);
  });
});
