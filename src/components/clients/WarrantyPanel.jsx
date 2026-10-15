// The client's warranties on their profile (Sprint 5, migration 078): what
// each covers and until when, its checkups, and the two ways to book under
// it: Book checkups, and Warranty re-treatment when pests come back.

import { ShieldCheck } from "lucide-react";
import StatusPill from "../ui/StatusPill";
import WarrantyActions from "../billing/WarrantyActions";
import { colors } from "../../styles/theme";
import { formatDate } from "../../utils/formatters";
import { checkupLabel } from "../../utils/categories";
import { clientWarranties, plannedCheckupCount, warrantyLabel, warrantyState, warrantyVisits } from "../../utils/warranty";
import { appointmentReference } from "../../utils/scheduling";

const STATE_WORDS = { ACTIVE: "Under warranty", NOT_STARTED: "Not started", ENDED: "Ended" };
const STATE_TONES = { ACTIVE: "success", NOT_STARTED: "neutral", ENDED: "neutral" };

function WarrantyPanel({ clientId, quotes = [], contracts = [], appointments = [], technicians = [], canBook = false, onBook, onBooked, now = new Date() }) {
  const warranties = clientWarranties(clientId, { quotes, contracts, appointments });
  if (!warranties.length) return null;

  return (
    <section aria-label="Warranty" style={{ padding: "12px 18px", borderBottom: `1px solid ${colors.line}`, display: "grid", gap: "10px" }}>
      <span style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: colors.muted, fontWeight: 500 }}>Warranty</span>
      {warranties.map((warranty) => {
        const state = warrantyState(warranty, now);
        const visits = warrantyVisits(warranty, appointments, now);
        const planned = plannedCheckupCount(warranty);
        return (
          <div key={`${warranty.type}-${warranty.id}`} style={{ display: "grid", gap: "6px", padding: "10px 12px", border: `1px solid ${colors.line}`, borderRadius: "7.5px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <ShieldCheck size={15} aria-hidden="true" style={{ color: state === "ACTIVE" ? "#2f6b3f" : colors.muted }} />
              <strong style={{ fontWeight: 500, color: colors.ink, fontSize: "13.5px" }}>
                {state === "ACTIVE" ? `Under warranty until ${formatDate(warranty.end)}` : state === "ENDED" ? `Warranty ended ${formatDate(warranty.end)}` : `${warrantyLabel(warranty.months)} warranty, not started yet`}
              </strong>
              <StatusPill tone={STATE_TONES[state]} status={STATE_WORDS[state]} />
              <span style={{ color: colors.muted, fontSize: "12.5px" }}>{warranty.type === "CONTRACT" ? "Contract" : "Quotation"} {warranty.reference}</span>
            </div>
            <span style={{ color: colors.body, fontSize: "12.5px" }}>
              {state === "NOT_STARTED"
                ? (warranty.type === "CONTRACT" ? "Starts when the contract is signed." : "Starts when the job is completed.")
                : `${warrantyLabel(warranty.months)} from ${formatDate(warranty.start)}`}
              {warranty.frequency ? ` · ${checkupLabel(warranty.frequency)} checkups · ${visits.done} of ${planned} done` : " · No checkups"}
              {visits.next ? ` · Next: ${formatDate(visits.next.scheduledAt)} (${appointmentReference(visits.next)})` : ""}
              {visits.retreatments.length ? ` · ${visits.retreatments.length} re-treatment${visits.retreatments.length === 1 ? "" : "s"}` : ""}
            </span>
            {canBook && state === "ACTIVE" && (
              <WarrantyActions warranty={warranty} appointments={appointments} technicians={technicians} onBook={onBook} onBooked={onBooked} now={now} />
            )}
          </div>
        );
      })}
    </section>
  );
}

export default WarrantyPanel;
