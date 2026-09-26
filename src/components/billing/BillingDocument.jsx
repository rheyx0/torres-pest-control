// The printable quote, invoice and payment receipt (Sprint 3).
//
// The same approach as the service form (ServiceReportDocument): rendered off
// screen, revealed by the print stylesheet in styles/globals.css, saved with
// the browser's "Save as PDF". It shares the service form's letterhead and
// styles so every document the client receives looks like one company's.
//
// The receipt is an acknowledgement receipt, not a BIR official receipt: the
// office still issues those from its registered booklet.

import { COMPANY, PAYMENT_METHOD_LABELS, PAYMENT_TERMS } from "../../utils/constants";
import { depositStatus, invoiceBalance } from "../../utils/billing";
import { appointmentReference } from "../../utils/scheduling";
import { formatDate, formatDateTime, formatPeso } from "../../utils/formatters";

const TITLES = { QUOTE: "Quotation", INVOICE: "Invoice", RECEIPT: "Acknowledgement Receipt" };

function Row({ label, value }) {
  return (
    <tr>
      <th className="sf-key">{label}</th>
      <td className="sf-val">{value || "—"}</td>
    </tr>
  );
}

function Lines({ lines }) {
  return (
    <table className="bd-lines">
      <thead>
        <tr><th>Description</th><th className="sf-num">Qty</th><th className="sf-num">Unit price</th><th className="sf-num">Amount</th></tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id}>
            <td>{line.description}</td>
            <td className="sf-num">{line.quantity} {line.unit}</td>
            <td className="sf-num">{formatPeso(line.unitPrice)}</td>
            <td className="sf-num">{formatPeso(line.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ record, children }) {
  return (
    <table className="bd-totals">
      <tbody>
        <tr><th>Subtotal</th><td>{formatPeso(record.subtotal)}</td></tr>
        {record.discountAmount > 0 && <tr><th>Discount</th><td>−{formatPeso(record.discountAmount)}</td></tr>}
        {record.vatMode === "ADDED" && <tr><th>VAT ({record.vatRate}%)</th><td>{formatPeso(record.vatAmount)}</td></tr>}
        <tr className="bd-strong"><th>Total</th><td>{formatPeso(record.total)}</td></tr>
        {record.vatMode === "INCLUSIVE" && <tr><th>VAT included ({record.vatRate}%)</th><td>{formatPeso(record.vatAmount)}</td></tr>}
        {children}
      </tbody>
    </table>
  );
}

const termsLabel = (value) => PAYMENT_TERMS.find((term) => term.value === value)?.label || "";
const clientLine = (client) => [client.reference, client.name].filter(Boolean).join(" — ");

function Letterhead({ kind, reference }) {
  return (
    <header className="sf-head">
      <img className="sf-logo" src={COMPANY.logo} alt="" />
      <div className="sf-org">
        <div className="sf-org-name">{COMPANY.name}</div>
        <div className="sf-org-line">{COMPANY.address}</div>
        <div className="sf-org-line">{COMPANY.phone} · {COMPANY.email}</div>
        <div className="sf-org-line">License no. {COMPANY.licenseNo}</div>
      </div>
      <div className="sf-doc">
        <div className="sf-doc-title">{TITLES[kind]}</div>
        <div className="sf-doc-ref">{reference}</div>
      </div>
    </header>
  );
}

function QuoteBody({ quote, client, payments }) {
  const deposit = depositStatus(quote, payments);
  return (
    <>
      <table className="sf-meta">
        <tbody>
          <Row label="Prepared for" value={clientLine(client)} />
          <Row label="Address" value={client.address} />
          <Row label="Contact" value={[client.phone, client.email].filter(Boolean).join(" · ")} />
          <Row label="Date" value={formatDate(quote.sentAt || quote.createdAt)} />
          <Row label="Valid until" value={formatDate(quote.validUntil)} />
          <Row label="Payment terms" value={termsLabel(quote.paymentTerms)} />
          {quote.areaSqm && <Row label="Area" value={`${quote.areaSqm} sqm`} />}
        </tbody>
      </table>
      <section className="sf-block"><h2 className="sf-h2">Scope and price</h2><Lines lines={quote.lines} /></section>
      <Totals record={quote}>
        {deposit.required > 0 && <tr className="bd-strong"><th>Down payment to book</th><td>{formatPeso(deposit.required)}</td></tr>}
      </Totals>
      {quote.notes && <section className="sf-block"><h2 className="sf-h2">Notes</h2><div className="sf-prose">{quote.notes}</div></section>}
      <section className="sf-block">
        <div className="sf-prose">
          Prices are valid until {formatDate(quote.validUntil)}.
          {deposit.required > 0 ? ` The visit is scheduled once the down payment of ${formatPeso(deposit.required)} is received; it is deducted from the final invoice.` : ""}
          {" "}Work beyond this scope is quoted separately and done only with your approval.
        </div>
      </section>
      <section className="sf-sign">
        <h2 className="sf-h2">Acceptance</h2>
        <div className="sf-sign-grid">
          <div className="sf-sign-box sf-sign-blank"><div className="sf-sign-rule" /><div className="sf-sign-cap">Client signature over printed name</div></div>
          <div className="sf-sign-box sf-sign-blank"><div className="sf-sign-rule" /><div className="sf-sign-cap">Date</div></div>
        </div>
      </section>
    </>
  );
}

function InvoiceBody({ invoice, client, quote, payments, visits }) {
  const balance = invoiceBalance(invoice, payments);
  const received = payments.filter((payment) => payment.invoiceId === invoice.id && !payment.reversedAt && payment.checkStatus !== "BOUNCED");
  return (
    <>
      <table className="sf-meta">
        <tbody>
          <Row label="Bill to" value={clientLine(client)} />
          <Row label="Address" value={client.address} />
          <Row label="Contact" value={[client.phone, client.email].filter(Boolean).join(" · ")} />
          <Row label="Invoice date" value={formatDate(invoice.issuedOn)} />
          <Row label="Due date" value={`${formatDate(invoice.dueOn)} (${termsLabel(invoice.paymentTerms).toLowerCase()})`} />
          {quote && <Row label="Quotation" value={quote.reference} />}
          {visits.length > 0 && <Row label={visits.length > 1 ? "Visits" : "Visit"} value={visits.map((visit) => `${appointmentReference(visit)} (${formatDate(visit.scheduledAt)})`).join(", ")} />}
        </tbody>
      </table>
      {invoice.status === "VOID" && <p className="bd-void">VOID — {invoice.voidReason}</p>}
      <section className="sf-block"><h2 className="sf-h2">Charges</h2><Lines lines={invoice.lines} /></section>
      <Totals record={invoice}>
        {invoice.depositApplied > 0 && <tr><th>Less down payment received</th><td>−{formatPeso(invoice.depositApplied)}</td></tr>}
        <tr className="bd-strong"><th>Amount due</th><td>{formatPeso(invoice.amountDue)}</td></tr>
        {balance.paid > 0 && <tr><th>Paid</th><td>−{formatPeso(balance.paid)}</td></tr>}
        {balance.paid > 0 && <tr className="bd-strong"><th>Balance</th><td>{formatPeso(balance.balance)}</td></tr>}
      </Totals>
      {received.length > 0 && (
        <section className="sf-block">
          <h2 className="sf-h2">Payments received</h2>
          <div className="sf-prose">
            {received.map((payment) => `${payment.reference} · ${formatDate(payment.paidOn)} · ${PAYMENT_METHOD_LABELS[payment.method]} · ${formatPeso(payment.amount)}${payment.checkStatus === "PENDING" ? " (check not yet cleared)" : ""}`).join("\n")}
          </div>
        </section>
      )}
      {invoice.notes && <section className="sf-block"><h2 className="sf-h2">Notes</h2><div className="sf-prose">{invoice.notes}</div></section>}
      <section className="sf-block">
        <h2 className="sf-h2">How to pay</h2>
        <div className="sf-prose">
          Cash, bank transfer or GCash to {COMPANY.phone}, or a check payable to {COMPANY.name}. Please quote {invoice.reference} with your payment.
        </div>
      </section>
    </>
  );
}

function ReceiptBody({ payment, client, quote, invoice, payments }) {
  const forWhat = payment.kind === "DEPOSIT"
    ? `Down payment on quotation ${quote?.reference || ""}`
    : `Payment on invoice ${invoice?.reference || ""}`;
  // As it stood when this payment was taken, so a reprint of an old receipt
  // doesn't show later payments.
  const upToThis = payments.filter((entry) => !entry.createdAt || !payment.createdAt || entry.createdAt <= payment.createdAt);
  const after = payment.kind === "PAYMENT" && invoice ? invoiceBalance(invoice, upToThis) : null;
  const method = [PAYMENT_METHOD_LABELS[payment.method],
    payment.method === "CHECK" ? `check no. ${payment.checkNumber}${payment.checkBank ? `, ${payment.checkBank}` : ""}${payment.checkDate ? `, dated ${formatDate(payment.checkDate)}` : ""}` : payment.referenceNo ? `ref. ${payment.referenceNo}` : ""]
    .filter(Boolean).join(" · ");
  return (
    <>
      <div className="bd-amount">
        <div className="bd-amount-cap">Amount received</div>
        <div className="bd-amount-value">{formatPeso(payment.amount)}</div>
      </div>
      <table className="sf-meta">
        <tbody>
          <Row label="Received from" value={clientLine(client)} />
          <Row label="Date paid" value={formatDate(payment.paidOn)} />
          <Row label="Payment method" value={method} />
          <Row label="For" value={forWhat.trim()} />
          {after && <Row label="Balance after this payment" value={formatPeso(after.balance)} />}
          <Row label="Received by" value={payment.receivedByName} />
        </tbody>
      </table>
      {payment.reversedAt && <p className="bd-void">REVERSED — {payment.reversalReason}</p>}
      {payment.method === "CHECK" && payment.checkStatus !== "CLEARED" && !payment.reversedAt && (
        <section className="sf-block"><div className="sf-prose">Payment by check is subject to clearing.{payment.checkStatus === "BOUNCED" ? " This check was returned unpaid." : ""}</div></section>
      )}
      <section className="sf-sign">
        <div className="sf-sign-grid">
          <div className="sf-sign-box sf-sign-blank"><div className="sf-sign-rule" /><div className="sf-sign-name">{payment.receivedByName}</div><div className="sf-sign-cap">Received by</div></div>
        </div>
      </section>
      <section className="sf-block"><div className="sf-prose bd-fine">This acknowledges payment received. It is not a BIR official receipt.</div></section>
    </>
  );
}

/**
 * kind QUOTE:   { quote, client, payments }
 * kind INVOICE: { invoice, client, quote?, payments, visits }
 * kind RECEIPT: { payment, client, quote?, invoice?, payments }
 */
function BillingDocument({ kind, client, quote = null, invoice = null, payment = null, payments = [], visits = [] }) {
  if (!client) return null;
  const reference = kind === "QUOTE" ? quote?.reference : kind === "INVOICE" ? invoice?.reference : payment?.reference;
  if (!reference) return null;
  return (
    <div className="service-form billing-document">
      <Letterhead kind={kind} reference={reference} />
      {kind === "QUOTE" && <QuoteBody quote={quote} client={client} payments={payments} />}
      {kind === "INVOICE" && <InvoiceBody invoice={invoice} client={client} quote={quote} payments={payments} visits={visits} />}
      {kind === "RECEIPT" && <ReceiptBody payment={payment} client={client} quote={quote} invoice={invoice} payments={payments} />}
      <footer className="sf-foot">
        {COMPANY.name} · {TITLES[kind]} {reference} · Printed {formatDateTime(new Date().toISOString())}
      </footer>
    </div>
  );
}

export default BillingDocument;
