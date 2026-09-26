// One quote, and what can happen to it next (Sprint 3, migration 061).
//
//   Draft     Edit · Mark as sent · Delete
//   Sent      Edit (back to draft) · Approve · Reject (with a reason)
//   Expired   Revise
//   Approved  Record down payment · Book visit · Create invoice · Revise
//   Rejected  Revise
//
// Booking is offered only once any required down payment has been received:
// the same rule the server enforces when it links the visit to the quote.

import { useState } from "react";
import { Button, Input, Modal, StatusPill } from "../ui";
import { colors } from "../../styles/theme";
import { PAYMENT_TERMS, QUOTE_STATUS_LABELS } from "../../utils/constants";
import { canBookFromQuote, depositStatus, quoteStatus } from "../../utils/billing";
import { appointmentReference } from "../../utils/scheduling";
import { formatDate, formatPeso } from "../../utils/formatters";
import PaymentList from "./PaymentList";

const DEPOSIT_WORDS = {
  DUE: "Down payment due",
  PARTIAL: "Down payment due",
  PENDING_CHECK: "Pending check",
  PAID: "Down payment paid",
};

function QuoteDetail({
  quote,
  client,
  payments = [],
  visits = [],
  invoices = [],
  canReverse = false,
  onEdit,
  onSend,
  onDecide,
  onRevise,
  onDelete,
  onRecordDeposit,
  onBook,
  onInvoice,
  onOpenInvoice,
  onCheck,
  onReverse,
  onPrint,
  onReceipt,
  onClose,
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = quoteStatus(quote);
  const deposit = depositStatus(quote, payments);
  const booking = canBookFromQuote(quote, payments);
  const own = payments.filter((payment) => payment.quoteId === quote.id);
  const terms = PAYMENT_TERMS.find((term) => term.value === quote.paymentTerms)?.label || "";

  const act = async (call) => {
    setBusy(true);
    setError("");
    const result = await call();
    setBusy(false);
    if (result === true || (result && typeof result === "object")) return true;
    setError(typeof result === "string" ? result : "That did not save.");
    return false;
  };

  const footer = (
    <>
      {error && <span role="alert" style={{ marginRight: "auto", alignSelf: "center", color: colors.danger, fontSize: "0.85rem", fontWeight: 500 }}>{error}</span>}
      {onPrint && !rejecting && !confirmDelete && <Button variant="ghost" onClick={onPrint}>Print / PDF</Button>}
      {status === "DRAFT" && !confirmDelete && (
        <>
          <Button variant="quiet" onClick={() => setConfirmDelete(true)}>Delete</Button>
          <Button onClick={onEdit}>Edit</Button>
          <Button variant="primary" loading={busy} onClick={() => act(onSend)}>Mark as sent</Button>
        </>
      )}
      {status === "DRAFT" && confirmDelete && (
        <>
          <span style={{ marginRight: "auto", alignSelf: "center", color: colors.danger }}>Delete this draft for good?</span>
          <Button variant="quiet" onClick={() => setConfirmDelete(false)}>Keep</Button>
          <Button variant="danger" loading={busy} onClick={() => act(onDelete)}>Delete draft</Button>
        </>
      )}
      {status === "SENT" && !rejecting && (
        <>
          <Button onClick={onEdit}>Edit</Button>
          <Button variant="quiet" onClick={() => setRejecting(true)}>Reject</Button>
          <Button variant="primary" loading={busy} onClick={() => act(() => onDecide(true))}>Approve</Button>
        </>
      )}
      {status === "SENT" && rejecting && (
        <>
          <Input aria-label="Why it was rejected" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why did the client reject it?" style={{ flex: "1 1 260px" }} />
          <Button variant="quiet" onClick={() => { setRejecting(false); setReason(""); }}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => act(() => onDecide(false, reason.trim()))}>Reject quote</Button>
        </>
      )}
      {status === "APPROVED" && (
        <>
          <Button variant="quiet" onClick={onRevise}>Revise</Button>
          {deposit.required > 0 && deposit.state !== "PAID" && (
            <Button onClick={onRecordDeposit}>Record down payment</Button>
          )}
          {onInvoice && <Button onClick={onInvoice}>Create invoice</Button>}
          <Button variant="primary" disabled={!booking.ok} title={booking.reason || undefined} onClick={onBook}>Book visit</Button>
        </>
      )}
      {(status === "EXPIRED" || status === "REJECTED") && <Button variant="primary" onClick={onRevise}>Revise</Button>}
    </>
  );

  return (
    <Modal title={`${quote.reference} · ${client?.name || "Client"}`} eyebrow="Quote" size="lg" onClose={onClose} footer={footer}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", color: colors.body, fontSize: "0.88rem" }}>
          <StatusPill status={QUOTE_STATUS_LABELS[status]} />
          {deposit.required > 0 && <StatusPill status={DEPOSIT_WORDS[deposit.state]} />}
          <span>Valid until {formatDate(quote.validUntil)}</span>
          {terms && <span>· Payment {terms.toLowerCase()}</span>}
          {quote.areaSqm && <span>· {quote.areaSqm} sqm</span>}
        </div>

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
              {quote.lines.map((line) => (
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

        <dl aria-label="Quote totals" style={{ margin: "0 0 0 auto", minWidth: "260px", display: "grid", gridTemplateColumns: "1fr auto", gap: "0.3rem 1.5rem", fontSize: "0.88rem" }}>
          <dt>Subtotal</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(quote.subtotal)}</dd>
          {quote.discountAmount > 0 && (<><dt>Discount</dt><dd style={{ margin: 0, textAlign: "right" }}>−{formatPeso(quote.discountAmount)}</dd></>)}
          {quote.vatMode !== "NONE" && (<><dt>{quote.vatMode === "INCLUSIVE" ? `VAT included (${quote.vatRate}%)` : `VAT (${quote.vatRate}%)`}</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(quote.vatAmount)}</dd></>)}
          <dt style={{ fontWeight: 600, color: colors.ink }}>Total</dt><dd style={{ margin: 0, textAlign: "right", fontWeight: 600, color: colors.ink }}>{formatPeso(quote.total)}</dd>
          {deposit.required > 0 && (
            <>
              <dt>Down payment</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(deposit.required)}</dd>
              <dt>Received</dt><dd style={{ margin: 0, textAlign: "right" }}>{formatPeso(deposit.paid)}{deposit.pending > 0 ? ` (+${formatPeso(deposit.pending)} pending)` : ""}</dd>
            </>
          )}
        </dl>

        {quote.notes && <p style={{ margin: 0, color: colors.body, whiteSpace: "pre-wrap" }}>{quote.notes}</p>}
        {quote.decisionNote && <p style={{ margin: 0, color: colors.muted }}>Client's answer: {quote.decisionNote}</p>}

        {(own.length > 0 || status === "APPROVED") && (
          <section aria-label="Payments on this quote">
            <h3 style={{ margin: "0 0 0.3rem", fontSize: "0.95rem", color: colors.ink }}>Payments</h3>
            <PaymentList payments={own} labelFor={() => "Down payment"} canReverse={canReverse} onCheck={onCheck} onReverse={onReverse} onReceipt={onReceipt} empty="No down payment received yet." />
          </section>
        )}

        {visits.length > 0 && (
          <section aria-label="Visits booked from this quote">
            <h3 style={{ margin: "0 0 0.3rem", fontSize: "0.95rem", color: colors.ink }}>Visits</h3>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", color: colors.body, fontSize: "0.88rem" }}>
              {visits.map((visit) => (
                <li key={visit.id}>{appointmentReference(visit)} · {formatDate(visit.scheduledAt)} · {visit.status}</li>
              ))}
            </ul>
          </section>
        )}

        {invoices.length > 0 && (
          <section aria-label="Invoices for this quote">
            <h3 style={{ margin: "0 0 0.3rem", fontSize: "0.95rem", color: colors.ink }}>Invoices</h3>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", color: colors.body, fontSize: "0.88rem" }}>
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <button type="button" onClick={() => onOpenInvoice?.(invoice.id)} style={{ all: "unset", cursor: "pointer", color: colors.brand, textDecoration: "underline" }}>{invoice.reference}</button>
                  {" · "}{formatDate(invoice.issuedOn)} · {formatPeso(invoice.amountDue)} due{invoice.status === "VOID" ? " · void" : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        {status === "APPROVED" && !booking.ok &&<p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>{booking.reason}</p>}
      </div>
    </Modal>
  );
}

export default QuoteDetail;
