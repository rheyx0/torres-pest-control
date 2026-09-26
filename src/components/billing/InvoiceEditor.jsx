// Issue an invoice (Sprint 3, migration 062).
//
// Pick the client, optionally the approved quote it bills, and the completed
// visits it covers; the lines fill in from those (the quote's lines, or each
// visit at its booked price, plus extra materials and approved extras — see
// draftInvoiceLines) and can be adjusted before it is issued. The down payment
// the quote already received is deducted. Once issued an invoice is final: a
// mistake is voided and issued again.

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Field, Input, Modal, Select, Textarea } from "../ui";
import { colors } from "../../styles/theme";
import { LIMITS, PAYMENT_TERMS, VAT_MODES, VAT_RATE } from "../../utils/constants";
import { depositToApply, draftInvoiceLines, dueDateFor, invoiceableVisits, lineAmount, quoteTotals } from "../../utils/billing";
import { appointmentReference } from "../../utils/scheduling";
import { formatDate, formatPeso } from "../../utils/formatters";
import { todayISO, validateMoney } from "../../utils/validators";

let lineCounter = 0;
const keyed = (line) => ({ key: `invoice-line-${(lineCounter += 1)}`, serviceId: "", itemId: "", appointmentId: "", extraId: "", unit: "", ...line, quantity: String(line.quantity ?? "1"), unitPrice: String(line.unitPrice ?? "") });

const KIND_LABELS = { SERVICE: "Service", MATERIAL: "Material", EXTRA: "Extra work" };

/** Pure validation, exported for tests. Returns an error string or null. */
export function validateInvoice(form, lines, today = todayISO()) {
  if (!form.clientId) return "Choose the client to invoice.";
  if (!form.issuedOn) return "Enter the invoice date.";
  if (form.issuedOn > today) return "An invoice cannot be dated in the future.";
  if (lines.length === 0) return "An invoice needs at least one line.";
  for (const line of lines) {
    if (!String(line.description || "").trim()) return "Every line needs a description.";
    const quantity = Number(line.quantity);
    if (!(quantity > 0) || quantity > LIMITS.MAX_MOVEMENT_QTY) return `The quantity for "${line.description}" must be above zero.`;
    if (line.unitPrice === "" || line.unitPrice === null) return `Enter a price for "${line.description}".`;
    const priceError = validateMoney(line.unitPrice, { max: LIMITS.MAX_UNIT_COST, label: `The price for "${line.description}"` });
    if (priceError) return priceError;
  }
  if (form.discountType === "PERCENT" && Number(form.discountValue) > 100) return "A discount cannot be more than 100%.";
  return validateMoney(form.discountValue, { max: 9999999999, label: "The discount" });
}

function InvoiceEditor({
  clients = [],
  quotes = [],
  invoices = [],
  payments = [],
  appointments = [],
  extras = [],
  servicesFor = () => [],
  itemById = () => null,
  initialClientId = "",
  initialQuoteId = "",
  onSave,
  onClose,
}) {
  const startQuote = quotes.find((quote) => quote.id === initialQuoteId) || null;
  const [form, setForm] = useState(() => ({
    clientId: startQuote?.clientId || initialClientId || "",
    quoteId: startQuote?.id || "",
    issuedOn: todayISO(),
    paymentTerms: startQuote?.paymentTerms || "DUE_ON_RECEIPT",
    discountType: startQuote?.discountType || "AMOUNT",
    discountValue: startQuote?.discountValue ?? 0,
    vatMode: startQuote?.vatMode || "ADDED",
    notes: "",
  }));
  const [visitIds, setVisitIds] = useState(() => (startQuote
    ? invoiceableVisits(appointments, startQuote.clientId).filter((visit) => visit.quoteId === startQuote.id).map((visit) => visit.id)
    : []));
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const quote = quotes.find((entry) => entry.id === form.quoteId) || null;
  const clientQuotes = quotes.filter((entry) => entry.clientId === form.clientId && entry.status === "APPROVED");
  const visits = useMemo(() => invoiceableVisits(appointments, form.clientId), [appointments, form.clientId]);
  const chosenVisits = visits.filter((visit) => visitIds.includes(visit.id));
  const quoteInvoiced = Boolean(quote) && invoices.some((invoice) => invoice.quoteId === quote.id && invoice.status !== "VOID");

  // The lines start again from the choices whenever they change.
  useEffect(() => {
    setLines(draftInvoiceLines({ quote, quoteInvoiced, visits: chosenVisits, extras, servicesFor, itemById }).map(keyed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.clientId, form.quoteId, visitIds.join(",")]);

  const totals = quoteTotals(lines, { ...form, vatRate: VAT_RATE });
  const deposit = depositToApply(quote, payments, invoices, totals.total);
  const amountDue = Math.max(0, Math.round((totals.total - deposit) * 100) / 100);

  const set = (field, value) => {
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  };

  const chooseClient = (clientId) => {
    setVisitIds([]);
    setForm((current) => ({ ...current, clientId, quoteId: "" }));
  };

  const chooseQuote = (quoteId) => {
    const next = quotes.find((entry) => entry.id === quoteId) || null;
    setVisitIds(next ? visits.filter((visit) => visit.quoteId === next.id).map((visit) => visit.id) : []);
    setForm((current) => ({
      ...current,
      quoteId,
      ...(next ? { paymentTerms: next.paymentTerms, discountType: next.discountType, discountValue: next.discountValue, vatMode: next.vatMode } : {}),
    }));
  };

  const toggleVisit = (id) => setVisitIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  const updateLine = (key, patch) => {
    setError("");
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const problem = validateInvoice(form, lines);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const result = await onSave(
      { ...form, vatRate: VAT_RATE, appointmentIds: visitIds },
      lines.map((line) => ({ ...line, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }))
    );
    setSaving(false);
    if (result !== true) setError(typeof result === "string" ? result : "The invoice was not issued.");
  };

  const activeClients = clients.filter((client) => client.status !== "ARCHIVED" || client.id === form.clientId);

  return (
    <Modal
      title="New invoice"
      eyebrow="Once issued it can't be edited — a mistake is voided"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: "auto", alignSelf: "center", color: colors.muted, fontSize: "0.85rem" }}>
            Amount due <strong style={{ color: colors.ink }}>{formatPeso(amountDue)}</strong>
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="invoice-form" loading={saving}>Issue invoice</Button>
        </>
      }
    >
      <form id="invoice-form" onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Client" required>
            <Select aria-label="Client" value={form.clientId} onChange={(event) => chooseClient(event.target.value)}>
              <option value="">Choose a client</option>
              {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </Select>
          </Field>
          <Field label="Quote" hint={quoteInvoiced ? "Already invoiced once: its lines are not repeated." : undefined}>
            <Select aria-label="Quote" value={form.quoteId} onChange={(event) => chooseQuote(event.target.value)} disabled={!form.clientId}>
              <option value="">No quote</option>
              {clientQuotes.map((entry) => <option key={entry.id} value={entry.id}>{entry.reference} · {formatPeso(entry.total)}</option>)}
            </Select>
          </Field>
          <Field label="Invoice date" required>
            <Input aria-label="Invoice date" type="date" max={todayISO()} value={form.issuedOn} onChange={(event) => set("issuedOn", event.target.value)} />
          </Field>
          <Field label="Payment terms" hint={form.issuedOn ? `Due ${formatDate(dueDateFor(form.issuedOn, form.paymentTerms))}` : undefined}>
            <Select aria-label="Payment terms" value={form.paymentTerms} onChange={(event) => set("paymentTerms", event.target.value)}>
              {PAYMENT_TERMS.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
            </Select>
          </Field>
        </div>

        {form.clientId && (
          <fieldset style={{ margin: 0, padding: "0.8rem 0.9rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px" }}>
            <legend style={{ padding: "0 0.3rem", fontSize: "0.85rem", color: colors.ink, fontWeight: 600 }}>Completed visits to bill</legend>
            {visits.length === 0 ? (
              <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>No completed visits waiting for an invoice.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.35rem" }}>
                {visits.map((visit) => (
                  <label key={visit.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.88rem", color: colors.body }}>
                    <input type="checkbox" checked={visitIds.includes(visit.id)} onChange={() => toggleVisit(visit.id)} />
                    {appointmentReference(visit)} · {formatDate(visit.scheduledAt)} · {visit.serviceType || "Service visit"}
                    {visit.quoteId && visit.quoteId === form.quoteId && <span style={{ color: colors.muted }}>(booked from this quote)</span>}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <section aria-label="Invoice lines" style={{ display: "grid", gap: "0.5rem", padding: "0.9rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px", background: colors.canvas, overflowX: "auto" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <strong style={{ color: colors.ink, fontSize: "0.9rem", marginRight: "auto" }}>Lines</strong>
            <Button size="sm" onClick={() => setLines((current) => [...current, keyed({ kind: "EXTRA", unit: "job", description: "" })])}>
              <Plus size={14} /> Line
            </Button>
          </div>
          {lines.length === 0 && <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>Choose a quote or visits, or add a line.</p>}
          {lines.map((line) => (
            <div key={line.key} style={{ display: "grid", gridTemplateColumns: "82px minmax(180px, 1fr) 80px 110px 110px auto", gap: "0.5rem", alignItems: "center", minWidth: "620px" }}>
              <span style={{ fontSize: "0.74rem", color: colors.muted }}>{line.extraId ? "Approved extra" : KIND_LABELS[line.kind]}</span>
              <Input aria-label="Line description" value={line.description} maxLength={300} onChange={(event) => updateLine(line.key, { description: event.target.value })} placeholder="Describe the work" />
              <Input aria-label="Line quantity" type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
              <Input aria-label="Line unit price" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} placeholder="Price" />
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
          <Field label="Notes" hint="Shown on the invoice.">
            <Textarea aria-label="Invoice notes" rows={2} maxLength={LIMITS.NOTES_MAX} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
          </Field>
          <dl aria-label="Invoice totals" style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "0.3rem 1rem", fontSize: "0.88rem", color: colors.body }}>
            <dt>Subtotal</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(totals.subtotal)}</dd>
            <dt>Discount</dt><dd style={{ margin: 0, textAlign: "right" }}>−{formatPeso(totals.discountAmount)}</dd>
            <dt>{form.vatMode === "INCLUSIVE" ? `VAT included (${VAT_RATE}%)` : `VAT (${VAT_RATE}%)`}</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{form.vatMode === "NONE" ? "—" : formatPeso(totals.vatAmount)}</dd>
            <dt>Total</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(totals.total)}</dd>
            {deposit > 0 && (<><dt>Less down payment</dt><dd style={{ margin: 0, textAlign: "right" }}>−{formatPeso(deposit)}</dd></>)}
            <dt style={{ fontWeight: 600, color: colors.ink }}>Amount due</dt><dd style={{ margin: 0, textAlign: "right", fontWeight: 600, color: colors.ink }}>{formatPeso(amountDue)}</dd>
          </dl>
        </div>

        {error && <p role="alert" style={{ margin: 0, color: colors.danger, fontWeight: 500 }}>{error}</p>}
      </form>
    </Modal>
  );
}

export default InvoiceEditor;
