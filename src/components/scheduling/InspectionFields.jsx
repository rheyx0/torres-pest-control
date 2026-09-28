// Inspection results on the appointment Report tab (Sprint 4, migration 066):
// the area the technician measured and the services they recommend. Shown on
// an inspection visit, or on any visit that already has results. Saved with
// the report (the form's own fields, read by handleReportSubmit).
//
// "Create quote from inspection" opens a new quote for the client with the
// area and the recommended services filled in (office only, with billing).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { colors, inputStyle } from "../../styles/theme";
import Button from "../ui/Button";
import useAuth from "../../hooks/useAuth";
import { useOptionalBilling } from "../../hooks/useBilling";
import { SUBSYSTEMS } from "../../utils/permissions";
import { isInspectionVisit } from "../../utils/sprint4";

function InspectionFields({ appointment, visitServices = [], services = [] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const billing = useOptionalBilling();
  const [area, setArea] = useState(appointment.inspectionAreaSqm ?? "");
  const [recommended, setRecommended] = useState(appointment.recommendedServiceIds || []);

  if (!isInspectionVisit(appointment, visitServices)) return null;

  const choices = services.filter((service) => service.isActive || recommended.includes(service.id));
  const toggle = (id) => setRecommended((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  const canQuote = Boolean(billing?.office && billing.available && can(SUBSYSTEMS.BILLING, "create"));
  const saved = appointment.inspectionAreaSqm || (appointment.recommendedServiceIds || []).length;

  return (
    <fieldset style={{ margin: 0, padding: "0.8rem 0.9rem", border: `1px solid ${colors.line}`, borderRadius: "0.75rem", display: "grid", gap: "0.7rem" }}>
      <legend style={{ padding: "0 0.3rem", fontSize: "0.85rem", fontWeight: 500, color: colors.ink }}>Inspection results</legend>
      <input type="hidden" name="hasInspection" value="1" />
      <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 500, fontSize: "0.82rem" }}>
        Area inspected (sqm)
        <input
          name="inspectionArea"
          type="number"
          min="0"
          step="any"
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="e.g. 200"
          style={{ ...inputStyle, width: "100%" }}
        />
      </label>
      <div role="group" aria-label="Recommended services" style={{ display: "grid", gap: "0.3rem" }}>
        <span style={{ color: colors.body, fontWeight: 500, fontSize: "0.82rem" }}>Recommended treatment</span>
        {choices.map((service) => (
          <label key={service.id} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.85rem", color: colors.ink }}>
            <input type="checkbox" name="recommendedServiceIds" value={service.id} checked={recommended.includes(service.id)} onChange={() => toggle(service.id)} />
            {service.name}
          </label>
        ))}
      </div>
      {canQuote && (
        <div>
          <Button
            size="sm"
            icon={<FileText size={14} />}
            disabled={!saved}
            title={saved ? undefined : "Save the report with the area or a recommended service first."}
            onClick={() => navigate(`/billing?new=1&client=${encodeURIComponent(appointment.clientId)}&inspection=${encodeURIComponent(appointment.id)}`)}
          >
            Create quote from inspection
          </Button>
          {!saved && (
            <span style={{ marginLeft: "0.6rem", color: colors.muted, fontSize: "0.8rem" }}>
              Save the report with the area or a recommended service first.
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
}

export default InspectionFields;
