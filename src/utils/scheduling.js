// Appointment overlap and status-transition helpers.
//
// The transition rules mirror the appointments_enforce_status_transition trigger
// in supabase/migrations/027-appointment-integrity.sql. The database is the
// authority; these exist so the UI can hide moves the server would reject.

import { APPOINTMENT_STATUS_TRANSITIONS } from "./constants";

const startOf = (appointment) => new Date(appointment.scheduledAt).getTime();
const endOf = (appointment) => startOf(appointment) + (appointment.durationMinutes || 60) * 60000;

export function appointmentsOverlap(a, b) {
  return startOf(a) < endOf(b) && endOf(a) > startOf(b);
}

/** Appointments that would clash with `appointment` for its assigned technician. */
export function findTechnicianConflicts(appointments, appointment) {
  if (!appointment.technicianId) return [];
  return appointments.filter((entry) =>
    entry.id !== appointment.id
    && entry.status !== "Cancelled"
    && entry.technicianId === appointment.technicianId
    && appointmentsOverlap(entry, appointment));
}

/** Technician ids already booked during `appointment`'s time window. */
export function busyTechnicianIds(appointments, appointment) {
  return new Set(appointments
    .filter((entry) =>
      entry.id !== appointment.id
      && entry.technicianId
      && entry.status !== "Cancelled"
      && appointmentsOverlap(entry, appointment))
    .map((entry) => entry.technicianId));
}

export function canTransition(from, to) {
  if (from === to) return true;
  return (APPOINTMENT_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** The statuses a status select should offer, current status included. */
export function allowedNextStatuses(from) {
  return [from, ...(APPOINTMENT_STATUS_TRANSITIONS[from] || [])];
}
