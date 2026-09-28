import { navBadges } from "../Layout";

const appointments = [
  { id: 1, status: "Pending", technicianId: "", technicianIds: [], scheduledAt: "2026-09-25T09:00:00" },
  { id: 2, status: "Pending", technicianId: "u1", technicianIds: ["u1"], scheduledAt: "2026-09-25T10:00:00" },
  { id: 3, status: "Confirmed", technicianId: "", technicianIds: [], scheduledAt: "2026-09-25T11:00:00" },
];
const inventory = [
  { id: "a", quantity: 1, reorderLevel: 5, status: "ACTIVE" },
  { id: "b", quantity: 10, reorderLevel: 5, status: "ACTIVE" },
  { id: "c", quantity: 0, reorderLevel: 5, status: "DISABLED" },
];

describe("navBadges", () => {
  it("counts unassigned pending visits and active low-stock items", () => {
    expect(navBadges({ appointments, inventory, canSchedule: true, canStock: true })).toEqual({ billing: 0, scheduling: 1, inventory: 1 });
  });

  it("shows no counts to someone who cannot act on them", () => {
    expect(navBadges({ appointments, inventory, canSchedule: false, canStock: false })).toEqual({ billing: 0, scheduling: 0, inventory: 0 });
  });
});
