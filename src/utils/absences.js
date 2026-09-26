// Technicians who are out (migration 057).
//
// An absence covers whole days, from `startsOn` to `endsOn`, both included.
// The server refuses to book anyone on a day they are out
// (assert_technicians_available); these helpers let the forms show it first —
// "Juan — out (Sick) until Oct 2" — instead of failing on save.
//
// Dates are "YYYY-MM-DD" strings in the business's local time, compared as text.

import { dayKey } from "./dashboardMetrics";

/** The days a visit touches: its start day to the day of its last minute. */
function daysOf({ scheduledAt, durationMinutes }) {
  const start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + Math.max(1, (Number(durationMinutes) || 60) - 1) * 60000);
  return { first: dayKey(start), last: dayKey(end) };
}

/** The absence of `technicianId` that touches any of those days, or null. */
export function absenceDuring(absences, technicianId, visit) {
  const days = daysOf(visit);
  if (!days) return null;
  return (absences || []).find((absence) => absence.technicianId === technicianId
    && absence.startsOn <= days.last && absence.endsOn >= days.first) || null;
}

/**
 * Map<technicianId, absence> of everyone out for any of `visits` — one visit,
 * or every date of a plan being booked.
 */
export function outDuring(absences, visits) {
  const out = new Map();
  (visits || []).forEach((visit) => {
    const days = daysOf(visit);
    if (!days) return;
    (absences || []).forEach((absence) => {
      if (!out.has(absence.technicianId) && absence.startsOn <= days.last && absence.endsOn >= days.first) {
        out.set(absence.technicianId, absence);
      }
    });
  });
  return out;
}

/** Absences that include `dateKey`. */
export const outOn = (absences, dateKey) =>
  (absences || []).filter((absence) => absence.startsOn <= dateKey && absence.endsOn >= dateKey);

/** Absences not over yet, soonest first. */
export const currentAndUpcoming = (absences, today) =>
  (absences || []).filter((absence) => absence.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));

const shortDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

/** "out (Sick) until Oct 2" — for a picker or a card. */
export const describeOut = (absence) =>
  `out${absence.reason ? ` (${absence.reason})` : ""} until ${shortDate(absence.endsOn)}`;

/** "Oct 1 – 2" or "Oct 1". */
export const absenceDates = (absence) =>
  (absence.startsOn === absence.endsOn ? shortDate(absence.startsOn) : `${shortDate(absence.startsOn)} – ${shortDate(absence.endsOn)}`);
