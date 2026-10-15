// The warranty and its checkups on the quotation and contract forms
// (Sprint 5, migration 078). A quotation's warranty starts when the job is
// completed, a contract's when it is signed; the hint says which.

import { useState } from "react";
import { Field, Input, Select } from "../ui";
import { ShieldCheck } from "lucide-react";
import { WARRANTY_MONTH_OPTIONS, plannedCheckupCount, warrantyLabel } from "../../utils/warranty";
import { colors } from "../../styles/theme";
import { CHECKUP_FREQUENCIES } from "../../utils/categories";

function WarrantyFields({ months, frequency, onChange, startsWhen = "when the job is completed", clientFrequency = "" }) {
  const preset = months === "" || months === null || months === undefined || WARRANTY_MONTH_OPTIONS.includes(Number(months));
  const [custom, setCustom] = useState(!preset);
  const choose = (value) => {
    if (value === "CUSTOM") {
      setCustom(true);
      onChange({ warrantyMonths: months || "" });
      return;
    }
    setCustom(false);
    onChange({
      warrantyMonths: value,
      // Checkups start from the client's usual frequency.
      ...(value && !frequency && clientFrequency ? { checkupFrequency: clientFrequency } : {}),
      ...(!value ? { checkupFrequency: "" } : {}),
    });
  };
  const checkups = plannedCheckupCount({ months: Number(months) || 0, frequency });
  const summary = !months
    ? "No warranty. Choose one for free re-treatment if pests come back while it runs."
    : `Starts ${startsWhen} · free re-treatment if pests come back${frequency ? ` · ${checkups} free checkup${checkups === 1 ? "" : "s"}` : " · no checkups"}.`;
  return (
    <section aria-label="Warranty and checkups" style={{ display: "grid", gap: "0.6rem", padding: "0.9rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px", background: colors.canvas }}>
      <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: colors.ink, fontSize: "0.9rem" }}>
        <ShieldCheck size={15} aria-hidden="true" style={{ color: colors.muted }} /> Warranty
      </strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", alignItems: "start" }}>
      <Field label="Warranty">
        <div style={{ display: "grid", gridTemplateColumns: custom ? "1fr 90px" : "1fr", gap: "0.5rem" }}>
          <Select aria-label="Warranty" value={custom ? "CUSTOM" : String(months || "")} onChange={(event) => choose(event.target.value)}>
            <option value="">No warranty</option>
            {WARRANTY_MONTH_OPTIONS.map((option) => <option key={option} value={String(option)}>{warrantyLabel(option)}</option>)}
            <option value="CUSTOM">Custom (months)</option>
          </Select>
          {custom && (
            <Input aria-label="Warranty months" type="number" min="1" max="120" step="1" value={months || ""} onChange={(event) => onChange({ warrantyMonths: event.target.value })} placeholder="Months" />
          )}
        </div>
      </Field>
      <Field label="Checkups">
        <Select aria-label="Checkups" value={frequency || ""} disabled={!months} onChange={(event) => onChange({ checkupFrequency: event.target.value })}>
          <option value="">None</option>
          {CHECKUP_FREQUENCIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </Select>
      </Field>
      </div>
      <span style={{ color: colors.muted, fontSize: "0.8rem" }}>{summary}</span>
    </section>
  );
}

/** The warranty's problem, or null. */
export function validateWarranty(months) {
  if (months === "" || months === null || months === undefined) return null;
  const value = Number(months);
  if (!Number.isInteger(value) || value < 1 || value > 120) return "A warranty is between 1 and 120 months.";
  return null;
}

export default WarrantyFields;
