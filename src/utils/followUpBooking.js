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
