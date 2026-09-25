// Appointment overlap and status-transition helpers.
//
// The transition rules mirror the appointments_enforce_status_transition trigger
// in supabase/migrations/027-appointment-integrity.sql. The database is the
// authority; these exist so the UI can hide moves the server would reject.

import { ACCOUNT_STATUS, APPOINTMENT_STATUS_TRANSITIONS } from "./constants";

export const startOf = (appointment) => new Date(appointment.scheduledAt).getTime();
export const endOf = (appointment) => startOf(appointment) + (appointment.durationMinutes || 60) * 60000;

/**
 * The visit's human-readable number, "TPC-V-00042" (migration 050). Before 050
 * is applied an appointment has no reference, so this falls back to the first
 * block of its uuid — the label the app used to print everywhere.
 */
export function appointmentReference(appointment) {
  if (!appointment) return "";
  if (appointment.reference) return appointment.reference;
  return appointment.id ? String(appointment.id).slice(0, 8).toUpperCase() : "";
}

/**
 * The service profiles on a visit, in order (migration 051). A visit booked
 * before 051 has one serviceId, or only a name; an exact name match adopts the
 * profile, as the Overview form always did. Unknown ids are dropped.
 */
export function servicesOf(appointment, serviceById = () => null, serviceByName = () => null) {
  if (!appointment) return [];
  const ids = appointment.serviceIds?.length ? appointment.serviceIds : [appointment.serviceId].filter(Boolean);
  const found = ids.map((id) => serviceById(id)).filter(Boolean);
  if (found.length) return found;
  const byName = appointment.serviceType ? serviceByName(appointment.serviceType) : null;
  return byName ? [byName] : [];
}

/**
 * Several services as one, for the Stock-Out prefill: their usual materials
 * merged, and an item two services both list summed rather than repeated.
 * Null for no services, so callers keep their "no profile" path.
 */
export function combineServices(services) {
  if (!services?.length) return null;
  if (services.length === 1) return services[0];
  const byItem = new Map();
  services.forEach((service) => (service.materials || []).forEach((material) => {
    byItem.set(material.itemId, (byItem.get(material.itemId) || 0) + (Number(material.defaultAmount) || 0));
  }));
  return {
    id: services.map((service) => service.id).join("+"),
    name: services.map((service) => service.name).join(", "),
    materials: Array.from(byItem, ([itemId, defaultAmount]) => ({ itemId, defaultAmount })),
  };
}

export function appointmentsOverlap(a, b) {
  return startOf(a) < endOf(b) && endOf(a) > startOf(b);
}

/**
 * Side-by-side placement for one day of the week calendar.
 *
 * Appointments are grouped into clusters — runs that actually overlap each
 * other — and columns are counted per cluster, not per day. That is the whole
 * point: a lone 4 PM visit must stay full width even when 9 AM had four
 * appointments stacked up. Splitting by the day's worst hour was the old bug.
 *
 * A cluster wider than `maxColumns` keeps its first `maxColumns - 1` columns and
 * reports the rest as overflow, so a card is never narrower than 1/maxColumns
 * and stays readable however booked the day is.
 */
export function layoutDayAppointments(dayAppointments, { maxColumns = 3 } = {}) {
  const sorted = [...dayAppointments].sort((a, b) => startOf(a) - startOf(b) || endOf(b) - endOf(a));

  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;

  sorted.forEach((appointment) => {
    if (current.length && startOf(appointment) >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(appointment);
    clusterEnd = Math.max(clusterEnd, endOf(appointment));
  });
  if (current.length) clusters.push(current);

  const placed = [];
  const overflow = [];

  clusters.forEach((cluster) => {
    // Greedy column packing: reuse the first column whose last occupant ended.
    const columnEnds = [];
    const columnOf = new Map();

    cluster.forEach((appointment) => {
      let column = columnEnds.findIndex((end) => end <= startOf(appointment));
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = endOf(appointment);
      columnOf.set(appointment.id, column);
    });

    const needed = columnEnds.length;
    if (needed <= maxColumns) {
      cluster.forEach((appointment) => {
        placed.push({ appointment, column: columnOf.get(appointment.id), columns: needed });
      });
      return;
    }

    // Too many to show at a readable width: keep the earliest columns and
    // collect everything past them behind a "+N more" tile in the last slot.
    const kept = [];
    const hidden = [];
    cluster.forEach((appointment) => {
      if (columnOf.get(appointment.id) < maxColumns - 1) kept.push(appointment);
      else hidden.push(appointment);
    });

    kept.forEach((appointment) => {
      placed.push({ appointment, column: columnOf.get(appointment.id), columns: maxColumns });
    });

    overflow.push({
      id: `overflow-${hidden[0].id}`,
      column: maxColumns - 1,
      columns: maxColumns,
      start: Math.min(...hidden.map(startOf)),
      end: Math.max(...hidden.map(endOf)),
      items: hidden,
    });
  });

  return { placed, overflow };
}

/**
 * The bookable window of a working day, in local hours. The week grid renders
 * exactly these rows, so a visit outside them is one nobody can see or drag.
 */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 19;
// The calendar shows the boundary row so existing 7 PM appointments remain visible.
// DAY_END_HOUR remains the booking cutoff used by validation.
export const CALENDAR_END_HOUR = DAY_END_HOUR + 1;
/** The working day the Schedule grid always shows: 7 AM – 6 PM. */
export const SCHEDULE_END_HOUR = 18;

const clockLabel = (hour) => `${String(hour % 12 || 12)}:00 ${hour < 12 ? "AM" : "PM"}`;

const minutesLabel = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

/**
 * Why a visit cannot occupy this slot, or null when it can.
 *
 * Two rules, in the order a scheduler would hit them:
 *
 *   1. It has to fit inside the working day. A 90-minute visit starting at
 *      6 PM ends after close, and the week grid has no row to draw it in.
 *   2. Its technician has to be free. Overlap is per-technician on purpose —
 *      two technicians working at once is normal, and an unassigned visit has
 *      nobody to clash with yet.
 *
 * The database enforces both as well. This exists so the form can refuse
 * before a round trip, and say something more useful than the raw error.
 */
export function describeSlotConflict(appointments, candidate) {
  const start = new Date(candidate.scheduledAt);
  if (Number.isNaN(start.getTime())) return "Enter a valid date and time.";

  const duration = Number(candidate.durationMinutes) || 0;
  if (duration <= 0) return "Set how long the visit will take.";

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const openMinutes = DAY_START_HOUR * 60;
  const closeMinutes = DAY_END_HOUR * 60;

  if (startMinutes < openMinutes || startMinutes >= closeMinutes) {
    return `Visits start between ${clockLabel(DAY_START_HOUR)} and ${clockLabel(DAY_END_HOUR)}. Pick a time inside the working day.`;
  }

  const endMinutes = startMinutes + duration;
  if (endMinutes > closeMinutes) {
    const available = closeMinutes - startMinutes;
    return `A ${minutesLabel(duration)} visit starting then runs past ${clockLabel(DAY_END_HOUR)}. Only ${minutesLabel(available)} is left in the day — shorten it or start earlier.`;
  }

  const clashes = findTechnicianConflicts(appointments, candidate);
  if (clashes.length > 0) {
    const when = new Date(clashes[0].scheduledAt)
      .toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `One of the assigned technicians is already booked at ${when}. Change the crew, or pick a free time.`;
  }

  return null;
}

/**
 * Every technician on an appointment, lead first.
 *
 * An appointment can carry a crew (`technicianIds`, migration 041) or, on
 * anything not yet re-read from the server, only the lead. Both shapes are
 * accepted so nothing here has to care which one it was handed.
 */
export function crewOf(appointment) {
  if (Array.isArray(appointment?.technicianIds) && appointment.technicianIds.length > 0) {
    return appointment.technicianIds.filter(Boolean);
  }
  return appointment?.technicianId ? [appointment.technicianId] : [];
}

/** True when `accountId` is on this appointment, whether leading it or not. */
export function isAssignedTo(appointment, accountId) {
  if (!accountId) return false;
  return crewOf(appointment).includes(accountId);
}

/** Appointments that would clash with `appointment` for any of its crew. */
export function findTechnicianConflicts(appointments, appointment) {
  const crew = crewOf(appointment);
  if (crew.length === 0) return [];
  return appointments.filter((entry) =>
    entry.id !== appointment.id
    && entry.status !== "Cancelled"
    && crewOf(entry).some((id) => crew.includes(id))
    && appointmentsOverlap(entry, appointment));
}

/** Technician ids already booked during `appointment`'s time window. */
export function busyTechnicianIds(appointments, appointment) {
  const busy = new Set();
  appointments
    .filter((entry) =>
      entry.id !== appointment.id
      && entry.status !== "Cancelled"
      && appointmentsOverlap(entry, appointment))
    .forEach((entry) => crewOf(entry).forEach((id) => busy.add(id)));
  return busy;
}

export function canTransition(from, to) {
  if (from === to) return true;
  return (APPOINTMENT_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** The statuses a status select should offer, current status included. */
export function allowedNextStatuses(from) {
  return [from, ...(APPOINTMENT_STATUS_TRANSITIONS[from] || [])];
}

/**
 * The technicians a visit can be booked with: active accounts only. A
 * deactivated technician already on `keepIds` (the crew of a visit being
 * edited) stays listed so saving the form never silently drops them; the
 * picker marks them inactive.
 */
export function bookableTechnicians(technicians, keepIds = []) {
  const keep = new Set(keepIds);
  return technicians.filter((account) => account.status !== ACCOUNT_STATUS.INACTIVE || keep.has(account.id));
}

/**
 * The writes that move a visit to `scheduledAt` without changing its status.
 *
 * update_appointment (migration 047) refuses a time change unless the row is
 * already in Reschedule, so a Pending or Confirmed visit hops through
 * Reschedule and is then saved at the new time with its ORIGINAL status —
 * Reschedule -> Pending/Confirmed is allowed by migration 027. A visit that is
 * already in Reschedule needs only the one write.
 */
export function moveSteps(appointment, scheduledAt) {
  const steps = [];
  if (appointment.status !== "Reschedule") steps.push({ ...appointment, status: "Reschedule" });
  steps.push({ ...appointment, scheduledAt, status: appointment.status });
  return steps;
}

/** Calendar-day key (YYYY-MM-DD) in local time. */
const dayKeyOf = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** The office's working window, in hours, that "full" is measured against. */
export const WORKING_HOURS_PER_DAY = 11;

/**
 * How full a day is, 0–1: booked technician-minutes over what the active
 * technicians can give in a working day. A two-person visit costs twice its
 * length; an unassigned one still costs one person's time. Cancelled visits
 * cost nothing.
 */
export function dayLoad(appointments, dateKey, technicianCount, hoursPerDay = WORKING_HOURS_PER_DAY) {
  if (!technicianCount) return 0;
  const booked = appointments
    .filter((entry) => entry.status !== "Cancelled" && dayKeyOf(entry.scheduledAt) === dateKey)
    .reduce((sum, entry) => sum + (entry.durationMinutes || 60) * Math.max(1, crewOf(entry).length), 0);
  return Math.min(1, booked / (technicianCount * hoursPerDay * 60));
}

/** Hours a technician is booked for within `window` ({ start, end } Dates), crew visits included. */
export function technicianHours(appointments, technicianId, { start, end }) {
  const minutes = appointments
    .filter(
      (entry) =>
        entry.status !== "Cancelled" &&
        isAssignedTo(entry, technicianId) &&
        startOf(entry) >= start.getTime() &&
        startOf(entry) < end.getTime()
    )
    .reduce((sum, entry) => sum + (entry.durationMinutes || 60), 0);
  return Math.round((minutes / 60) * 10) / 10;
}
