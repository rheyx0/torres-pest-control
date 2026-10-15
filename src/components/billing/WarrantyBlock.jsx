// The warranty of a quotation or contract as one clear block (Sprint 5):
// how long, when it runs, the checkups, and the buttons to book under it.

import { ShieldCheck } from "lucide-react";
import WarrantyActions from "./WarrantyActions";
import WarrantyVisitList from "./WarrantyVisitList";
import { colors } from "../../styles/theme";
import { formatDate } from "../../utils/formatters";
import { checkupLabel } from "../../utils/categories";
import { plannedCheckupCount, warrantyLabel, warrantyState, warrantyVisits } from "../../utils/warranty";

function WarrantyBlock({ warranty, appointments = [], technicians = [], onBook, now = new Date() }) {
  if (!warranty) return null;
  const state = warrantyState(warranty, now);
  const visits = warrantyVisits(warranty, appointments, now);
  const when = state === "NOT_STARTED"
    ? (warranty.type === "CONTRACT" ? "Starts when the contract is signed." : "Starts when the job is completed.")
    : state === "ENDED" ? `Ended ${formatDate(warranty.end)}.` : `Runs ${formatDate(warranty.start)} – ${formatDate(warranty.end)}.`;
  return (
    <section aria-label="Warranty" style={{ display: "grid", gap: "0.5rem", padding: "0.75rem 0.9rem", borderRadius: "3.75px", border: `1px solid ${colors.line}`, background: colors.canvas }}>
      <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: colors.ink }}>
        <ShieldCheck size={16} aria-hidden="true" style={{ color: colors.muted }} /> Warranty: {warrantyLabel(warranty.months)}{state === "ACTIVE" ? ` · under warranty until ${formatDate(warranty.end)}` : ""}
      </strong>
      <span style={{ color: colors.body, fontSize: "0.85rem" }}>
        {when} Free re-treatment if pests come back.{warranty.frequency ? ` ${checkupLabel(warranty.frequency)} checkups · ${visits.done} of ${plannedCheckupCount(warranty)} done.` : ""}
        {visits.retreatments.length ? ` ${visits.retreatments.length} re-treatment${visits.retreatments.length === 1 ? "" : "s"}.` : ""}
      </span>
      <WarrantyActions warranty={warranty} appointments={appointments} technicians={technicians} onBook={onBook} now={now} />
      <WarrantyVisitList warranty={warranty} appointments={appointments} now={now} />
    </section>
  );
}

export default WarrantyBlock;
