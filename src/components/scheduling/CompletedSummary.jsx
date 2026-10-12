// A completed visit, read only: what was done, by whom, with what, and what
// comes next. Shown in the appointment detail in place of the edit forms once
// a visit is Completed, so nothing is changed by accident. An admin can still
// correct it ("Correct this visit" reopens the forms). A completed inspection
// also shows its results and "Create quote from inspection", so making the
// quote never needs the visit reopened.

import { useNavigate } from "react-router-dom";
import { CheckCircle2, FileText, PencilLine } from "lucide-react";
import Button from "../ui/Button";
import { colors } from "../../styles/theme";
import useAuth from "../../hooks/useAuth";
import { useOptionalBilling } from "../../hooks/useBilling";
import { SUBSYSTEMS } from "../../utils/permissions";
import { isInspectionVisit } from "../../utils/sprint4";
import { ACTIVITY_LEVELS } from "../../utils/constants";
import { crewOf } from "../../utils/scheduling";
import { formatDate, formatDateTime, formatPeso } from "../../utils/formatters";

const duration = (minutes) => {
  const total = Number(minutes) || 60;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return [hours ? `${hours} h` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ");
};

function CompletedSummary({ appointment, accounts = [], onCorrect, visitServices = [], services = [] }) {
  const navigate = useNavigate();
  const { currentUser, can } = useAuth();
  const billing = useOptionalBilling();
  const inspection = isInspectionVisit(appointment, visitServices);
  const recommended = (appointment.recommendedServiceIds || []).map((id) => services.find((service) => service.id === id)?.name).filter(Boolean);
  const hasResults = Boolean(appointment.inspectionAreaSqm || recommended.length);
  const canQuote = inspection && hasResults && Boolean(billing?.office && billing.available && can?.(SUBSYSTEMS.BILLING, "create"));
  const crew = crewOf(appointment).map((id) => accounts.find((account) => account.id === id)?.name).filter(Boolean);
  const activity = ACTIVITY_LEVELS.find((level) => level.value === appointment.activityLevel)?.label;
  const materials = (appointment.stockUsed || []).map((entry) => `${entry.name} ${entry.amount} ${entry.unit || ""}`.trim());
  const finishedAt = appointment.signedAt || appointment.reportSubmittedAt;

  const rows = [
    ["Visit", formatDateTime(appointment.scheduledAt)],
    ["Duration", duration(appointment.durationMinutes)],
    ["Technicians", crew.join(", ") || "—"],
    ["Services", appointment.serviceType || "—"],
    ["Location", appointment.serviceLocation || "—"],
    ["Price", appointment.price === "" || appointment.price === null || appointment.price === undefined ? "—" : formatPeso(appointment.price)],
    ["Findings", appointment.report || "—"],
    ["Recommendations", appointment.recommendations || "—"],
    ...(inspection ? [
      ["Area inspected", appointment.inspectionAreaSqm ? `${appointment.inspectionAreaSqm} sqm` : "Not recorded"],
      ["Recommended treatment", recommended.join(", ") || "None ticked"],
    ] : []),
    ["Pest activity", activity || "Not recorded"],
    ["Open issues", appointment.openIssues || "None"],
    ["Materials used", materials.join(", ") || "None recorded"],
    ["Signed by", appointment.customerName || (appointment.completionNote ? `Office: ${appointment.completionNote}` : "—")],
    ["Follow-up", appointment.followUpDate ? formatDate(appointment.followUpDate) : "None set"],
    ["Billing", appointment.invoiceId ? "Invoiced" : "Not invoiced yet"],
  ];

  return (
    <section aria-label="Completed visit" style={{ display: "grid", gap: "0.85rem", padding: "1rem", border: "1px solid #cfe6d7", borderRadius: "0.75rem", background: "#f3faf5" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", color: "#2f6b3f", fontSize: "0.95rem", fontWeight: 600 }}>
          <CheckCircle2 size={17} aria-hidden="true" /> Completed{finishedAt ? ` · ${formatDateTime(finishedAt)}` : ""}
        </strong>
        <span style={{ display: "inline-flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {canQuote && (
            <Button size="sm" variant="primary" icon={<FileText size={14} />} onClick={() => navigate(`/billing?new=1&client=${encodeURIComponent(appointment.clientId)}&inspection=${encodeURIComponent(appointment.id)}`)}>
              Create quote from inspection
            </Button>
          )}
          {(currentUser?.role === "ADMIN" || currentUser?.role === "STAFF") && onCorrect && (
            <Button size="sm" variant="quiet" icon={<PencilLine size={14} />} onClick={onCorrect}>Correct this visit</Button>
          )}
        </span>
      </div>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.4rem 1.25rem", fontSize: "0.86rem" }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt style={{ color: colors.muted }}>{label}</dt>
            <dd style={{ margin: 0, color: colors.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</dd>
          </div>
        ))}
      </dl>
      {appointment.warrantyKind === "CHECKUP" && ["MEDIUM", "HIGH"].includes(appointment.activityLevel) && (
        <p role="status" style={{ margin: 0, padding: "0.55rem 0.7rem", borderRadius: "0.5rem", background: "#fdf1dc", color: "#8a5a12", fontSize: "0.84rem" }}>
          Pests found on this checkup. Book a warranty re-treatment from the client's Warranty box.{" "}
          <button type="button" onClick={() => navigate(`/clients/${encodeURIComponent(appointment.clientId)}`)} style={{ border: 0, background: "none", padding: 0, color: "#7f1111", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>Open the client</button>
        </p>
      )}
      <p style={{ margin: 0, color: colors.muted, fontSize: "0.78rem" }}>
        A completed visit can't be edited. Print the service form, book a follow-up or bill it from here.
      </p>
    </section>
  );
}

export default CompletedSummary;
