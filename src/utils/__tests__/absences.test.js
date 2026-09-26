// Technicians who are out (migration 057).

import { absenceDates, absenceDuring, currentAndUpcoming, describeOut, outDuring, outOn } from "../absences";

const absence = (id, technicianId, startsOn, endsOn, reason = "") => ({ id, technicianId, startsOn, endsOn, reason });
const juan = absence("a", "juan", "2031-01-16", "2031-01-17", "Sick");
const ana = absence("b", "ana", "2031-01-20", "2031-01-20");
const absences = [juan, ana];
const visit = (day, time = "09:00", durationMinutes = 60) => ({ scheduledAt: `${day}T${time}:00`, durationMinutes });

describe("absenceDuring", () => {
  it("finds the absence covering a visit's day, first and last day included", () => {
    expect(absenceDuring(absences, "juan", visit("2031-01-16"))).toBe(juan);
    expect(absenceDuring(absences, "juan", visit("2031-01-17", "17:00"))).toBe(juan);
    expect(absenceDuring(absences, "juan", visit("2031-01-18"))).toBeNull();
    expect(absenceDuring(absences, "karl", visit("2031-01-16"))).toBeNull();
  });

  it("catches a visit that runs into the first day out, but not one ending at midnight", () => {
    expect(absenceDuring(absences, "juan", visit("2031-01-15", "22:00", 180))).toBe(juan);
    expect(absenceDuring(absences, "juan", visit("2031-01-15", "22:00", 120))).toBeNull();
  });
});

describe("outDuring", () => {
  it("collects everyone out on any of the dates, as for a plan being booked", () => {
    const out = outDuring(absences, [visit("2031-01-16"), visit("2031-01-20")]);
    expect([...out.keys()].sort()).toEqual(["ana", "juan"]);
    expect(outDuring(absences, [visit("2031-01-18")]).size).toBe(0);
  });
});

describe("lists and labels", () => {
  it("finds who is out on a day, and what is still to come", () => {
    expect(outOn(absences, "2031-01-17")).toEqual([juan]);
    expect(currentAndUpcoming(absences, "2031-01-18")).toEqual([ana]);
  });

  it("describes an absence for pickers and lists", () => {
    expect(describeOut(juan)).toBe("out (Sick) until Jan 17");
    expect(describeOut(ana)).toBe("out until Jan 20");
    expect(absenceDates(juan)).toBe("Jan 16 – Jan 17");
    expect(absenceDates(ana)).toBe("Jan 20");
  });
});
