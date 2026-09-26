// One invoice: its lines, the down payment deducted, what has been paid and
// what is left (Sprint 3, migration 062).
//
//   Record payment   while a balance remains (full or partial, any method)
//   Void             admin only, with a reason, once its payments are reversed

import { useState } from "react";
import { Button, Input, Modal, StatusPill } from "../ui";
import { colors } from "../../styles/theme";
import { INVOICE_STATE_LABELS, PAYMENT_TERMS } from "../../utils/constants";
import { invoiceBalance } from "../../utils/billing";
import { formatDate, formatPeso } from "../../utils/formatters";
import PaymentList from "./PaymentList";

export const INVOICE_TONES = { VOID: "neutral", PAID: "success", PARTIAL: "warning", OVERDUE: "danger", UNPAID: "warning" };


function InvoiceDetail({ invoice, client, quote = null, payments = [], canVoid = false, canReverse = false, onRecordPayment, onVoid, onCheck, onReverse, onOpenQuote, onPrint, onReceipt, onClose }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const balance = invoiceBalance(invoice, payments);
  const own = payments.filter((payment) => payment.invoiceId === invoice.id);
  const standing = own.some((payment) => !payment.reversedAt && payment.checkStatus !== "BOUNCED");
  const terms = PAYMENT_TERMS.find((term) => term.value === invoice.paymentTerms)?.label || "";
  const isVoid = invoice.status === "VOID";

  const confirmVoid = async () => {
    setBusy(true);
    setError("");
    const result = await onVoid(reason.trim());
    setBusy(false);
    if (typeof result === "string") setError(result);
  };

  const footer = (
    <>
      {error && <span role="alert" style={{ marginRight: "auto", alignSelf: "center", color: colors.danger, fontSize: "0.85rem", fontWeight: 500 }}>{error}</span>}
      {onPrint && !voiding && <Button variant="ghost" onClick={onPrint}>Print / PDF</Button>}
      {!isVoid && !voiding && (
        <>
          {canVoid && (
            <Button variant="quiet" disabled={standing} title={standing ? "Reverse its payments first." : undefined} onClick={() => setVoiding(true)}>Void</Button>
          )}
          {balance.balance > 0 && <Button variant="primary" onClick={onRecordPayment}>Record payment</Button>}
        </>
      )}
      {voiding && (
        <>
          <Input aria-label="Why it is being voided" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this invoice being voided?" style={{ flex: "1 1 260px" }} />
          <Button variant="quiet" onClick={() => { setVoiding(false); setReason(""); }}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={confirmVoid}>Void invoice</Button>
        </>
      )}
    </>
  );

  const row = (label, value, strong = false) => (
    <>
      <dt style={strong ? { fontWeight: 600, color: colors.ink } : undefined}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right", ...(strong ? { fontWeight: 600, color: colors.ink } : {}) }}>{value}</dd>
    </>
  );

  return (
    <Modal title={`${invoice.reference} · ${client?.name || "Client"}`} eyebrow="Invoice" size="lg" onClose={onClose} footer={footer}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", color: colors.body, fontSize: "0.88rem" }}>
          <StatusPill tone={INVOICE_TONES[balance.state]} status={INVOICE_STATE_LABELS[balance.state]} />
          <span>Issued {formatDate(invoice.issuedOn)}</span>
          {!isVoid && <span>· Due {formatDate(invoice.dueOn)}{terms ? ` (${terms.toLowerCase()})` : ""}</span>}
          {quote && (
            <span>· From <button type="button" onClick={onOpenQuote} style={{ all: "unset", cursor: "pointer", color: colors.brand, textDecoration: "underline" }}>{quote.reference}</button></span>
          )}
        </div>

        {isVoid && <p style={{ margin: 0, color: colors.danger }}>Voided {formatDate(invoice.voidedAt)}: {invoice.voidReason}</p>}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem", minWidth: "520px" }}>
            <thead>
              <tr style={{ color: colors.muted, textAlign: "left" }}>
                <th style={{ padding: "0.4rem 0", fontWeight: 500 }}>Description</th>
                <th style={{ padding: "0.4rem 0", fontWeight: 500, textAlign: "right" }}>Qty</th>
                <th style={{ padding: "0.4rem 0", fontWeight: 500, textAlign: "right" }}>Price</th>
                <th style={{ padding: "0.4rem 0", fontWeight: 500, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} style={{ borderTop: `1px solid ${colors.line}` }}>
                  <td style={{ padding: "0.45rem 0", color: colors.ink }}>{line.description}</td>
                  <td style={{ padding: "0.45rem 0", textAlign: "right" }}>{line.quantity} {line.unit}</td>
                  <td style={{ padding: "0.45rem 0", textAlign: "right" }}>{formatPeso(line.unitPrice)}</td>
                  <td style={{ padding: "0.45rem 0", textAlign: "right", color: colors.ink }}>{formatPeso(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl aria-label="Invoice totals" style={{ margin: "0 0 0 auto", minWidth: "260px", display: "grid", gridTemplateColumns: "1fr auto", gap: "0.3rem 1.5rem", fontSize: "0.88rem" }}>
          {row("Subtotal", formatPeso(invoice.subtotal))}
          {invoice.discountAmount > 0 && row("Discount", `−${formatPeso(invoice.discountAmount)}`)}
          {invoice.vatMode !== "NONE" && row(invoice.vatMode === "INCLUSIVE" ? `VAT included (${invoice.vatRate}%)` : `VAT (${invoice.vatRate}%)`, formatPeso(invoice.vatAmount))}
          {row("Total", formatPeso(invoice.total))}
          {invoice.depositApplied > 0 && row("Less down payment", `−${formatPeso(invoice.depositApplied)}`)}
          {row("Amount due", formatPeso(invoice.amountDue), true)}
          {row("Paid", formatPeso(balance.paid))}
          {balance.pending > 0 && row("Checks not yet cleared", formatPeso(balance.pending))}
          {!isVoid && row("Balance", formatPeso(balance.balance), true)}
        </dl>

        {invoice.notes && <p style={{ margin: 0, color: colors.body, whiteSpace: "pre-wrap" }}>{invoice.notes}</p>}

        <section aria-label="Payments on this invoice">
          <h3 style={{ margin: "0 0 0.3rem", fontSize: "0.95rem", color: colors.ink }}>Payments</h3>
          <PaymentList payments={own} labelFor={() => "Payment"} canReverse={canReverse} onCheck={onCheck} onReverse={onReverse} onReceipt={onReceipt} empty="No payments yet." />
        </section>
      </div>
    </Modal>
  );
}

export default InvoiceDetail;
