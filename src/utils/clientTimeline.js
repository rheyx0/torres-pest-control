// A client's history, as data for the client profile page.
//
// Pure functions over the appointments and documents already in context:
//
//   clientVisits   every visit for the client, newest first
//   nextVisit      the next live visit still to happen
//   lifetimeValue  agreed prices of visits that happened, and how many
//   currentPlan    the frequency of the most recent visit that has one
//   timelineEvents reports filed, visits missed or due, documents added, the
//                  client's billing (passed in) and their creation, newest first
//   activityTrend  the pest activity found visit by visit (migration 063)

import { endOf, startOf } from "./scheduling";
import { hasPlausiblePrice } from "./dashboardMetrics";
import { ACTIVITY_LEVELS } from "./constants";

const live = (entry) => entry.status !== "Cancelled";
const done = (entry) => entry.status === "Completed" || entry.reportSubmitted;

export function clientVisits(appointments, clientId) {
  return appointments.filter((entry) => entry.clientId === clientId).sort((a, b) => startOf(b) - startOf(a));
}

export function nextVisit(visits, now = new Date()) {
  return (
    visits
      .filter((entry) => live(entry) && !done(entry) && endOf(entry) >= now.getTime())
      .sort((a, b) => startOf(a) - startOf(b))[0] || null
  );
}

/** What the client has been charged for visits that took place. Cost is not revenue collected. */
export function lifetimeValue(visits) {
  const finished = visits.filter(done);
  return {
    // A price the system could not accept today is left out (migration 058).
    total: finished.filter(hasPlausiblePrice).reduce((sum, entry) => sum + Number(entry.price), 0),
    visits: finished.length,
  };
}

export function currentPlan(visits) {
  const latest = [...visits].sort((a, b) => startOf(b) - startOf(a)).find((entry) => live(entry) && entry.serviceFrequency);
  return latest?.serviceFrequency || "";
}

/**
 * One entry per thing that happened, newest first:
 *   { key, kind: "report" | "missed" | "cancelled" | "document" | "created", at, appointment?, document? }
 * A visit that ended with no report is "missed" (a report is due); visits
 * still ahead are not history and are left to the Next visit banner.
 */
export function timelineEvents(client, visits, now = new Date(), extra = []) {
  const events = [];
  visits.forEach((entry) => {
    if (entry.status === "Cancelled") {
      events.push({ key: `cancelled-${entry.id}`, kind: "cancelled", at: entry.scheduledAt, appointment: entry });
    } else if (entry.reportSubmitted) {
      // Placed on the visit's date: the report describes that visit, whenever it was typed up.
      events.push({ key: `report-${entry.id}`, kind: "report", at: entry.scheduledAt, appointment: entry });
    } else if (endOf(entry) < now.getTime()) {
      events.push({ key: `missed-${entry.id}`, kind: "missed", at: entry.scheduledAt, appointment: entry });
    }
  });
  (client.documents || []).forEach((document) => {
    if (document.uploadedAt) events.push({ key: `document-${document.id}`, kind: "document", at: document.uploadedAt, document });
  });
  if (client.createdAt) events.push({ key: "created", kind: "created", at: client.createdAt });
  // Billing records (Sprint 3) and anything else a caller adds, on the same line.
  events.push(...extra);
  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}

/** A Google Maps search for an address, for the Directions link. */
export function directionsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** A dialable tel: link from a Philippine number as typed ("0917 800 1000"). */
export function telUrl(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

/**
 * Last and next visit per client, for the Clients table — one pass over the
 * appointments rather than a filter per row.
 */
export function visitDatesByClient(appointments, now = new Date()) {
  const nowMs = now.getTime();
  const dates = new Map();
  appointments.forEach((entry) => {
    if (!live(entry)) return;
    const current = dates.get(entry.clientId) || { last: null, next: null };
    const start = startOf(entry);
    if (done(entry) || endOf(entry) < nowMs) {
      if (!current.last || start > current.last) current.last = start;
    } else if (!current.next || start < current.next) {
      current.next = start;
    }
    dates.set(entry.clientId, current);
  });
  return dates;
}

/**
 * Site monitoring (migration 063): the pest activity each visit found, oldest
 * first, the last `limit` of them, and whether the latest is better or worse
 * than the one before. `openIssues` is what the most recent visit that
 * recorded any left open.
 *   { points: [{ id, at, level, label, score }], direction: none | better | worse | steady, openIssues, issuesFrom }
 */
export function activityTrend(visits, limit = 12) {
  const byLevel = new Map(ACTIVITY_LEVELS.map((level) => [level.value, level]));
  const recorded = visits
    .filter((entry) => live(entry) && byLevel.has(entry.activityLevel))
    .sort((a, b) => startOf(a) - startOf(b));
  const points = recorded.slice(-limit).map((entry) => ({
    id: entry.id,
    at: entry.scheduledAt,
    level: entry.activityLevel,
    label: byLevel.get(entry.activityLevel).label,
    score: byLevel.get(entry.activityLevel).score,
  }));
  let direction = "none";
  if (points.length >= 2) {
    const [previous, latest] = points.slice(-2);
    direction = latest.score < previous.score ? "better" : latest.score > previous.score ? "worse" : "steady";
  }
  const withIssues = visits.filter((entry) => live(entry) && entry.openIssues).sort((a, b) => startOf(b) - startOf(a))[0] || null;
  return { points, direction, openIssues: withIssues?.openIssues || "", issuesFrom: withIssues };
}
