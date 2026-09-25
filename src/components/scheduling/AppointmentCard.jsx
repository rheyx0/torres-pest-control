// One appointment, as drawn in the week grid, the month grid, or the
// overflow dialog.
//
// The card adapts to its own pixel height. A 15-minute visit and a
// three-hour visit are the same component but cannot show the same things,
// and the previous version handled that with three booleans read inline,
// each tier redefining its own font sizes. contentTier names the three
// cases so this has one switch instead of four conditionals.
//
// Truncation was the loudest complaint about the old grid — client names
// rendered as "Clizfel Tes...". Two things fix it: the window narrowing in
// calendarGeometry makes a one-hour visit 88px tall instead of 56px, and at
// that height the name gets two clamped lines instead of one ellipsised one.
// A 95px-wide column will never fit every name, so the native title
// attribute still carries the full detail on hover.
//
// `columns` matters as much as height. A card sharing its slot with two
// others is a third of a column wide, and a wrapped name there overflows the
// box no matter how tall it is — so the tier is capped by width too.

import { RotateCcw } from "lucide-react";
import { neutral, radius, weight } from "../../styles/tokens";
import { formatDuration } from "../../utils/calendarDates";
import { crewOf, endOf } from "../../utils/scheduling";
import { AvatarStack } from "../ui/Avatar";
import { contentTier, statusVisual } from "./appointmentTheme";
import { useCalendar } from "./CalendarContext";

const clockLabel = (value) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The two-line clamp that stops a long client name being ellipsised away. */
const clampLines = (lines) => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-word",
});

function AppointmentCard({ appointment, height = null, columns = 1, placement = null, dense = false }) {
  const {
    clients,
    accounts,
    selectedId,
    draggedId,
    canReschedule,
    onSelect,
    onDragStart,
    onDragEnd,
    planLabelFor = () => "",
  } = useCalendar();

  const client = clients.find((entry) => entry.id === appointment.clientId);
  if (!client) return null;
  // "3/6" for a recurring plan, "Day 1/2" for a multi-day job (migration 052).
  const plan = planLabelFor(appointment);
  const planTag = plan ? (
    <span style={{ flex: "none", fontSize: "9.5px", lineHeight: "14px", padding: "0 4px", borderRadius: "3px", background: "rgba(33, 27, 21, 0.08)", color: neutral.saddle, fontVariantNumeric: "tabular-nums" }}>
      {plan}
    </span>
  ) : null;

  const isSelected = appointment.id === selectedId;
  const visual = statusVisual(appointment.status);
  // A job can carry a crew (migration 041), lead first. Initials tell them
  // apart; the title attribute carries the full names.
  const crew = crewOf(appointment).map((id) => accounts.find((account) => account.id === id) || null);
  const crewNames = crew.filter(Boolean).map((account) => account.name || account.username);
  const technicianName = crewNames.length === 0 ? "Unassigned" : crewNames.join(", ");

  // A month cell or a dialog row has no measured height; treat it as the
  // middle tier, which is what those layouts have room for.
  const tier = height === null ? (dense ? "compact" : "medium") : contentTier(height, columns);
  const startLabel = clockLabel(appointment.scheduledAt);
  const endLabel = clockLabel(endOf(appointment));
  const textColor = visual.muted ? neutral.bark : neutral.ink;
  const detailColor = visual.muted ? neutral.bark : neutral.saddle;
  const needsSlot = appointment.status === "Reschedule";

  const nameStyle = {
    fontWeight: weight.medium,
    fontSize: tier === "compact" ? "11px" : "12px",
    lineHeight: 1.25,
    color: textColor,
    textDecoration: visual.strike ? "line-through" : "none",
  };
  const detailStyle = { fontSize: "10.5px", lineHeight: 1.3, color: detailColor };

  return (
    <button
      type="button"
      draggable={canReschedule && !["Cancelled", "Completed", "In progress"].includes(appointment.status)}
      onDragStart={() => canReschedule && onDragStart(appointment)}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(appointment)}
      aria-current={isSelected ? "true" : undefined}
      data-status={appointment.status}
      title={`${client.name}${plan ? ` (${plan})` : ""}
${startLabel} – ${endLabel} · ${formatDuration(appointment.durationMinutes || 60)}
${technicianName} · ${appointment.status}${appointment.pestConcern ? ` · ${appointment.pestConcern}` : ""}`}
      style={{
        width: "100%",
        textAlign: "left",
        cursor: canReschedule ? "grab" : "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        borderWidth: "1px",
        borderStyle: visual.borderStyle,
        borderColor: isSelected ? neutral.ink : "#e6dfd3",
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: visual.edge,
        borderRadius: radius.control,
        padding: tier === "compact" ? "2px 6px" : "4px 7px",
        background: visual.fill,
        outline: isSelected ? `2px solid ${neutral.ink}` : "none",
        outlineOffset: "1px",
        position: "relative",
        zIndex: isSelected ? 3 : 1,
        opacity: draggedId === appointment.id ? 0.45 : 1,
        overflow: "hidden",
        color: textColor,
        ...placement,
      }}
    >
      {tier === "compact" && (
        <span style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", overflow: "hidden" }}>
          <span style={{ ...nameStyle, overflow: "hidden", textOverflow: "ellipsis" }}>{client.name}</span>
          <span style={{ ...detailStyle, flex: "none", marginLeft: "auto" }}>{startLabel}</span>
        </span>
      )}

      {tier === "medium" && (
        <>
          <span style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
            <span style={{ ...nameStyle, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {client.name}
            </span>
            {planTag}
          </span>
          <span style={{ ...detailStyle, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {startLabel} – {endLabel}
          </span>
        </>
      )}

      {tier === "full" && (
        <>
          <span style={{ display: "flex", alignItems: "flex-start", gap: "4px" }}>
            <span style={{ ...nameStyle, ...clampLines(2), flex: 1 }}>{client.name}</span>
            {planTag}
            {needsSlot && <RotateCcw size={11} strokeWidth={2} color={visual.edge} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />}
          </span>
          <span style={{ ...detailStyle, ...clampLines(1) }}>
            {startLabel} – {endLabel}
            {appointment.pestConcern ? ` · ${appointment.pestConcern}` : ""}
          </span>
          {crew.length > 0 && (
            <span style={{ marginTop: "3px" }}>
              <AvatarStack users={crew} size="xs" max={3} />
            </span>
          )}
        </>
      )}
    </button>
  );
}

export default AppointmentCard;
