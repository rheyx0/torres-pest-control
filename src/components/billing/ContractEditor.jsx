// Create or change a draft service contract (Sprint 3, migration 063): the
// terms a recurring service is sold on. Once it is signed and made active the
// terms are fixed; the server refuses to change them.

import { useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea } from "../ui";
import { colors } from "../../styles/theme";
import { BILLING_SCHEDULES, LIMITS, PAYMENT_TERMS, SERVICE_FREQUENCIES } from "../../utils/constants";
import { MAX_PLAN_VISITS } from "../../utils/plans";
import { formatPeso } from "../../utils/formatters";
import { todayISO, validateMoney } from "../../utils/validators";

const FREQUENCIES = SERVICE_FREQUENCIES.filter((frequency) => frequency !== "One-time");
const DEFAULT_CANCELLATION = "Either party may cancel with 30 days' written notice. Visits already done are billed; visits not yet done are cancelled.";

/** Pure validation, exported for tests. Returns an error string or null. */
export function validateContract(values) {
  if (!values.clientId) return "Choose the client for this contract.";
  if (!values.title.trim()) return "Give the contract a title.";
  if (values.serviceIds.length === 0) return "Choose the services the contract covers.";
  if (!values.frequency) return "Choose how often the visits are.";
  if (!values.startsOn) return "Enter the start date.";
  if (values.lengthBy === "count") {
    const count = Number(values.visitCount);
    if (!Number.isInteger(count) || count < 2 || count > MAX_PLAN_VISITS) return `A contract has between 2 and ${MAX_PLAN_VISITS} visits.`;
  } else if (!values.endsOn) {
    return "Enter the end date.";
  } else if (values.endsOn <= values.startsOn) {
    return "The end date must be after the start date.";
  }
  if (values.pricePerVisit === "") return "Enter the price per visit.";
  return validateMoney(values.pricePerVisit, { max: LIMITS.MAX_PRICE, label: "The price per visit" });
}

function ContractEditor({ contract = null, clients = [], services = [], initialClientId = "", onSave, onClose }) {
  const [values, setValues] = useState(() => ({
    clientId: contract?.clientId || initialClientId || "",
    title: contract?.title || "",
    serviceIds: contract?.serviceIds || [],
    frequency: contract?.frequency || "Quarterly",
    startsOn: contract?.startsOn || todayISO(),
    lengthBy: contract && !contract.visitCount ? "until" : "count",
    visitCount: contract?.visitCount ? String(contract.visitCount) : "4",
    endsOn: contract?.endsOn || "",
    pricePerVisit: contract ? String(contract.pricePerVisit) : "",
    billingSchedule: contract?.billingSchedule || "PER_VISIT",
    paymentTerms: contract?.paymentTerms || "DUE_ON_RECEIPT",
    inclusions: contract?.inclusions || "",
    cancellationTerms: contract ? contract.cancellationTerms : DEFAULT_CANCELLATION,
    notes: contract?.notes || "",
  }));
  const [priceTouched, setPriceTouched] = useState(Boolean(contract));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (event) => {
    setError("");
    if (field === "pricePerVisit") setPriceTouched(true);
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  // Ticking services fills the price with their prices added up, until the
  // office types its own.
  const toggleService = (id) => {
    setError("");
    setValues((current) => {
      const serviceIds = current.serviceIds.includes(id) ? current.serviceIds.filter((entry) => entry !== id) : [...current.serviceIds, id];
      const chosen = serviceIds.map((serviceId) => services.find((service) => service.id === serviceId)).filter(Boolean);
      const title = current.title || (chosen.length ? `${chosen.map((service) => service.name).join(" + ")} contract` : "");
      const price = chosen.reduce((sum, service) => sum + (Number(service.defaultPrice) || 0), 0);
      return { ...current, serviceIds, title, ...(priceTouched ? {} : { pricePerVisit: price > 0 ? String(price) : "" }) };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const problem = validateContract(values);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const result = await onSave({
      ...values,
      visitCount: values.lengthBy === "count" ? Number(values.visitCount) : null,
      endsOn: values.lengthBy === "until" ? values.endsOn : "",
    });
    setSaving(false);
    if (result !== true) setError(typeof result === "string" ? result : "The contract was not saved.");
  };

  const estimate = values.lengthBy === "count" && Number(values.pricePerVisit) > 0 ? Number(values.visitCount) * Number(values.pricePerVisit) : null;
  const activeClients = clients.filter((client) => client.status !== "ARCHIVED" || client.id === values.clientId);
  const choices = services.filter((service) => service.isActive || values.serviceIds.includes(service.id));

  return (
    <Modal
      title={contract ? `Edit ${contract.reference}` : "New contract"}
      eyebrow="Service contract"
      size="lg"
      onClose={onClose}
      footer={
        <>
          {estimate !== null && (
            <span style={{ marginRight: "auto", alignSelf: "center", color: colors.muted, fontSize: "0.85rem" }}>
              Contract value <strong style={{ color: colors.ink }}>{formatPeso(estimate)}</strong>
            </span>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="contract-form" loading={saving}>{contract ? "Save changes" : "Save as draft"}</Button>
        </>
      }
    >
      <form id="contract-form" onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Client" required>
            <Select aria-label="Client" value={values.clientId} onChange={set("clientId")}>
              <option value="">Choose a client</option>
              {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </Select>
          </Field>
          <Field label="Title" required>
            <Input aria-label="Contract title" value={values.title} maxLength={200} onChange={set("title")} placeholder="Quarterly termite protection" />
          </Field>
        </div>

        <fieldset style={{ margin: 0, padding: "0.8rem 0.9rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px" }}>
          <legend style={{ padding: "0 0.3rem", fontSize: "0.85rem", color: colors.ink, fontWeight: 600 }}>Services covered</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1rem" }}>
            {choices.map((service) => (
              <label key={service.id} style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.88rem", color: colors.body }}>
                <input type="checkbox" checked={values.serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />
                {service.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="How often" required>
            <Select aria-label="Frequency" value={values.frequency} onChange={set("frequency")}>
              {FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
            </Select>
          </Field>
          <Field label="Starts" required>
            <Input aria-label="Start date" type="date" value={values.startsOn} onChange={set("startsOn")} />
          </Field>
          <Field label="Length" required>
            <Select aria-label="Contract length by" value={values.lengthBy} onChange={set("lengthBy")}>
              <option value="count">Number of visits</option>
              <option value="until">Until a date</option>
            </Select>
          </Field>
          {values.lengthBy === "count" ? (
            <Field label="Visits" required>
              <Input aria-label="Number of visits" type="number" min="2" max={MAX_PLAN_VISITS} step="1" value={values.visitCount} onChange={set("visitCount")} />
            </Field>
          ) : (
            <Field label="Ends" required>
              <Input aria-label="End date" type="date" min={values.startsOn} value={values.endsOn} onChange={set("endsOn")} />
            </Field>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Price per visit (₱)" required>
            <Input aria-label="Price per visit" type="number" min="0" step="0.01" value={values.pricePerVisit} onChange={set("pricePerVisit")} />
          </Field>
          <Field label="Billed">
            <Select aria-label="Billing schedule" value={values.billingSchedule} onChange={set("billingSchedule")}>
              {BILLING_SCHEDULES.map((schedule) => <option key={schedule.value} value={schedule.value}>{schedule.label}</option>)}
            </Select>
          </Field>
          <Field label="Payment terms">
            <Select aria-label="Payment terms" value={values.paymentTerms} onChange={set("paymentTerms")}>
              {PAYMENT_TERMS.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="What's included" hint="Visits, materials and any free call-backs, as agreed.">
          <Textarea aria-label="Inclusions" rows={2} maxLength={LIMITS.NOTES_MAX} value={values.inclusions} onChange={set("inclusions")} placeholder="Quarterly treatment of the whole house, materials included, one free call-back between visits." />
        </Field>
        <Field label="Cancellation terms">
          <Textarea aria-label="Cancellation terms" rows={2} maxLength={LIMITS.NOTES_MAX} value={values.cancellationTerms} onChange={set("cancellationTerms")} />
        </Field>
        <Field label="Notes">
          <Textarea aria-label="Contract notes" rows={2} maxLength={LIMITS.NOTES_MAX} value={values.notes} onChange={set("notes")} />
        </Field>

        {error && <p role="alert" style={{ margin: 0, color: colors.danger, fontWeight: 500 }}>{error}</p>}
      </form>
    </Modal>
  );
}

export default ContractEditor;
