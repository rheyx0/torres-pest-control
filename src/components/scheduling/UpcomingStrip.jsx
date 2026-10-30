// What the Schedule badge counts, spelled out at the top of the Schedule:
// the upcoming open visits by status (each opens the list filtered to it)
// and by kind (warranty checkups, free re-treatments, follow-ups, service
// visits), and how many still have no technician.

import StatusPill from "../ui/StatusPill";
import { colors } from "../../styles/theme";
import { neutral, radius, surface } from "../../styles/tokens";

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  border: `1px solid ${colors.line}`,
  borderRadius: radius.control || "3.75px",
  background: surface.panel,
  padding: "3px 9px",
  font: "inherit",
  fontSize: "12.5px",
  color: neutral.ink,
};

function UpcomingStrip({ breakdown, onStatus, onUnassigned }) {
  if (!breakdown.total) return null;
  return (
    <section
      aria-label="Upcoming appointments"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "10px 14px", border: `1px solid ${colors.line}`, borderRadius: "7.5px", background: surface.panel }}
    >
      <strong style={{ fontWeight: 500, color: neutral.ink, marginRight: "4px" }}>
        {breakdown.total} upcoming appointment{breakdown.total === 1 ? "" : "s"}
      </strong>
      {breakdown.statuses.map((entry) => (
        <button key={entry.status} type="button" className="ui-interactive" onClick={() => onStatus(entry.status)} title={`List the upcoming ${entry.status} visits`} style={{ ...chip, cursor: "pointer" }}>
          <StatusPill status={entry.status} /> {entry.count}
        </button>
      ))}
      <span aria-hidden="true" style={{ color: colors.line }}>|</span>
      {breakdown.kinds.map((entry) => (
        <span key={entry.key} style={{ ...chip, color: neutral.saddle }}>
          {entry.label} <strong style={{ fontWeight: 500, color: neutral.ink }}>{entry.count}</strong>
        </span>
      ))}
      {breakdown.unassigned > 0 && (
        <button type="button" className="ui-interactive" onClick={onUnassigned} style={{ ...chip, cursor: "pointer", color: colors.danger }}>
          No technician <strong style={{ fontWeight: 500 }}>{breakdown.unassigned}</strong>
        </button>
      )}
    </section>
  );
}

export default UpcomingStrip;
