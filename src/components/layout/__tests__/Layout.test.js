import { navBadges } from "../Layout";

const appointments = [
  { id: 1, status: "Pending", technicianId: "", technicianIds: [], scheduledAt: "2026-09-25T09:00:00" },
  { id: 2, status: "Pending", technicianId: "u1", technicianIds: ["u1"], scheduledAt: "2026-09-25T10:00:00" },
  { id: 3, status: "Confirmed", technicianId: "", technicianIds: [], scheduledAt: "2026-09-25T11:00:00" },
  { id: 4, status: "Cancelled", technicianId: "u1", technicianIds: ["u1"], scheduledAt: "2026-09-26T09:00:00" },
  { id: 5, status: "Completed", technicianId: "u1", technicianIds: ["u1"], scheduledAt: "2026-09-25T08:00:00" },
  { id: 6, status: "Pending", technicianId: "u1", technicianIds: ["u1"], scheduledAt: "2026-09-24T09:00:00" },
];
const now = new Date("2026-09-25T07:00:00");
const inventory = [
  { id: "a", quantity: 1, reorderLevel: 5, status: "ACTIVE" },
  { id: "b", quantity: 10, reorderLevel: 5, status: "ACTIVE" },
  { id: "c", quantity: 0, reorderLevel: 5, status: "DISABLED" },
];

describe("navBadges", () => {
  it("counts upcoming open visits (assigned or not, from today on) and active low-stock items", () => {
    // 1–3 are Pending or Confirmed from today; cancelled, completed and yesterday's are not counted.
    expect(navBadges({ appointments, inventory, canSchedule: true, canStock: true, now })).toEqual({ billing: 0, scheduling: 3, inventory: 1 });
  });

  it("shows no counts to someone who cannot act on them", () => {
    expect(navBadges({ appointments, inventory, canSchedule: false, canStock: false, now })).toEqual({ billing: 0, scheduling: 0, inventory: 0 });
  });
});
