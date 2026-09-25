// Recurring plans and multi-day jobs (migration 052): the arithmetic behind
// the New appointment form's list of dates, and the questions the rest of the
// app asks about a visit that belongs to a plan.
//
// Pure: no React, no Supabase. The form works out the dates here, shows them,
// lets the office fix the flagged ones, and sends exactly that list to
// book_appointments() — the database books what was on screen rather than
// recomputing it.
//
// A visit in the form is `{ key, scheduledAt, durationMinutes }`, scheduledAt a
// local "YYYY-MM-DDTHH:mm" string like the datetime-local input's value.

import { addDays, toDateTimeLocal } from "./calendarDates";
import { DAY_END_HOUR, DAY_START_HOUR, crewOf, findTechnicianConflicts, visitClosed } from "./scheduling";
import { validateAppointmentStart } from "./validators";

export const PLAN_KINDS = { RECURRING: "RECURRING", MULTI_DAY: "MULTI_DAY" };

/** Mirrors book_appointments(): a plan holds at most this many visits. */
export const MAX_PLAN_VISITS = 60;

/** One working day, 6 AM to 7 PM. A job longer than this is split into days. */
export const WORKDAY_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

/** How far ahead "until" may reach, so a typo'd year cannot book 60 visits. */
export const MAX_PLAN_MONTHS = 24;

const DAY_STEPS = { Daily: 1, Weekly: 7, "Every 2 weeks": 14 };
const MONTH_STEPS = { Monthly: 1, Quarterly: 3, "Semi-annual": 6, Annual: 12 };

/** True for a frequency that repeats (everything but One-time / not set). */
export const isRecurringFrequency = (frequency) => Boolean(DAY_STEPS[frequency] || MONTH_STEPS[frequency]);

const isSunday = (date) => date.getDay() === 0;

/**
 * The n-th month after `start`, on the same day of the month, clamped to the
 * month's end: Jan 31 monthly is Feb 28, then Mar 31. Always counted from the
 * start, never from the previous visit, so a short month does not drag every
 * later date earlier.
 */
function addMonthsClamped(start, months) {
  const target = new Date(start);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(start.getDate(), lastDay));
  return target;
}

/**
 * The dates of a recurring plan, as Dates at the start's time of day.
 *
 * "Monthly" means the same date each month, not every 30 days, so the dates
 * never drift. With `skipSundays`, a Daily plan steps over Sundays without
 * counting them, and any other frequency landing on a Sunday moves to Monday.
 *
 * Stops at `count` visits, or at the last date on or before `until` (a
 * "YYYY-MM-DD" string), whichever the caller gave — and never past
 * MAX_PLAN_VISITS or MAX_PLAN_MONTHS.
 */
export function recurringDates(start, frequency, { count = null, until = null, skipSundays = true } = {}) {
  const first = new Date(start);
  if (Number.isNaN(first.getTime()) || !isRecurringFrequency(frequency)) return [];

  const limit = Math.min(count || MAX_PLAN_VISITS, MAX_PLAN_VISITS);
  const horizon = addMonthsClamped(first, MAX_PLAN_MONTHS);
  const endOfUntil = until ? new Date(`${until}T23:59:59`) : null;
  const last = endOfUntil && endOfUntil < horizon ? endOfUntil : horizon;
  const dates = [];

  if (frequency === "Daily") {
    for (let cursor = new Date(first); dates.length < limit && cursor <= last; cursor = addDays(cursor, 1)) {
      if (skipSundays && isSunday(cursor)) continue;
      dates.push(new Date(cursor));
    }
    return dates;
  }

  for (let n = 0; dates.length < limit; n += 1) {
    let next = MONTH_STEPS[frequency]
      ? addMonthsClamped(first, n * MONTH_STEPS[frequency])
      : addDays(first, n * DAY_STEPS[frequency]);
    if (skipSundays && isSunday(next)) next = addDays(next, 1);
    if (next > last) break;
    dates.push(next);
  }
  return dates;
}

/**
 * A job longer than one working day, split into days: the first runs from its
 * start to 7 PM, each later day from 6 AM, until the hours are used up.
 * Sundays are stepped over when `skipSundays`.
 */
export function splitIntoDays(start, totalMinutes, { skipSundays = true } = {}) {
  const days = [];
  let remaining = Math.max(0, Math.round(Number(totalMinutes) || 0));
  let cursor = new Date(start);
  if (Number.isNaN(cursor.getTime())) return days;

  while (remaining > 0 && days.length < 14) {
    if (skipSundays && isSunday(cursor)) {
      cursor = addDays(cursor, 1);
      cursor.setHours(DAY_START_HOUR, 0, 0, 0);
      continue;
    }
    const close = new Date(cursor);
    close.setHours(DAY_END_HOUR, 0, 0, 0);
    const available = Math.floor((close - cursor) / 60000);
    if (available > 0) {
      const take = Math.min(remaining, available);
      days.push({ scheduledAt: toDateTimeLocal(cursor), durationMinutes: take });
      remaining -= take;
    }
    cursor = addDays(cursor, 1);
    cursor.setHours(DAY_START_HOUR, 0, 0, 0);
  }
  return days;
}

let keySeed = 0;
/** Stable keys for form rows, so editing one row never remounts another. */
export const visitKey = () => {
  keySeed += 1;
  return `visit-${keySeed}`;
};

/** The same visit at another time of day ("HH:MM"). */
export function atTime(visit, time) {
  return { ...visit, scheduledAt: `${visit.scheduledAt.slice(0, 10)}T${time}` };
}

const clock = (value) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const minutesOf = (value) => {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
};

/** Why one visit of the list cannot be booked as it stands, or null. */
function visitProblem(visit, index, visits, context) {
  const { appointments, technicianIds, kind, skipSundays, now, nameOf } = context;
  const start = new Date(visit.scheduledAt);
  if (Number.isNaN(start.getTime())) return { problem: "invalid", message: "Pick a date and time" };
  if (validateAppointmentStart(visit.scheduledAt, now)) return { problem: "past", message: "In the past" };

  const startMinutes = minutesOf(visit.scheduledAt);
  if (startMinutes < DAY_START_HOUR * 60 || startMinutes + visit.durationMinutes > DAY_END_HOUR * 60) {
    return { problem: "hours", message: "Outside working hours (6 AM – 7 PM)" };
  }
  if (skipSundays && isSunday(start)) return { problem: "sunday", message: "Sunday" };

  if (kind === PLAN_KINDS.MULTI_DAY && index > 0) {
    const previous = visits[index - 1];
    const previousEnd = new Date(previous.scheduledAt).getTime() + previous.durationMinutes * 60000;
    if (start.getTime() < previousEnd) return { problem: "order", message: "Starts before the day before it ends" };
  }

  // The other visits of this same list count too: two of them must not
  // overlap each other any more than an existing booking.
  const siblings = visits
    .filter((other) => other.key !== visit.key)
    .map((other) => ({ id: other.key, scheduledAt: other.scheduledAt, durationMinutes: other.durationMinutes, technicianIds, status: "Pending" }));
  const candidate = { id: visit.key, scheduledAt: visit.scheduledAt, durationMinutes: visit.durationMinutes, technicianIds };
  const clash = findTechnicianConflicts([...appointments, ...siblings], candidate)[0];
  if (clash) {
    const who = crewOf(clash).find((id) => technicianIds.includes(id));
    const name = (who && nameOf?.(who)) || "A technician";
    return { problem: "clash", message: `${name} already has a visit at ${clock(clash.scheduledAt)}` };
  }
  return { problem: null, message: "" };
}

/**
 * Every visit of the list with the reason it cannot be booked, if any:
 * `{ ...visit, problem, message }`, problem one of past / hours / sunday /
 * order / clash / invalid, or null when the date is fine.
 */
export function checkVisits(visits, { appointments = [], technicianIds = [], kind = null, skipSundays = true, now = new Date(), nameOf = null } = {}) {
  const context = { appointments, technicianIds, kind, skipSundays, now, nameOf };
  return visits.map((visit, index) => ({ ...visit, ...visitProblem(visit, index, visits, context) }));
}

const allClear = (visits, { appointments = [], technicianIds = [], kind = null, skipSundays = true, now = new Date(), nameOf = null } = {}) => {
  const context = { appointments, technicianIds, kind, skipSundays, now, nameOf };
  // Stops at the first flagged visit rather than checking the whole list.
  return visits.every((visit, index) => !visitProblem(visit, index, visits, context).problem);
};

/**
 * The first time of day, on the half hour, at which EVERY visit of a
 * recurring list is free — "Move all to 1:00 PM". Null when there is none, or
 * when no technician is on the booking (nobody to clash with).
 */
export function commonFreeTime(visits, context) {
  if (!visits.length || !context.technicianIds?.length) return null;
  const longest = Math.max(...visits.map((visit) => visit.durationMinutes));
  for (let minutes = DAY_START_HOUR * 60; minutes + longest <= DAY_END_HOUR * 60; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    if (allClear(visits.map((visit) => atTime(visit, time)), context)) return time;
  }
  return null;
}

/**
 * A technician free at every visit's own time — "Use Karl instead". Offered
 * only for a one-person booking: swapping one member of a crew is a choice
 * the office should make itself.
 */
export function freeTechnician(visits, context, accounts = []) {
  if (!visits.length || context.technicianIds?.length !== 1) return null;
  return accounts.find((account) =>
    !context.technicianIds.includes(account.id) && allClear(visits, { ...context, technicianIds: [account.id] })) || null;
}

/**
 * The next free start on the same day, for one flagged visit, or null. Checks
 * only the visit being moved (against the others as they stand), so a long
 * plan stays quick to redraw.
 */
export function nextFreeStart(visit, visits, { appointments = [], technicianIds = [], kind = null, skipSundays = true, now = new Date(), nameOf = null } = {}) {
  const context = { appointments, technicianIds, kind, skipSundays, now, nameOf };
  const index = visits.findIndex((entry) => entry.key === visit.key);
  const from = Math.max(DAY_START_HOUR * 60, minutesOf(visit.scheduledAt));
  for (let minutes = from; minutes + visit.durationMinutes <= DAY_END_HOUR * 60; minutes += 15) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const moved = atTime(visit, time);
    const list = visits.map((entry) => (entry.key === visit.key ? moved : entry));
    if (!visitProblem(moved, index, list, context).problem) return moved.scheduledAt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A visit that belongs to a plan
// ---------------------------------------------------------------------------

/** The live (not cancelled) visits of `appointment`'s plan, in order. */
export function planVisits(appointment, appointments) {
  if (!appointment?.planId) return [];
  return appointments
    .filter((entry) => entry.planId === appointment.planId && entry.status !== "Cancelled")
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
}

/** "Day 1/3" for a multi-day job, "3/6" for a recurring plan, "" otherwise. */
export function planLabel(appointment, appointments) {
  const visits = planVisits(appointment, appointments);
  const index = visits.findIndex((entry) => entry.id === appointment.id);
  if (index < 0) return "";
  return appointment.planKind === PLAN_KINDS.MULTI_DAY ? `Day ${index + 1}/${visits.length}` : `${index + 1}/${visits.length}`;
}

export const isMultiDay = (appointment) => appointment?.planKind === PLAN_KINDS.MULTI_DAY;

/** The day of a multi-day job that takes the report: its last live day. */
export function isLastJobDay(appointment, appointments) {
  if (!isMultiDay(appointment)) return true;
  const visits = planVisits(appointment, appointments);
  return visits[visits.length - 1]?.id === appointment.id;
}

/**
 * Why moving a multi-day job's day to `candidate`'s time would break the
 * job's order, or null. The database refuses the same move (052's trigger);
 * this says so before the round trip.
 */
export function dayOrderProblem(candidate, appointments) {
  if (!isMultiDay(candidate)) return null;
  const visits = planVisits(candidate, appointments);
  const index = visits.findIndex((entry) => entry.id === candidate.id);
  if (index < 0) return null;
  const start = new Date(candidate.scheduledAt).getTime();
  const end = start + (candidate.durationMinutes || 60) * 60000;
  const before = visits[index - 1];
  const after = visits[index + 1];
  if (before && start < new Date(before.scheduledAt).getTime() + (before.durationMinutes || 60) * 60000) {
    return `Day ${index + 1} of this job can't start before day ${index} ends.`;
  }
  if (after && end > new Date(after.scheduledAt).getTime()) {
    return `Day ${index + 1} of this job can't run past the start of day ${index + 2}.`;
  }
  return null;
}

/** A day of a multi-day job before its last: closed with "Day done", no report. */
export const isEarlierJobDay = (appointment, appointments) => isMultiDay(appointment) && !isLastJobDay(appointment, appointments);

/**
 * A multi-day job as one visit, for the printed report: every day's photos and
 * materials together, and the list of days. Any other visit is returned as is.
 */
export function printableJob(appointment, appointments) {
  if (!isMultiDay(appointment)) return appointment;
  const days = planVisits(appointment, appointments);
  return {
    ...appointment,
    attachments: days.flatMap((day) => day.attachments || []),
    stockUsed: days.flatMap((day) => day.stockUsed || []),
    jobDays: days.map((day) => ({ scheduledAt: day.scheduledAt, durationMinutes: day.durationMinutes })),
  };
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/**
 * Recurring plans about to run out with nothing booked after them: the office
 * is reminded to renew. `{ client, last, remaining, dueAt, frequency, serviceIds }`
 * — `last` is the plan's final visit, `dueAt` where the next plan would start.
 *
 * A plan the office cancelled ("Cancel remaining") or marked "Don't renew"
 * (migration 053) is left alone: ending it was the decision, and a reminder
 * would only nag.
 */
export function plansEnding(appointments, clients, now = new Date(), threshold = 2) {
  const plans = new Map();
  appointments.forEach((entry) => {
    if (!entry.planId || entry.planKind !== PLAN_KINDS.RECURRING) return;
    if (!plans.has(entry.planId)) plans.set(entry.planId, []);
    plans.get(entry.planId).push(entry);
  });

  const due = [];
  plans.forEach((entries) => {
    if (entries.some((entry) => entry.status === "Cancelled" && entry.cancellationReason === "Plan cancelled")) return;
    if (entries[0].planRenewalDeclinedAt) return;
    const live = entries.filter((entry) => entry.status !== "Cancelled").sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    const last = live[live.length - 1];
    if (!last) return;
    const client = clients.find((entry) => entry.id === last.clientId);
    if (!client || client.status === "ARCHIVED") return;

    const remaining = live.filter((entry) => !visitClosed(entry) && new Date(entry.scheduledAt) >= now).length;
    if (remaining > threshold) return;
    // Anything live booked after the plan's last visit is its renewal.
    const lastStart = new Date(last.scheduledAt).getTime();
    const renewed = appointments.some((entry) =>
      entry.clientId === last.clientId && entry.planId !== last.planId && entry.status !== "Cancelled"
      && new Date(entry.scheduledAt).getTime() > lastStart);
    if (renewed) return;

    const [, next] = recurringDates(new Date(last.scheduledAt), last.planFrequency || last.serviceFrequency, { count: 2, skipSundays: true });
    due.push({
      client,
      last,
      remaining,
      dueAt: next || new Date(last.scheduledAt),
      frequency: last.planFrequency || last.serviceFrequency,
      serviceIds: last.serviceIds || [],
      renewal: true,
    });
  });
  return due.sort((a, b) => a.dueAt - b.dueAt);
}
