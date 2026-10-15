// Every visit booked under one warranty, in one list (Sprint 5): each
// checkup period with its checkup or "Not booked", then the re-treatments.
// A row opens that visit on the Schedule, where it can be edited or
// cancelled. Shown in the warranty's box on the quotation, the contract, the
// client profile and the job on the Schedule.

import { useNavigate } from "react-router-dom";
import { colors } from "../../styles/theme";
import { appointmentReference } from "../../utils/scheduling";
import { warrantySchedule } from "../../utils/warranty";

const day = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const when = (value) => new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

function WarrantyVisitList({ warranty, appointments = [], now = new Date(), onOpen }) {
  const navigate = useNavigate();
  if (!warranty?.start) return null;
  const { periods, extras, retreatments } = warrantySchedule(warranty, appointments, now);
  if (!periods.length && !extras.length && !retreatments.length) return null;
  const open = (visit) => (onOpen ? onOpen(visit.id) : navigate(`/scheduling?appointment=${visit.id}`));
  const booked = periods.filter((entry) => entry.visit).length;

  const cell = { padding: "0.35rem 0.5rem", borderTop: `1px solid ${colors.line}`, textAlign: "left", verticalAlign: "top" };
  const head = { ...cell, borderTop: 0, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.muted, fontWeight: 500 };
  const link = (visit) => (
    <button type="button" onClick={() => open(visit)} title="Open this visit" style={{ border: 0, background: "none", padding: 0, font: "inherit", color: colors.ink, textDecoration: "underline", cursor: "pointer" }}>
      {appointmentReference(visit)}
    </button>
  );

  return (
    <details style={{ fontSize: "0.82rem", color: colors.body }}>
      <summary style={{ cursor: "pointer", color: colors.ink, fontWeight: 500 }}>
        Visits under this warranty
        {periods.length ? ` · ${booked} of ${periods.length} checkups booked` : ""}
        {retreatments.length ? ` · ${retreatments.length} re-treatment${retreatments.length === 1 ? "" : "s"}` : ""}
      </summary>
      <div style={{ overflowX: "auto", marginTop: "0.4rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr><th style={head}>Visit</th><th style={head}>Period</th><th style={head}>Date</th><th style={head}>Status</th></tr>
          </thead>
          <tbody>
            {periods.map(({ period, visit }) => (
              <tr key={`p-${period.index}`}>
                <td style={cell}>{visit ? link(visit) : `Checkup ${period.index + 1}`}</td>
                <td style={cell}>{day(period.from)} – {day(period.to)}</td>
                <td style={cell}>{visit ? when(visit.scheduledAt) : "—"}</td>
                <td style={{ ...cell, color: visit ? colors.ink : colors.muted }}>{visit ? visit.status : "Not booked"}</td>
              </tr>
            ))}
            {extras.map((visit) => (
              <tr key={visit.id}>
                <td style={cell}>{link(visit)}</td>
                <td style={{ ...cell, color: colors.muted }}>Extra checkup</td>
                <td style={cell}>{when(visit.scheduledAt)}</td>
                <td style={cell}>{visit.status}</td>
              </tr>
            ))}
            {retreatments.map((visit) => (
              <tr key={visit.id}>
                <td style={cell}>{link(visit)}</td>
                <td style={cell}>Re-treatment</td>
                <td style={cell}>{when(visit.scheduledAt)}</td>
                <td style={cell}>{visit.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default WarrantyVisitList;
