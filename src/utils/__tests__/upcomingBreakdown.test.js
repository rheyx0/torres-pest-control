import { upcomingAppointments, upcomingBreakdown, upcomingSummary } from "../dashboardMetrics";

const now = new Date("2026-10-30T08:00:00");
const visits = [
  { id: 1, status: "Pending", scheduledAt: "2026-10-31T09:00:00", technicianIds: [] },
  { id: 2, status: "Confirmed", scheduledAt: "2026-11-02T09:00:00", technicianIds: ["t1"], warrantyKind: "CHECKUP" },
  { id: 3, status: "Confirmed", scheduledAt: "2026-11-03T09:00:00", technicianIds: ["t1"], followUpOf: "v9" },
  { id: 4, status: "Scheduled", scheduledAt: "2026-11-04T09:00:00", technicianIds: ["t1"], warrantyKind: "RETREATMENT" },
  { id: 5, status: "Cancelled", scheduledAt: "2026-11-04T09:00:00", technicianIds: ["t1"] },
  { id: 6, status: "Pending", scheduledAt: "2026-10-29T09:00:00", technicianIds: ["t1"] },
];

test("the Schedule badge's number, by status and by kind of visit", () => {
  const upcoming = upcomingAppointments(visits, now);
  expect(upcoming.map((visit) => visit.id)).toEqual([1, 2, 3, 4]);
  const breakdown = upcomingBreakdown(upcoming);
  expect(breakdown.statuses).toEqual([{ status: "Pending", count: 1 }, { status: "Scheduled", count: 1 }, { status: "Confirmed", count: 2 }]);
  expect(breakdown.kinds.map((entry) => `${entry.count} ${entry.label}`)).toEqual(["1 Warranty checkup", "1 Free re-treatment", "1 Follow-up", "1 Service visit"]);
  expect(breakdown.unassigned).toBe(1);
  expect(upcomingSummary(breakdown)).toBe("4 upcoming appointments: 1 Pending, 1 Scheduled, 2 Confirmed. 1 Warranty checkup, 1 Free re-treatment, 1 Follow-up, 1 Service visit. 1 with no technician.");
  expect(upcomingSummary(upcomingBreakdown([]))).toBe("No upcoming appointments.");
});
