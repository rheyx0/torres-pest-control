// The office "Today" dashboard, as data.
//
// Everything here is a pure function over lists the contexts already hold —
// appointments, clients, inventory, accounts — so the dashboard makes no new
// queries and every rule below is unit-tested without rendering.
//
//   dispatchLanes   the dispatch board: one lane per technician + Unassigned
//   attentionItems  the "Needs attention" queue, each with one action
//   weekBars        visits per day, Monday to Sunday
//   weekRevenue     agreed prices of this week's live visits
//   recentVisits    visits that just finished, with their report state
//
// Dates: inventory dates are date-only strings ("2026-10-05"). `new Date()`
// reads those as UTC midnight, which is the previous day east of Greenwich's
// evening and west of it all day, so they are parsed as local dates here.

import { crewOf, endOf, isAssignedTo, reportOwed, startOf } from "./scheduling";
import { plansEnding } from "./plans";
import { byTime, dayKey, weekWindow } from "./dashboardMetrics";

export const BOARD_START_HOUR = 7;
export const BOARD_END_HOUR = 18;

const DAY_MS = 86400000;
const live = (entry) => entry.status !== "Cancelled";

export function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** "2026-10-05" (or a full timestamp) as a local calendar date, or null. */
export function localDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);

// ---------------------------------------------------------------------------
// Dispatch board
// ---------------------------------------------------------------------------

/**
 * Where a visit sits on a 7 AM – 6 PM track, as percentages. A visit that
 * starts before 7 or runs past 6 is clipped to the track and flagged, so it
 * still shows rather than vanishing.
 */
export function trackPlacement(appointment, day, startHour = BOARD_START_HOUR, endHour = BOARD_END_HOUR) {
  const trackStart = startOfDay(day).getTime() + startHour * 3600000;
  const trackEnd = startOfDay(day).getTime() + endHour * 3600000;
  const span = trackEnd - trackStart;
  const start = Math.max(startOf(appointment), trackStart);
  const end = Math.min(endOf(appointment), trackEnd);
  if (end <= trackStart || start >= trackEnd) return null;
  return {
    left: ((start - trackStart) / span) * 100,
    width: Math.max(((end - start) / span) * 100, 3),
    clippedStart: startOf(appointment) < trackStart,
    clippedEnd: endOf(appointment) > trackEnd,
  };
}

/** The "now" line's position on the track, or null outside the window or on another day. */
export function nowPlacement(day, now = new Date(), startHour = BOARD_START_HOUR, endHour = BOARD_END_HOUR) {
  if (dayKey(day) !== dayKey(now)) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const from = startHour * 60;
  const to = endHour * 60;
  if (minutes < from || minutes > to) return null;
  return ((minutes - from) / (to - from)) * 100;
}

/**
 * One lane per technician, in the order given, plus an Unassigned lane when
 * anything is unassigned. A crew visit appears in every member's lane — that
 * is where each of them will be. Cancelled visits are left off: they are not
 * anywhere.
 */
export function dispatchLanes(appointments, technicians, day) {
  const key = dayKey(day);
  const todays = appointments.filter((entry) => live(entry) && dayKey(entry.scheduledAt) === key).sort(byTime);
  const place = (entry) => ({ appointment: entry, placement: trackPlacement(entry, day) });

  const lanes = technicians.map((technician) => ({
    key: technician.id,
    technician,
    jobs: todays.filter((entry) => isAssignedTo(entry, technician.id)).map(place),
  }));

  const unassigned = todays.filter((entry) => crewOf(entry).length === 0).map(place);
  lanes.push({ key: "unassigned", technician: null, jobs: unassigned });
  return lanes;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** Unassigned, still-to-happen visits: the dispatch backlog. */
export function unassignedUpcoming(appointments, now = new Date()) {
  const today = startOfDay(now).getTime();
  return appointments
    .filter((entry) => live(entry) && entry.status !== "Completed" && crewOf(entry).length === 0 && startOf(entry) >= today)
    .sort(byTime);
}

/**
 * Visits that ended more than a day ago with no report filed. Looks back 30
 * days so a years-old record with no report doesn't sit in the queue forever.
 */
export function overdueReports(appointments, now = new Date(), { graceHours = 24, lookbackDays = 30 } = {}) {
  const cutoff = now.getTime() - graceHours * 3600000;
  const floor = now.getTime() - lookbackDays * DAY_MS;
  return appointments
    .filter((entry) => live(entry) && reportOwed(entry) && endOf(entry) <= cutoff && endOf(entry) >= floor)
    .sort(byTime);
}

/** Filed reports with no customer signature image, newest first, last 30 days. */
export function unsignedReports(appointments, now = new Date(), lookbackDays = 30) {
  const floor = now.getTime() - lookbackDays * DAY_MS;
  return appointments
    .filter((entry) => live(entry) && entry.reportSubmitted && !entry.signaturePath && startOf(entry) >= floor)
    .sort((a, b) => byTime(b, a));
}

/** Agreed prices of this week's live visits. Price is optional, so `priced` says how many had one. */
export function weekRevenue(appointments, now = new Date()) {
  const { start, end } = weekWindow(now);
  const inWeek = appointments.filter((entry) => live(entry) && startOf(entry) >= start.getTime() && startOf(entry) < end.getTime());
  const priced = inWeek.filter((entry) => entry.price !== "" && entry.price !== null && entry.price !== undefined && !Number.isNaN(Number(entry.price)));
  const total = priced.reduce((sum, entry) => sum + Number(entry.price), 0);
  return { total, visits: inWeek.length, priced: priced.length, average: priced.length ? total / priced.length : 0 };
}

/** Visits per day this week, Monday first, with which day is today and which are still ahead. */
export function weekBars(appointments, now = new Date()) {
  const { start } = weekWindow(now);
  const todayKey = dayKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const key = dayKey(date);
    return {
      key,
      label: date.toLocaleDateString([], { weekday: "short" }),
      value: appointments.filter((entry) => live(entry) && dayKey(entry.scheduledAt) === key).length,
      isToday: key === todayKey,
      isFuture: startOfDay(date) > startOfDay(now),
    };
  });
}

/**
 * Visits that have finished, newest first — the "Recently completed" list.
 * Includes ones with no report yet, because "Report due" is exactly what the
 * office needs to see there.
 */
export function recentVisits(appointments, now = new Date(), { limit = 5, lookbackDays = 3 } = {}) {
  const floor = startOfDay(now).getTime() - lookbackDays * DAY_MS;
  return appointments
    .filter((entry) => live(entry) && endOf(entry) <= now.getTime() && startOf(entry) >= floor)
    .sort((a, b) => endOf(b) - endOf(a))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Re-service
// ---------------------------------------------------------------------------

/**
 * How far ahead a re-service or renewal reminder appears. One number for the
 * Today queue and the Schedule side panel, so a client never shows in one and
 * not the other.
 */
export const RESERVICE_WINDOW_DAYS = 14;

/** Days between visits for each frequency in SERVICE_FREQUENCIES (constants.js). */
export const FREQUENCY_DAYS = {
  Daily: 1,
  Weekly: 7,
  "Every 2 weeks": 14,
  Monthly: 30,
  Quarterly: 91,
  "Semi-annual": 182,
  Annual: 365,
};

/**
 * Clients on a recurring plan who are due (or due within `withinDays`) and
 * have nothing booked. "Due" is the last completed visit plus its frequency;
 * any live visit after that one means the next is already booked.
 *
 * This is the reminder for visits booked one at a time, before plans existed
 * (migration 052). A visit that belongs to a plan is skipped here — its plan
 * books every visit up front and reminds through plansEnding() instead.
 */
export function reserviceDue(appointments, clients, now = new Date(), withinDays = RESERVICE_WINDOW_DAYS) {
  const horizon = startOfDay(now).getTime() + (withinDays + 1) * DAY_MS;
  const byClient = new Map();
  appointments.forEach((entry) => {
    if (!byClient.has(entry.clientId)) byClient.set(entry.clientId, []);
    byClient.get(entry.clientId).push(entry);
  });

  const due = [];
  clients.forEach((client) => {
    if (client.status === "ARCHIVED") return;
    const visits = byClient.get(client.id) || [];
    const last = visits
      .filter((entry) => entry.status === "Completed" || entry.reportSubmitted)
      .sort((a, b) => byTime(b, a))[0];
    const days = last && !last.planId && FREQUENCY_DAYS[last.serviceFrequency];
    if (!days) return;
    // Anything live booked after the last finished visit IS the next visit,
    // even if it is earlier today or still waiting on its report.
    if (visits.some((entry) => entry !== last && live(entry) && startOf(entry) > startOf(last))) return;
    const dueAt = startOf(last) + days * DAY_MS;
    if (dueAt < horizon) due.push({ client, last, dueAt: new Date(dueAt), frequency: last.serviceFrequency, serviceIds: last.serviceIds || [] });
  });
  return due.sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * Everything the office should book next, soonest first: clients due for
 * re-service (visits booked one at a time) and recurring plans about to run
 * out (plansEnding, marked `renewal: true`). Both lists carry the client, the
 * visit to copy from (`last`), a due date and the frequency.
 */
export function bookingReminders(appointments, clients, now = new Date(), withinDays = RESERVICE_WINDOW_DAYS) {
  return [...reserviceDue(appointments, clients, now, withinDays), ...plansEnding(appointments, clients, now)]
    .sort((a, b) => a.dueAt - b.dueAt);
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

const listNames = (names, max = 3) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} +${names.length - max} more`;

const shortDate = (date) => date.toLocaleDateString([], { month: "short", day: "numeric" });
const shortTime = (value) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function whenPhrase(value, now) {
  const diff = daysBetween(now, new Date(value));
  const day = diff === 0 ? "today" : diff === 1 ? "tomorrow" : shortDate(new Date(value));
  return `${shortTime(value)} ${day}`;
}

/**
 * The dashboard's work queue. Each item: { key, kind, tone, title, detail,
 * action: { label, to } }. Kinds are emitted in the handoff's order; empty
 * ones are skipped. `canBook` / `canSeeStock` drop items the viewer could
 * not act on.
 */
export function attentionItems(
  { appointments = [], clients = [], inventory = [], users = [] },
  { now = new Date(), canBook = true, canSeeStock = true, expiryDays = 30 } = {}
) {
  const clientName = (id) => clients.find((client) => client.id === id)?.name || "Unknown client";
  const personName = (id) => {
    const person = users.find((user) => user.id === id);
    return person?.name || person?.username || "";
  };
  const items = [];

  const unassigned = unassignedUpcoming(appointments, now);
  if (unassigned.length) {
    items.push({
      key: "unassigned",
      kind: "unassigned",
      tone: "warning",
      title: unassigned.length === 1 ? "1 visit has no technician" : `${unassigned.length} visits have no technician`,
      detail: listNames(unassigned.map((entry) => `${clientName(entry.clientId)} ${whenPhrase(entry.scheduledAt, now)}`), 2),
      action: { label: "Assign", to: `/scheduling?appointment=${encodeURIComponent(unassigned[0].id)}` },
    });
  }

  const overdue = overdueReports(appointments, now);
  if (overdue.length) {
    const oldest = overdue[0];
    const lead = personName(crewOf(oldest)[0]);
    items.push({
      key: "overdue",
      kind: "report",
      tone: "danger",
      title: overdue.length === 1 ? "1 service report overdue" : `${overdue.length} service reports overdue`,
      detail: `Oldest: ${clientName(oldest.clientId)}, ${shortDate(new Date(oldest.scheduledAt))}${lead ? ` · ${lead}` : ""}`,
      action: { label: "Review", to: `/scheduling?appointment=${encodeURIComponent(oldest.id)}&tab=Report` },
    });
  }

  if (canSeeStock) {
    const today = startOfDay(now);
    inventory
      .filter((item) => item.status !== "DISABLED" && item.type === "CHEMICAL" && Number(item.quantity) > 0)
      .map((item) => ({ item, expires: localDate(item.expirationDate) }))
      .filter(({ expires }) => expires && daysBetween(today, expires) <= expiryDays)
      .sort((a, b) => a.expires - b.expires)
      .forEach(({ item, expires }) => {
        const days = daysBetween(today, expires);
        items.push({
          key: `expiry-${item.id}`,
          kind: "expiry",
          tone: "danger",
          title:
            days < 0 ? `${item.name} expired ${shortDate(expires)}` : days === 0 ? `${item.name} expires today` : `${item.name} expires in ${days === 1 ? "1 day" : `${days} days`}`,
          detail: `${item.quantity} ${item.unit || ""} on hand · ${expires.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`.replace("  ", " "),
          action: { label: "View", to: `/inventory?q=${encodeURIComponent(item.name)}` },
        });
      });

    inventory
      .filter((item) => item.status !== "DISABLED" && item.type === "EQUIPMENT")
      .map((item) => ({ item, dueOn: localDate(item.nextMaintenanceDate) }))
      .filter(({ dueOn }) => dueOn && dueOn < today)
      .sort((a, b) => a.dueOn - b.dueOn)
      .forEach(({ item, dueOn }) => {
        items.push({
          key: `maintenance-${item.id}`,
          kind: "maintenance",
          tone: "warning",
          title: `${item.name} maintenance overdue`,
          detail: [`Was due ${shortDate(dueOn)}`, item.serialNumber].filter(Boolean).join(" · "),
          action: { label: "Log", to: `/inventory?q=${encodeURIComponent(item.name)}` },
        });
      });
  }

  const reservice = bookingReminders(appointments, clients, now);
  if (reservice.length) {
    const plans = [...new Set(reservice.map((entry) => entry.frequency.toLowerCase()))];
    const [first] = reservice;
    const renewalTitle = first.remaining === 0
      ? `${first.client.name}'s ${first.frequency.toLowerCase()} plan has ended`
      : `${first.client.name}'s ${first.frequency.toLowerCase()} plan ends in ${first.remaining} visit${first.remaining === 1 ? "" : "s"}`;
    items.push({
      key: "reservice",
      kind: "reservice",
      tone: "neutral",
      title: reservice.length === 1
        ? (first.renewal ? renewalTitle : `${first.client.name} is due for re-service`)
        : `${reservice.length} clients to book next`,
      detail:
        reservice.length === 1
          ? (first.renewal ? `Renew from ${shortDate(first.dueAt)} · nothing booked after it` : `${first.frequency} plan · due ${shortDate(first.dueAt)} · nothing booked`)
          : `${listNames(reservice.map((entry) => entry.client.name), 2)} · ${plans.join(", ")} plans with no visit booked`,
      // ?book= opens New appointment copied from that visit (Schedule page).
      action: canBook
        ? { label: first.renewal ? "Renew" : "Book", to: `/scheduling?book=${encodeURIComponent(first.last.id)}` }
        : { label: "View", to: `/clients/${encodeURIComponent(first.client.id)}` },
    });
  }

  if (canSeeStock) {
    const low = inventory
      .filter((item) => item.status !== "DISABLED" && item.reorderLevel !== null && item.reorderLevel !== undefined && item.reorderLevel !== "" && Number(item.quantity) <= Number(item.reorderLevel))
      .sort((a, b) => Number(a.quantity) / (Number(a.reorderLevel) || 1) - Number(b.quantity) / (Number(b.reorderLevel) || 1));
    if (low.length) {
      items.push({
        key: "reorder",
        kind: "reorder",
        tone: "neutral",
        title: low.length === 1 ? "1 item below reorder level" : `${low.length} items below reorder level`,
        detail: listNames(low.map((item) => item.name)),
        action: { label: "Reorder", to: "/inventory" },
      });
    }
  }

  const unsigned = unsignedReports(appointments, now);
  if (unsigned.length) {
    items.push({
      key: "unsigned",
      kind: "signature",
      tone: "neutral",
      title: unsigned.length === 1 ? "1 report missing a customer signature" : `${unsigned.length} reports missing a customer signature`,
      detail: listNames([...new Set(unsigned.map((entry) => clientName(entry.clientId)))]),
      action: { label: "Open", to: `/scheduling?appointment=${encodeURIComponent(unsigned[0].id)}&tab=Report` },
    });
  }

  return items;
}
