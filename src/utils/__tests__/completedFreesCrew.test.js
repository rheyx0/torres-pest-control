// Migration 081: a completed visit frees its crew for the rest of its booked time.
import { busyTechnicianIds, findTechnicianConflicts, holdsCrewTime } from "../scheduling";

const job = { id: "a", technicianIds: ["t1"], technicianId: "t1", scheduledAt: "2026-10-15T09:00:00", durationMinutes: 120 };
const next = { id: "b", technicianIds: ["t1"], technicianId: "t1", scheduledAt: "2026-10-15T10:00:00", durationMinutes: 60 };

test("a pending or in-progress visit holds its crew; a completed or cancelled one does not", () => {
  expect(holdsCrewTime({ status: "Pending" })).toBe(true);
  expect(holdsCrewTime({ status: "In progress" })).toBe(true);
  expect(holdsCrewTime({ status: "Completed" })).toBe(false);
  expect(holdsCrewTime({ status: "Cancelled" })).toBe(false);
});

test("finished early, the technician can take the next job in the rest of the slot", () => {
  expect(busyTechnicianIds([{ ...job, status: "In progress" }], next).has("t1")).toBe(true);
  expect(busyTechnicianIds([{ ...job, status: "Completed" }], next).has("t1")).toBe(false);
  expect(findTechnicianConflicts([{ ...job, status: "Completed" }], next)).toEqual([]);
});
