// What the automatic follow-up (migration 073) did, as one toast. Booked is
// good news; not booked is information only, since the follow-up reminder in
// Needs attention still covers it. Nothing to say when the report has no
// follow-up date or the follow-up was already booked.

const QUIET = new Set(["NO_DATE", "ALREADY"]);

export function followUpNotice(followUp) {
  if (!followUp || QUIET.has(followUp.status)) return null;
  if (followUp.status === "BOOKED") return { tone: "success", message: followUp.message || "Follow-up booked." };
  return { tone: "info", message: `Follow-up not booked: ${followUp.message || "check the follow-up reminder."}` };
}

export function announceFollowUp(followUp, showSuccess = () => {}, showInfo = () => {}) {
  const notice = followUpNotice(followUp);
  if (!notice) return;
  (notice.tone === "success" ? showSuccess : showInfo)(notice.message);
}

// A follow-up checks on a visit, so it can't come before it.
const localDay = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const when = (value) => new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The earliest follow-up date a report can set: the visit's own day. */
export const earliestFollowUpDate = (visit) => (visit?.scheduledAt ? localDay(visit.scheduledAt) : "");

/** A report's follow-up date set before its visit, as a message; null when fine. */
export function followUpDateProblem(followUpDate, visit) {
  const earliest = earliestFollowUpDate(visit);
  if (!followUpDate || !earliest || followUpDate >= earliest) return null;
  return `The follow-up date can't be before the visit itself (${new Date(`${earliest}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}).`;
}

/** A follow-up booked to start before the visit it follows has ended; null when fine. */
export function followUpStartProblem(scheduledAt, original) {
  if (!scheduledAt || !original?.scheduledAt) return null;
  const end = new Date(original.scheduledAt).getTime() + (Number(original.durationMinutes) || 60) * 60000;
  if (new Date(scheduledAt).getTime() >= end) return null;
  return `A follow-up must be after ${original.reference || "the visit it follows"} (${when(original.scheduledAt)}).`;
}
