// The column beside the Day and Week grids: what still needs a slot, how
// loaded each technician is this week, and the key to the card styles.
//
// Unscheduled lists two kinds of thing, both draggable onto the grid:
//   - visits in Reschedule — moving one keeps its status and offers Undo,
//     the same as dragging it on the grid;
//   - clients due for re-service with nothing booked, and recurring plans
//     about to run out (migration 052) — dropping one on a slot opens the New
//     appointment form for that client at that time, copied from their last
//     visit. A plan the client is not continuing gets "Don't renew", which
//     silences its reminder (migration 053; undone from the plan's panel).

import { font, neutral, radius, status as semantic, surface, weight } from "../../styles/tokens";
import { colors } from "../../styles/theme";
import Avatar from "../ui/Avatar";
import CalendarLegend from "./CalendarLegend";
import { statusVisual } from "./appointmentTheme";

const cardStyle = { background: surface.panel, border: `1px solid ${colors.line}`, borderRadius: radius.card, padding: "14px 16px" };
const titleStyle = { margin: "0 0 8px", font: `500 15px/1.3 ${font.display}`, color: neutral.ink };

function SlotCard({ status, title, detail, draggable, onDragStart, onDragEnd, onClick }) {
  const visual = statusVisual(status);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        borderWidth: "1px",
        borderStyle: visual.borderStyle,
        borderColor: neutral.loam,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: visual.edge,
        borderRadius: "4px",
        background: status === "Pending" ? "#fffdf8" : visual.fill,
        padding: "5px 8px",
        fontSize: "11.5px",
        lineHeight: 1.35,
        cursor: draggable ? "grab" : "pointer",
        color: neutral.saddle,
      }}
    >
      <b style={{ display: "block", fontWeight: weight.medium, fontSize: "12.5px", color: neutral.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </b>
      {detail}
    </button>
  );
}

/**
 * @param reschedule  appointments in Reschedule
 * @param reservice   rows from bookingReminders(): { client, last, dueAt, frequency, renewal?, remaining? }
 * @param load        [{ technician, hours }] for the visible week
 * @param onDeclineRenewal  optional; shown on renewal rows for the office
 */
function ScheduleSidePanel({
  reschedule,
  reservice,
  load,
  clientName,
  canDrag,
  onDragAppointment,
  onDragReservice,
  onDragEnd,
  onOpenAppointment,
  onBookReservice,
  onDeclineRenewal,
  weeklyHours = 40,
}) {
  const nothingWaiting = reschedule.length === 0 && reservice.length === 0;

  return (
    <aside aria-label="Schedule side panel" className="schedule-side" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <section style={cardStyle} aria-labelledby="unscheduled-title">
        <h3 id="unscheduled-title" style={titleStyle}>
          Unscheduled
        </h3>
        {nothingWaiting ? (
          <p style={{ margin: 0, color: neutral.bark, fontSize: "12.5px" }}>Nothing waiting for a slot.</p>
        ) : (
          <>
            {canDrag && <p style={{ margin: "0 0 6px", color: neutral.bark, fontSize: "12.5px" }}>Drag onto the calendar</p>}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
              {reschedule.map((appointment) => (
                <li key={appointment.id}>
                  <SlotCard
                    status="Reschedule"
                    title={clientName(appointment.clientId)}
                    detail={`Reschedule requested · was ${new Date(appointment.scheduledAt).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                    draggable={canDrag}
                    onDragStart={() => onDragAppointment(appointment)}
                    onDragEnd={onDragEnd}
                    onClick={() => onOpenAppointment(appointment)}
                  />
                </li>
              ))}
              {reservice.map((entry) => (
                <li key={`reservice-${entry.last.id}`}>
                  <SlotCard
                    status="Pending"
                    title={entry.client.name}
                    detail={entry.renewal
                      ? `Renew ${entry.frequency.toLowerCase()} plan · ${entry.remaining === 0 ? "ended" : `${entry.remaining} left`} · from ${entry.dueAt.toLocaleDateString([], { month: "short", day: "numeric" })}`
                      : `Re-service · ${entry.frequency.toLowerCase()} · due ${entry.dueAt.toLocaleDateString([], { month: "short", day: "numeric" })}`}
                    draggable={canDrag}
                    onDragStart={() => onDragReservice(entry)}
                    onDragEnd={onDragEnd}
                    onClick={() => onBookReservice(entry)}
                  />
                  {entry.renewal && onDeclineRenewal && (
                    <button
                      type="button"
                      onClick={() => onDeclineRenewal(entry)}
                      aria-label={`Don't renew ${entry.client.name}'s ${entry.frequency.toLowerCase()} plan`}
                      style={{ border: 0, background: "none", padding: "2px 0 0 11px", fontSize: "11.5px", color: neutral.bark, textDecoration: "underline", cursor: "pointer" }}
                    >
                      Don't renew
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {load.length > 0 && (
        <section style={cardStyle} aria-labelledby="load-title">
          <h3 id="load-title" style={titleStyle}>
            Technician load
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {load.map(({ technician, hours }) => {
              const share = Math.min(1, hours / weeklyHours);
              return (
                <li key={technician.id} style={{ padding: "6px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                    <Avatar user={technician} size="sm" />
                    <span style={{ color: neutral.ink }}>{(technician.name || technician.username).split(" ")[0]}</span>
                    <span style={{ marginLeft: "auto", fontSize: "12.5px", color: neutral.bark, fontVariantNumeric: "tabular-nums" }}>
                      {hours} h / {weeklyHours}
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={`${technician.name || technician.username}: ${hours} of ${weeklyHours} hours booked`}
                    style={{ height: "3px", background: surface.sunken, borderRadius: "2px", marginTop: "5px", overflow: "hidden" }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${share * 100}%`,
                        background: hours > weeklyHours ? semantic.danger : neutral.saddle,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section style={cardStyle} aria-labelledby="legend-title">
        <h3 id="legend-title" style={titleStyle}>
          Legend
        </h3>
        <CalendarLegend vertical note={canDrag ? "Dragging a visit keeps its status and shows Undo." : null} />
      </section>
    </aside>
  );
}

export default ScheduleSidePanel;
