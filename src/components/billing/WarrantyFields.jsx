// The warranty and its checkups on the quotation and contract forms
// (Sprint 5, migration 078). A quotation's warranty starts when the job is
// completed, a contract's when it is signed; the hint says which.

import { useState } from "react";
import { Field, Input, Select } from "../ui";
import { WARRANTY_MONTH_OPTIONS, warrantyLabel } from "../../utils/warranty";
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
  return (
    <>
      <Field label="Warranty" hint={months ? `Starts ${startsWhen}.` : "Free re-treatment if pests come back while it runs."}>
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
      <Field label="Checkups" hint="Free, during the warranty.">
        <Select aria-label="Checkups" value={frequency || ""} disabled={!months} onChange={(event) => onChange({ checkupFrequency: event.target.value })}>
          <option value="">None</option>
          {CHECKUP_FREQUENCIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </Select>
      </Field>
    </>
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
