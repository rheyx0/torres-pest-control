// Covering for a technician who cannot work (migration 056).
//
// For each of the absent technician's visits the office chooses one of:
//
//   ASSIGN      someone else takes their place on the crew;
//   REMOVE      they come off, the rest of the crew carries on (or the visit
//               is left unassigned if they were alone on it);
//   RESCHEDULE  they come off and the visit goes to Reschedule, to be moved.
//
// suggestCover() proposes a starting point: the free technician with the
// lightest day, else the rest of the crew, else Reschedule. The server
// (reassign_visits) checks every clash again; this is so the form can show a
// plan that will save.

import { busyTechnicianIds, crewOf } from "./scheduling";
import { dayKey } from "./dashboardMetrics";
import { ACCOUNT_STATUS } from "./constants";
import { absenceDuring } from "./absences";

export const COVER_ACTIONS = { ASSIGN: "ASSIGN", REMOVE: "REMOVE", RESCHEDULE: "RESCHEDULE" };

/** The statuses a visit can be covered in: not started, done or cancelled. */
const COVERABLE = ["Pending", "Confirmed", "Reschedule"];

/**
 * The absent technician's visits from `from` to `to` ("YYYY-MM-DD", both
 * included), in time order: `visits` can be covered; `inProgress` are
 * already started and are left to the office to handle on the visit.
 */
export function visitsToCover(appointments, technicianId, from, to) {
  const theirs = appointments
    .filter((entry) => crewOf(entry).includes(technicianId))
    .filter((entry) => {
      const day = dayKey(entry.scheduledAt);
      return day >= from && day <= to;
    })
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  return {
    visits: theirs.filter((entry) => COVERABLE.includes(entry.status)),
    inProgress: theirs.filter((entry) => entry.status === "In progress"),
  };
}

/** The crew a visit would have after `choice`. The cover leads if the absent technician did. */
export function crewAfter(visit, absentId, choice) {
  const crew = crewOf(visit);
  const rest = crew.filter((id) => id !== absentId);
  if (choice?.action !== COVER_ACTIONS.ASSIGN || !choice.technicianId) return rest;
  const others = rest.filter((id) => id !== choice.technicianId);
  return crew[0] === absentId ? [choice.technicianId, ...others] : [...others, choice.technicianId];
}

/**
 * `appointments` as they would be with `choices` applied — so a technician
 * given one visit is seen as busy for another at the same time.
 */
function withChoices(appointments, visits, absentId, choices) {
  const byId = new Map(visits.map((visit) => [visit.id, visit]));
  return appointments.map((entry) => {
    const visit = byId.get(entry.id);
    if (!visit) return entry;
    return { ...entry, technicianIds: crewAfter(visit, absentId, choices[visit.id]), technicianId: "" };
  });
}

/**
 * Technicians who could take `visit`: active, not the absent one, not out
 * themselves that day (migration 057), not already on it, and free for its
 * whole window given the other choices. Lightest day first — booked minutes
 * on the visit's day, choices included.
 */
export function coverCandidates(visit, { appointments, technicians, absentId, absences = [], visits = [visit], choices = {} }) {
  const others = { ...choices };
  delete others[visit.id];
  const planned = withChoices(appointments, visits, absentId, others);
  const busy = busyTechnicianIds(planned.filter((entry) => entry.id !== visit.id), visit);
  const day = dayKey(visit.scheduledAt);
  const load = (id) => planned
    .filter((entry) => entry.id !== visit.id && entry.status !== "Cancelled" && dayKey(entry.scheduledAt) === day && crewOf(entry).includes(id))
    .reduce((sum, entry) => sum + (Number(entry.durationMinutes) || 60), 0);

  return technicians
    .filter((account) => account.status !== ACCOUNT_STATUS.INACTIVE)
    .filter((account) => account.id !== absentId && !crewOf(visit).includes(account.id) && !busy.has(account.id))
    .filter((account) => !absenceDuring(absences, account.id, visit))
    .map((account) => ({ account, minutes: load(account.id) }))
    .sort((a, b) => a.minutes - b.minutes || String(a.account.name || "").localeCompare(String(b.account.name || "")))
    .map((entry) => entry.account);
}

/** A starting choice for every visit, taken in time order so earlier picks count as busy. */
export function suggestCover(visits, { appointments, technicians, absentId, absences = [] }) {
  const choices = {};
  visits.forEach((visit) => {
    const [first] = coverCandidates(visit, { appointments, technicians, absentId, absences, visits, choices });
    if (first) choices[visit.id] = { action: COVER_ACTIONS.ASSIGN, technicianId: first.id };
    else if (crewOf(visit).some((id) => id !== absentId)) choices[visit.id] = { action: COVER_ACTIONS.REMOVE };
    else choices[visit.id] = { action: COVER_ACTIONS.RESCHEDULE };
  });
  return choices;
}

/**
 * Problems with the office's choices, by visit id: a cover who is no longer
 * free (two visits given to one person at once), or an ASSIGN with nobody.
 */
export function coverProblems(visits, { appointments, technicians, absentId, absences = [], choices }) {
  const problems = {};
  visits.forEach((visit) => {
    const choice = choices[visit.id];
    if (choice?.action !== COVER_ACTIONS.ASSIGN) return;
    if (!choice.technicianId) {
      problems[visit.id] = "Choose who covers this visit.";
      return;
    }
    const free = coverCandidates(visit, { appointments, technicians, absentId, absences, visits, choices });
    if (!free.some((account) => account.id === choice.technicianId)) {
      problems[visit.id] = absenceDuring(absences, choice.technicianId, visit)
        ? "Out that day. Choose someone else."
        : "Already busy at this time. Choose someone else.";
    }
  });
  return problems;
}

/** The changes reassign_visits() takes: [{ appointment_id, action, technician_ids }]. */
export const coverChanges = (visits, absentId, choices) => visits.map((visit) => ({
  appointment_id: visit.id,
  action: choices[visit.id]?.action || COVER_ACTIONS.RESCHEDULE,
  technician_ids: crewAfter(visit, absentId, choices[visit.id]),
}));
