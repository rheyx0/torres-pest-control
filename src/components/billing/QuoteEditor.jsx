// Create or change a quote (Sprint 3, migration 061).
//
// A quote is lines — services, materials, extra work — then a discount, VAT
// and the down payment it asks for. Prices start from the catalog (a
// service's flat or per-sqm price, an item's customer price, both 060) and the
// office may change any line: a quote is a negotiated price. The totals shown
// here are the same arithmetic the server does when it saves (save_quote).
//
// An area-priced service is priced from the quote's area: change the area and
// those lines re-price, unless their price was typed over by hand.

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Field, Input, Modal, Select, Textarea } from "../ui";
import { colors } from "../../styles/theme";
import { LIMITS, PAYMENT_TERMS, VAT_MODES, VAT_RATE } from "../../utils/constants";
import { customerPrice, servicePrice } from "../../utils/pricing";
import { lineAmount, quoteTotals, validUntilFrom } from "../../utils/billing";
import { formatPeso } from "../../utils/formatters";
import { todayISO, validateMoney } from "../../utils/validators";

let lineCounter = 0;
const newLine = (fields) => ({ key: `quote-line-${(lineCounter += 1)}`, kind: "EXTRA", serviceId: "", itemId: "", description: "", quantity: "1", unit: "", unitPrice: "", autoPriced: false, ...fields });

const KIND_LABELS = { SERVICE: "Service", MATERIAL: "Material", EXTRA: "Extra work" };

/**
 * Pure validation, exported for tests. Returns an error string or null.
 */
export function validateQuote(form, lines, today = todayISO()) {
  if (!form.clientId) return "Choose the client for this quote.";
  if (!form.validUntil) return "Set how long the quote is valid.";
  if (form.validUntil < today) return "The validity date has already passed.";
  if (lines.length === 0) return "Add at least one service, material or extra work.";
  for (const line of lines) {
    if (!String(line.description || "").trim()) return "Every line needs a description.";
    const quantity = Number(line.quantity);
    if (!(quantity > 0) || quantity > LIMITS.MAX_MOVEMENT_QTY) return `The quantity for "${line.description}" must be above zero.`;
    if (line.unitPrice === "" || line.unitPrice === null) return `Enter a price for "${line.description}".`;
    const priceError = validateMoney(line.unitPrice, { max: LIMITS.MAX_UNIT_COST, label: `The price for "${line.description}"` });
    if (priceError) return priceError;
  }
  if (form.discountType === "PERCENT" && Number(form.discountValue) > 100) return "A discount cannot be more than 100%.";
  const discountError = validateMoney(form.discountValue, { max: 9999999999, label: "The discount" });
  if (discountError) return discountError;
  if (form.depositType === "PERCENT" && Number(form.depositValue) > 100) return "A down payment cannot be more than 100%.";
  if (form.depositType !== "NONE" && !(Number(form.depositValue) > 0)) return "Enter the down payment, or choose No down payment.";
  return null;
}

function QuoteEditor({ quote = null, clients = [], services = [], inventory = [], initialClientId = "", onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    clientId: quote?.clientId || initialClientId || "",
    validUntil: quote?.validUntil || validUntilFrom(30),
    paymentTerms: quote?.paymentTerms || "DUE_ON_RECEIPT",
    areaSqm: quote?.areaSqm ?? "",
    discountType: quote?.discountType || "AMOUNT",
    discountValue: quote?.discountValue ?? 0,
    vatMode: quote?.vatMode || "ADDED",
    depositType: quote?.depositType || "NONE",
    depositValue: quote?.depositValue ?? 0,
    notes: quote?.notes || "",
  }));
  const [lines, setLines] = useState(() => (quote?.lines || []).map((line) => newLine({
    kind: line.kind,
    serviceId: line.serviceId,
    itemId: line.itemId,
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit,
    unitPrice: String(line.unitPrice),
  })));
  const [adding, setAdding] = useState({ service: "", item: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const servicesById = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const itemsById = useMemo(() => new Map(inventory.map((item) => [item.id, item])), [inventory]);
  const totals = quoteTotals(lines, { ...form, vatRate: VAT_RATE });

  const set = (field, value) => {
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  };

  // The area re-prices every per-sqm service line not typed over by hand.
  const setArea = (value) => {
    set("areaSqm", value);
    setLines((current) => current.map((line) => {
      const service = line.kind === "SERVICE" && line.autoPriced ? servicesById.get(line.serviceId) : null;
      if (!service || service.pricingMode !== "AREA") return line;
      const price = servicePrice(service, value);
      return price === null ? line : { ...line, unitPrice: String(price) };
    }));
  };

  const updateLine = (key, patch) => {
    setError("");
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const addService = (serviceId) => {
    const service = servicesById.get(serviceId);
    if (!service) return;
    const price = servicePrice(service, form.areaSqm);
    setLines((current) => [...current, newLine({
      kind: "SERVICE",
      serviceId,
      description: service.name,
      quantity: "1",
      unit: service.pricingMode === "AREA" ? "job" : "visit",
      unitPrice: price === null ? "" : String(price),
      autoPriced: true,
    })]);
    // The first service with a down payment sets the quote's default.
    if (form.depositType === "NONE" && service.depositPercent > 0) {
      setForm((current) => ({ ...current, depositType: "PERCENT", depositValue: service.depositPercent }));
    }
    setAdding((current) => ({ ...current, service: "" }));
  };

  const addItem = (itemId) => {
    const item = itemsById.get(itemId);
    if (!item) return;
    setLines((current) => [...current, newLine({
      kind: "MATERIAL",
      itemId,
      description: item.name,
      quantity: "1",
      unit: item.unit,
      unitPrice: String(customerPrice(item)),
    })]);
    setAdding((current) => ({ ...current, item: "" }));
  };

  const needsArea = lines.some((line) => line.kind === "SERVICE" && servicesById.get(line.serviceId)?.pricingMode === "AREA");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const problem = validateQuote(form, lines) || (needsArea && !(Number(form.areaSqm) > 0) ? "Enter the area (sqm) for the per-square-metre services." : null);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const result = await onSave({ ...form, vatRate: VAT_RATE, revisionOf: quote?.revisionOf || "" }, lines.map((line) => ({
      kind: line.kind,
      serviceId: line.serviceId,
      itemId: line.itemId,
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unit: line.unit,
      unitPrice: Number(line.unitPrice),
    })));
    setSaving(false);
    if (result !== true) setError(typeof result === "string" ? result : "The quote was not saved.");
  };

  const activeClients = clients.filter((client) => client.status !== "ARCHIVED" || client.id === form.clientId);

  return (
    <Modal
      title={quote ? `Edit ${quote.reference}` : "New quote"}
      eyebrow={quote?.status === "SENT" ? "Saving sends it back to draft" : "Quote"}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: "auto", alignSelf: "center", color: colors.muted, fontSize: "0.85rem" }}>
            Total <strong style={{ color: colors.ink }}>{formatPeso(totals.total)}</strong>
            {totals.depositAmount > 0 && <> · down payment {formatPeso(totals.depositAmount)}</>}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="quote-form" loading={saving}>
            {quote ? "Save changes" : "Save as draft"}
          </Button>
        </>
      }
    >
      <form id="quote-form" onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Client" required>
            <Select aria-label="Client" value={form.clientId} onChange={(event) => set("clientId", event.target.value)} disabled={Boolean(quote)}>
              <option value="">Choose a client</option>
              {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </Select>
          </Field>
          <Field label="Valid until" required>
            <Input aria-label="Valid until" type="date" min={todayISO()} value={form.validUntil} onChange={(event) => set("validUntil", event.target.value)} />
          </Field>
          <Field label="Payment terms">
            <Select aria-label="Payment terms" value={form.paymentTerms} onChange={(event) => set("paymentTerms", event.target.value)}>
              {PAYMENT_TERMS.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
            </Select>
          </Field>
          <Field label="Area (sqm)" hint={needsArea ? "Prices the per-sqm services." : "Only for per-sqm services."}>
            <Input aria-label="Area in square metres" type="number" min="0" step="any" value={form.areaSqm} onChange={(event) => setArea(event.target.value)} placeholder="0" />
          </Field>
        </div>

        <section aria-label="Quote lines" style={{ display: "grid", gap: "0.5rem", padding: "0.9rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px", background: colors.canvas }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ color: colors.ink, fontSize: "0.9rem", marginRight: "auto" }}>Services, materials and extra work</strong>
            <Select aria-label="Add a service" value={adding.service} onChange={(event) => addService(event.target.value)} style={{ width: "auto" }}>
              <option value="">+ Service</option>
              {services.filter((service) => service.isActive).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </Select>
            <Select aria-label="Add a material" value={adding.item} onChange={(event) => addItem(event.target.value)} style={{ width: "auto" }}>
              <option value="">+ Material</option>
              {inventory.filter((item) => item.status !== "DISABLED").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Button size="sm" onClick={() => setLines((current) => [...current, newLine({ kind: "EXTRA", unit: "job" })])}>
              <Plus size={14} /> Extra work
            </Button>
          </div>

          {lines.length === 0 && <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>Add the services first, then any materials or extra work.</p>}

          {lines.map((line) => (
            <div key={line.key} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 90px 120px 110px auto", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.74rem", color: colors.muted }}>{KIND_LABELS[line.kind]}</span>
              <Input aria-label="Line description" value={line.description} maxLength={300} onChange={(event) => updateLine(line.key, { description: event.target.value })} placeholder="Describe the work" />
              <Input aria-label="Line quantity" type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
              <Input aria-label="Line unit price" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value, autoPriced: false })} placeholder="Price" />
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: colors.ink }}>{formatPeso(lineAmount(line))}</span>
              <Button size="icon" variant="ghost" aria-label={`Remove ${line.description || "line"}`} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
                <X size={15} />
              </Button>
            </div>
          ))}
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Discount">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: "0.5rem" }}>
              <Input aria-label="Discount value" type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => set("discountValue", event.target.value)} />
              <Select aria-label="Discount type" value={form.discountType} onChange={(event) => set("discountType", event.target.value)}>
                <option value="AMOUNT">₱</option>
                <option value="PERCENT">%</option>
              </Select>
            </div>
          </Field>
          <Field label={`VAT (${VAT_RATE}%)`}>
            <Select aria-label="VAT" value={form.vatMode} onChange={(event) => set("vatMode", event.target.value)}>
              {VAT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </Select>
          </Field>
          <Field label="Down payment" hint="Must be paid before the visit is booked.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <Select aria-label="Down payment type" value={form.depositType} onChange={(event) => set("depositType", event.target.value)}>
                <option value="NONE">None</option>
                <option value="PERCENT">% of total</option>
                <option value="AMOUNT">Fixed ₱</option>
              </Select>
              <Input aria-label="Down payment value" type="number" min="0" step="0.01" value={form.depositValue} disabled={form.depositType === "NONE"} onChange={(event) => set("depositValue", event.target.value)} />
            </div>
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 280px)", gap: "1rem", alignItems: "start" }}>
          <Field label="Notes" hint="Shown on the quote.">
            <Textarea aria-label="Quote notes" rows={3} maxLength={LIMITS.NOTES_MAX} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
          </Field>
          <dl aria-label="Quote totals" style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "0.3rem 1rem", fontSize: "0.88rem", color: colors.body }}>
            <dt>Subtotal</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(totals.subtotal)}</dd>
            <dt>Discount</dt><dd style={{ margin: 0, textAlign: "right" }}>−{formatPeso(totals.discountAmount)}</dd>
            <dt>{form.vatMode === "INCLUSIVE" ? `VAT included (${VAT_RATE}%)` : `VAT (${VAT_RATE}%)`}</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{form.vatMode === "NONE" ? "—" : formatPeso(totals.vatAmount)}</dd>
            <dt style={{ fontWeight: 600, color: colors.ink }}>Total</dt><dd style={{ margin: 0, textAlign: "right", fontWeight: 600, color: colors.ink }}>{formatPeso(totals.total)}</dd>
            {totals.depositAmount > 0 && (<><dt>Down payment</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(totals.depositAmount)}</dd></>)}
          </dl>
        </div>

        {error && <p role="alert" style={{ margin: 0, color: colors.danger, fontWeight: 500 }}>{error}</p>}
      </form>
    </Modal>
  );
}

export default QuoteEditor;
