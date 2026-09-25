// The dates of a recurring plan or a multi-day job, in the New appointment
// form (migration 052).
//
// The form works the dates out (utils/plans.js) and owns every edit; this only
// draws them. Each row is ✓ or ⚠ with the reason, and a flagged row offers the
// next free time that day. When every date clashes, one fix for the whole
// series is offered first — a new time of day, or a technician free on every
// date — because that is almost always a standing job in the way, not six
// separate problems.

import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { neutral, radius, status, surface, text, weight } from "../../styles/tokens";
import { PLAN_KINDS } from "../../utils/plans";
import Button from "../ui/Button";
import Input from "../ui/Input";

const dateLabel = (value) => new Date(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const timeLabel = (value) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const endOf = (visit) => new Date(new Date(visit.scheduledAt).getTime() + visit.durationMinutes * 60000);
const clockOf = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

function PlanDates({ kind, visits, commonTime = null, freeAccount = null, suggestionFor, onChange, onRemove, onMoveAll, onUseAccount }) {
  const [editing, setEditing] = useState(null);
  const flagged = visits.filter((visit) => visit.problem);
  const allFlagged = visits.length > 0 && flagged.length === visits.length;
  const multiDay = kind === PLAN_KINDS.MULTI_DAY;

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {allFlagged && (commonTime || freeAccount) && (
        <div role="status" style={{ padding: "10px 12px", borderRadius: radius.control, background: status.warningSurface, color: status.warning, ...text.small }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: weight.medium }}>
            <AlertTriangle size={14} aria-hidden="true" /> Every date has a problem. One change fixes them all:
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
            {commonTime && <Button size="sm" onClick={() => onMoveAll(commonTime)}>Move all to {clockOf(commonTime)}</Button>}
            {freeAccount && <Button size="sm" onClick={() => onUseAccount(freeAccount)}>Use {(freeAccount.name || freeAccount.username).split(" ")[0]} instead</Button>}
          </div>
        </div>
      )}

      <ol aria-label={multiDay ? "Days of the job" : "Visits in the plan"} style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${surface.sunken}`, borderRadius: radius.control }}>
        {visits.map((visit, index) => {
          const suggestion = visit.problem ? suggestionFor(visit) : null;
          return (
            <li
              key={visit.key}
              data-problem={visit.problem || undefined}
              style={{ display: "grid", gap: "6px", padding: "8px 10px", borderTop: index ? `1px solid ${surface.sunken}` : "none", background: visit.problem ? "#fffaf2" : "transparent" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", ...text.small }}>
                <span style={{ minWidth: "58px", color: neutral.bark, fontVariantNumeric: "tabular-nums" }}>
                  {multiDay ? `Day ${index + 1}` : `${index + 1}.`}
                </span>
                <span style={{ color: neutral.ink, fontWeight: weight.medium }}>{dateLabel(visit.scheduledAt)}</span>
                <span style={{ color: neutral.saddle }}>
                  {timeLabel(visit.scheduledAt)} – {timeLabel(endOf(visit))}
                </span>
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "5px", color: visit.problem ? status.warning : status.success }}>
                  {visit.problem ? <AlertTriangle size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                  {visit.problem ? visit.message : "OK"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {suggestion && (
                  <Button size="sm" onClick={() => onChange(visit.key, suggestion)}>
                    Next free: {timeLabel(suggestion)}
                  </Button>
                )}
                <Button size="sm" variant="quiet" onClick={() => setEditing(editing === visit.key ? null : visit.key)} aria-expanded={editing === visit.key}>
                  Change
                </Button>
                {/* A multi-day job's days are its hours: removing one would
                    silently drop work, so only a recurring visit can go. */}
                {!multiDay && visits.length > 2 && (
                  <Button size="sm" variant="quiet" onClick={() => onRemove(visit.key)} aria-label={`Remove visit ${index + 1}`}>
                    <X size={13} aria-hidden="true" /> Remove
                  </Button>
                )}
                {editing === visit.key && (
                  <Input
                    type="datetime-local"
                    aria-label={`Date and time for ${multiDay ? `day ${index + 1}` : `visit ${index + 1}`}`}
                    value={visit.scheduledAt}
                    onChange={(event) => event.target.value && onChange(visit.key, event.target.value)}
                    style={{ width: "auto" }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p style={{ margin: 0, color: flagged.length ? status.warning : neutral.bark, ...text.caption }}>
        {flagged.length
          ? `${flagged.length} of ${visits.length} ${multiDay ? "days" : "dates"} need a fix before booking.`
          : `All ${visits.length} ${multiDay ? "days" : "dates"} are free.`}
      </p>
    </div>
  );
}

export default PlanDates;
