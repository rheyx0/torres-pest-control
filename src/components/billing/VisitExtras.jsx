// Extra work on a visit, beyond what was quoted (Sprint 3, migration 062):
// more termites than expected, another room. The office records it at the
// price agreed; it waits for the client's answer unless they agreed on the
// spot. Only an approved extra goes on the invoice, and only once.
//
// Office only, and only once billing is set up — renders nothing otherwise.

import { useState } from "react";
import { Button, Field, Input, StatusPill } from "../ui";
import { colors } from "../../styles/theme";
import { EXTRA_STATUS_LABELS } from "../../utils/constants";
import { appointmentReference } from "../../utils/scheduling";
import { formatPeso } from "../../utils/formatters";
import { validateMoney } from "../../utils/validators";
import { SUBSYSTEMS } from "../../utils/permissions";
import useAuth from "../../hooks/useAuth";
import { useOptionalBilling } from "../../hooks/useBilling";

const EXTRA_TONES = { PROPOSED: "warning", APPROVED: "success", DECLINED: "neutral" };
const BLANK = { description: "", quantity: "1", unit: "", unitPrice: "", agreed: false };

/** Pure validation, exported for tests. */
export function validateExtra(values) {
  if (!values.description.trim()) return "Describe the extra work.";
  if (!(Number(values.quantity) > 0)) return "Enter a quantity above zero.";
  if (values.unitPrice === "") return "Enter the price agreed with the client.";
  return validateMoney(values.unitPrice, { max: 999999.99, label: "The price" });
}

function ExtraRow({ extra, invoiceReference, onDecide, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (call) => {
    setBusy(true);
    setError("");
    const result = await call();
    setBusy(false);
    if (typeof result === "string") setError(result);
  };
  return (
    <li style={{ display: "grid", gap: "0.3rem", padding: "0.5rem 0", borderTop: `1px solid ${colors.line}` }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.88rem" }}>
        <span style={{ color: colors.ink }}>{extra.description}</span>
        <span style={{ color: colors.muted }}>{extra.quantity} {extra.unit} × {formatPeso(extra.unitPrice)}</span>
        <StatusPill tone={EXTRA_TONES[extra.status]} status={EXTRA_STATUS_LABELS[extra.status]} />
        {invoiceReference && <span style={{ color: colors.muted }}>on {invoiceReference}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: "0.3rem" }}>
          {extra.status === "PROPOSED" && (
            <>
              <Button size="sm" loading={busy} onClick={() => act(() => onDecide(extra, true))}>Client approved</Button>
              <Button size="sm" variant="quiet" onClick={() => act(() => onDecide(extra, false))}>Declined</Button>
            </>
          )}
          {!extra.invoiceId && <Button size="sm" variant="quiet" onClick={() => act(() => onDelete(extra))}>Remove</Button>}
        </span>
      </div>
      {extra.decisionNote && <span style={{ color: colors.muted, fontSize: "0.8rem" }}>{extra.decisionNote}</span>}
      {error && <span role="alert" style={{ color: colors.danger, fontSize: "0.8rem", fontWeight: 500 }}>{error}</span>}
    </li>
  );
}

function VisitExtras({ appointment }) {
  const { can } = useAuth();
  const billing = useOptionalBilling();
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!billing || !billing.invoicesAvailable || !can(SUBSYSTEMS.BILLING, "edit")) return null;
  const extras = billing.extrasForVisit(appointment.id);
  const invoice = billing.invoiceById(appointment.invoiceId);
  const locked = Boolean(invoice) || appointment.status === "Cancelled";
  if (extras.length === 0 && locked) return null;

  const set = (field) => (event) => {
    setError("");
    setValues((current) => ({ ...current, [field]: field === "agreed" ? event.target.checked : event.target.value }));
  };

  const save = async (event) => {
    event.preventDefault();
    const problem = validateExtra(values);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const result = await billing.addVisitExtra(appointment.id, { ...values, status: values.agreed ? "APPROVED" : "PROPOSED" }, appointmentReference(appointment));
    setSaving(false);
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setValues(BLANK);
    setAdding(false);
  };

  return (
    <section aria-label="Extra work on this visit" style={{ display: "grid", gap: "0.4rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: colors.ink, marginRight: "auto" }}>Extra work</h3>
        {invoice && <span style={{ color: colors.muted, fontSize: "0.85rem" }}>Invoiced on {invoice.reference}</span>}
        {!locked && !adding && <Button size="sm" onClick={() => setAdding(true)}>Add extra</Button>}
      </div>
      {extras.length === 0 && !adding && (
        <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>Work beyond the quote, at a price the client agrees to, goes on the invoice.</p>
      )}
      {extras.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {extras.map((extra) => (
            <ExtraRow
              key={extra.id}
              extra={extra}
              invoiceReference={billing.invoiceById(extra.invoiceId)?.reference}
              onDecide={(target, approved) => billing.decideVisitExtra(target, approved)}
              onDelete={(target) => billing.deleteVisitExtra(target)}
            />
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={save} noValidate style={{ display: "grid", gap: "0.6rem", padding: "0.8rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px" }}>
          <Field label="What was done" required>
            <Input aria-label="Extra description" value={values.description} maxLength={300} onChange={set("description")} placeholder="e.g. Treated the storage room too" autoFocus />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.6rem" }}>
            <Field label="Quantity" required>
              <Input aria-label="Extra quantity" type="number" min="0" step="any" value={values.quantity} onChange={set("quantity")} />
            </Field>
            <Field label="Unit">
              <Input aria-label="Extra unit" value={values.unit} maxLength={20} onChange={set("unit")} placeholder="room, sqm" />
            </Field>
            <Field label="Price each (₱)" required>
              <Input aria-label="Extra price" type="number" min="0" step="0.01" value={values.unitPrice} onChange={set("unitPrice")} />
            </Field>
          </div>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.88rem", color: colors.body }}>
            <input type="checkbox" checked={values.agreed} onChange={set("agreed")} />
            The client already agreed to it
          </label>
          {error && <p role="alert" style={{ margin: 0, color: colors.danger, fontWeight: 500 }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
            <Button variant="quiet" onClick={() => { setAdding(false); setValues(BLANK); setError(""); }}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving}>Save extra</Button>
          </div>
        </form>
      )}
    </section>
  );
}

export default VisitExtras;
