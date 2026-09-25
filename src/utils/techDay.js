// A technician's day, for the phone Today screen and the visit flow.
// Pure, so the rules (what is "up next", what counts as done) are tested.

import { crewOf, endOf, isAssignedTo, startOf, visitClosed } from "./scheduling";
import { dayKey } from "./dashboardMetrics";

// Completed, reported, or a multi-day job's day closed with "Day done".
export const isDone = visitClosed;

/**
 * Today's visits for one technician, split the way the Today screen shows
 * them. `upNext` is the visit in progress if there is one, otherwise the
 * earliest not-done visit — even one whose slot has passed, because it still
 * has to be done or explained.
 */
export function dayPlan(appointments, technicianId, now = new Date()) {
  const key = dayKey(now);
  const today = appointments
    .filter((entry) => entry.status !== "Cancelled" && isAssignedTo(entry, technicianId) && dayKey(entry.scheduledAt) === key)
    .sort((a, b) => startOf(a) - startOf(b));
  const done = today.filter(isDone);
  const open = today.filter((entry) => !isDone(entry));
  const upNext = open.find((entry) => entry.status === "In progress") || open[0] || null;
  const later = open.filter((entry) => entry !== upNext);
  const minutesLeft = open.reduce((sum, entry) => sum + (entry.durationMinutes || 60), 0);
  return { today, done, upNext, later, minutesLeft };
}

/** "about 5 h of work", "about 45 min of work", or "" when nothing is left. */
export function workLeftLabel(minutes) {
  if (!minutes) return "";
  if (minutes < 60) return `about ${minutes} min of work`;
  const hours = Math.round(minutes / 30) / 2;
  return `about ${Number.isInteger(hours) ? hours : hours.toFixed(1)} h of work`;
}

/** Is this technician the lead on a crew visit? (Only worth saying when there is a crew.) */
export function leadsCrew(appointment, technicianId) {
  const crew = crewOf(appointment);
  return crew.length > 1 && crew[0] === technicianId;
}

/** Minutes since the visit was started, for "Visit started 10:04 · 37 min". */
export function minutesOnSite(appointment, now = new Date()) {
  if (!appointment?.startedAt) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(appointment.startedAt).getTime()) / 60000));
}

/** Whether a visit can be started now: today, not done, not already cancelled. */
export function canStart(appointment, now = new Date()) {
  if (!appointment || isDone(appointment)) return false;
  if (!["Pending", "Scheduled", "Confirmed", "Reschedule"].includes(appointment.status)) return false;
  return dayKey(appointment.scheduledAt) === dayKey(now);
}

/** Whether the slot has passed with the visit still open. */
export const isRunningLate = (appointment, now = new Date()) => !isDone(appointment) && endOf(appointment) < now.getTime();

// ---------------------------------------------------------------------------
// The visit flow
// ---------------------------------------------------------------------------

export const VISIT_STEPS = ["Findings", "Treatment", "Photos", "Sign"];

/** Units counted in whole pieces step by 1; everything else (L, kg, mL) by 0.1. */
export function stepFor(unit) {
  return /^(pc|pcs|piece|pieces|unit|units|pair|pairs|tube|tubes|box|boxes|pack|packs|can|cans|bottle|bottles|roll|rolls)$/i.test(String(unit || "").trim())
    ? 1
    : 0.1;
}

/** Round to the step so 0.1 + 0.2 shows as 0.3, not 0.30000000000000004. */
export function adjustAmount(amount, delta, step) {
  const next = Math.max(0, (Number(amount) || 0) + delta);
  return step >= 1 ? Math.round(next) : Math.round(next * 10) / 10;
}

/** Materials prefilled from the service profile (migration 047), for active items only. */
export function materialsFromService(service, inventory) {
  return (service?.materials || [])
    .map((material) => ({ material, item: inventory.find((entry) => entry.id === material.itemId) }))
    .filter(({ item }) => item && item.status !== "DISABLED")
    .map(({ material, item }) => ({ itemId: item.id, amount: Number(material.defaultAmount) || 0 }));
}

// ---------------------------------------------------------------------------
// Draft saved on the device
//
// The report form is saved to localStorage as it is typed, so a dropped
// signal, a locked phone or an accidental Back loses nothing. It is only a
// draft on this phone — nothing reaches the office until the report is sent.
// ---------------------------------------------------------------------------

const draftKey = (appointmentId) => `torres_visit_draft_${appointmentId}`;

export function loadDraft(appointmentId) {
  try {
    const raw = localStorage.getItem(draftKey(appointmentId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(appointmentId, draft) {
  try {
    localStorage.setItem(draftKey(appointmentId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(appointmentId) {
  try {
    localStorage.removeItem(draftKey(appointmentId));
  } catch {
    // Nothing to clear.
  }
}
