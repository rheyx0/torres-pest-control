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
