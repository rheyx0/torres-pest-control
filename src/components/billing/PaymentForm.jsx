// Record money received (Sprint 3): a down payment on an approved quote now,
// an invoice payment once invoices exist. Each payment gets its own receipt
// number (TPC-R). A check is recorded as Pending and counts only once it is
// marked Cleared.

import { useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea } from "../ui";
import { colors } from "../../styles/theme";
import { LIMITS, PAYMENT_METHODS } from "../../utils/constants";
import { formatPeso } from "../../utils/formatters";
import { todayISO, validateMoney } from "../../utils/validators";

/** Pure validation, exported for tests. Returns an error string or null. */
export function validatePayment(values, { max = Infinity } = {}) {
  const amount = Number(values.amount);
  if (!(amount > 0)) return "Enter the amount received.";
  const moneyError = validateMoney(values.amount, { max: 9999999999, label: "The amount" });
  if (moneyError) return moneyError;
  if (amount > max + 0.001) return `That is more than the ${formatPeso(max)} still due.`;
  if (!values.paidOn) return "Enter the date it was paid.";
  if (values.paidOn > todayISO()) return "A payment cannot be dated in the future.";
  if (!values.method) return "Choose how it was paid.";
  if (values.method === "CHECK") {
    if (!String(values.checkNumber || "").trim()) return "Enter the check number.";
    if (!String(values.checkBank || "").trim()) return "Enter the bank the check is drawn on.";
    if (!values.checkDate) return "Enter the date on the check.";
  }
  return null;
}

function PaymentForm({ title, subtitle, suggested = 0, max = Infinity, onSave, onClose }) {
  const [values, setValues] = useState({
    amount: suggested > 0 ? String(suggested) : "",
    paidOn: todayISO(),
    method: "CASH",
    referenceNo: "",
    checkNumber: "",
    checkBank: "",
    checkDate: todayISO(),
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (event) => {
    setError("");
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const problem = validatePayment(values, { max });
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const result = await onSave({ ...values, amount: Number(values.amount) });
    setSaving(false);
    if (result !== true) setError(typeof result === "string" ? result : "The payment was not recorded.");
  };

  const check = values.method === "CHECK";

  return (
    <Modal
      title={title}
      eyebrow={subtitle}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="payment-form" loading={saving}>Record payment</Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Amount (₱)" required hint={Number.isFinite(max) ? `Still due: ${formatPeso(max)}` : undefined}>
            <Input aria-label="Amount received" type="number" min="0" step="0.01" value={values.amount} onChange={set("amount")} autoFocus />
          </Field>
          <Field label="Date paid" required>
            <Input aria-label="Date paid" type="date" max={todayISO()} value={values.paidOn} onChange={set("paidOn")} />
          </Field>
          <Field label="Method" required>
            <Select aria-label="Payment method" value={values.method} onChange={set("method")}>
              {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </Select>
          </Field>
          {!check && (
            <Field label="Reference no." hint="Transfer or GCash reference, if any.">
              <Input aria-label="Reference number" value={values.referenceNo} maxLength={LIMITS.SHORT_TEXT_MAX} onChange={set("referenceNo")} />
            </Field>
          )}
        </div>

        {check && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", alignItems: "start", padding: "0.8rem", borderRadius: "3.75px", background: colors.canvas, border: `1px solid ${colors.line}` }}>
            <Field label="Check no." required>
              <Input aria-label="Check number" value={values.checkNumber} maxLength={LIMITS.SHORT_TEXT_MAX} onChange={set("checkNumber")} />
            </Field>
            <Field label="Bank" required>
              <Input aria-label="Check bank" value={values.checkBank} maxLength={LIMITS.SHORT_TEXT_MAX} onChange={set("checkBank")} />
            </Field>
            <Field label="Check date" required>
              <Input aria-label="Check date" type="date" value={values.checkDate} onChange={set("checkDate")} />
            </Field>
            <p style={{ margin: 0, gridColumn: "1 / -1", color: colors.muted, fontSize: "0.8rem" }}>
              Recorded as pending: it counts toward the balance only once it is marked Cleared.
            </p>
          </div>
        )}

        <Field label="Notes">
          <Textarea aria-label="Payment notes" rows={2} maxLength={LIMITS.NOTES_MAX} value={values.notes} onChange={set("notes")} />
        </Field>

        {error && <p role="alert" style={{ margin: 0, color: colors.danger, fontWeight: 500 }}>{error}</p>}
      </form>
    </Modal>
  );
}

export default PaymentForm;
