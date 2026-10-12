import { announceFollowUp, followUpNotice } from "../followUpBooking";

test("booked is good news, not booked is information, and some answers say nothing", () => {
  expect(followUpNotice({ status: "BOOKED", message: "Follow-up TPC-V-00041 booked for Oct 20, 09:00 AM (Pending)." }))
    .toEqual({ tone: "success", message: "Follow-up TPC-V-00041 booked for Oct 20, 09:00 AM (Pending)." });
  expect(followUpNotice({ status: "NO_QUOTE", message: "The visit was not booked under a quotation, so the office books its follow-up." }))
    .toEqual({ tone: "info", message: "Follow-up not booked: The visit was not booked under a quotation, so the office books its follow-up." });
  expect(followUpNotice({ status: "NO_DATE" })).toBeNull();
  expect(followUpNotice({ status: "ALREADY" })).toBeNull();
  expect(followUpNotice(null)).toBeNull();
});

test("announceFollowUp picks the toast", () => {
  const success = jest.fn();
  const info = jest.fn();
  announceFollowUp({ status: "BOOKED", message: "Booked." }, success, info);
  announceFollowUp({ status: "REFUSED", message: "Karl is out." }, success, info);
  expect(success).toHaveBeenCalledWith("Booked.");
  expect(info).toHaveBeenCalledWith("Follow-up not booked: Karl is out.");
});

describe("a follow-up comes after its visit", () => {
  const { earliestFollowUpDate, followUpDateProblem, followUpStartProblem } = require("../followUpBooking");
  const visit = { reference: "TPC-V-00019", scheduledAt: "2026-10-12T09:00:00", durationMinutes: 90 };

  test("the report's follow-up date is the visit's day or later", () => {
    expect(earliestFollowUpDate(visit)).toBe("2026-10-12");
    expect(followUpDateProblem("2026-10-12", visit)).toBeNull();
    expect(followUpDateProblem("2026-10-20", visit)).toBeNull();
    expect(followUpDateProblem("2026-10-11", visit)).toMatch(/can't be before the visit/);
    expect(followUpDateProblem("", visit)).toBeNull();
  });

  test("a booked follow-up starts once the visit has ended", () => {
    expect(followUpStartProblem("2026-10-12T10:30", visit)).toBeNull();
    expect(followUpStartProblem("2026-10-12T10:00", visit)).toMatch(/must be after TPC-V-00019/);
    expect(followUpStartProblem("2026-10-10T09:00", visit)).toMatch(/must be after/);
  });
});
