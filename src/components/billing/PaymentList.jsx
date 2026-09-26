// Payments received, with what can still happen to each (Sprint 3):
//   a check      Pending -> Cleared (now counts) or Bounced (never counts)
//   any payment  Reversed by an admin, with a reason — never deleted.
// Each asks for its reason inline rather than stacking another dialog.

import { useState } from "react";
import { Button, Input, StatusPill } from "../ui";
import { colors } from "../../styles/theme";
import { PAYMENT_METHOD_LABELS } from "../../utils/constants";
import { formatDate, formatPeso } from "../../utils/formatters";

/** The word shown for a payment's state. */
export function paymentState(payment) {
  if (payment.reversedAt) return "Reversed";
  if (payment.method === "CHECK" && payment.checkStatus === "PENDING") return "Pending check";
  if (payment.method === "CHECK" && payment.checkStatus === "BOUNCED") return "Bounced";
  return "Received";
}

function PaymentRow({ payment, label, canReverse, onCheck, onReverse, onReceipt }) {
  const [asking, setAsking] = useState(null); // "BOUNCED" | "REVERSE"
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = paymentState(payment);

  const act = async (call) => {
    setBusy(true);
    setError("");
    const result = await call();
    setBusy(false);
    if (result === true || (result && typeof result === "object")) {
      setAsking(null);
      setReason("");
    } else setError(typeof result === "string" ? result : "That did not save.");
  };

  return (
    <li style={{ display: "grid", gap: "0.4rem", padding: "0.6rem 0", borderTop: `1px solid ${colors.line}` }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ color: colors.ink, fontVariantNumeric: "tabular-nums" }}>{formatPeso(payment.amount)}</strong>
        <span style={{ color: colors.body, fontSize: "0.85rem" }}>
          {label ? `${label} · ` : ""}{PAYMENT_METHOD_LABELS[payment.method]}
          {payment.method === "CHECK" ? ` #${payment.checkNumber}${payment.checkBank ? `, ${payment.checkBank}` : ""}` : payment.referenceNo ? ` · ${payment.referenceNo}` : ""}
          {" · "}{formatDate(payment.paidOn)} · {payment.reference}
        </span>
        <StatusPill status={state} />
        <span style={{ marginLeft: "auto", display: "flex", gap: "0.3rem" }}>
          {state === "Pending check" && !asking && (
            <>
              <Button size="sm" onClick={() => act(() => onCheck(payment, "CLEARED"))} loading={busy}>Cleared</Button>
              <Button size="sm" variant="quiet" onClick={() => setAsking("BOUNCED")}>Bounced</Button>
            </>
          )}
          {onReceipt && !asking && <Button size="sm" variant="ghost" onClick={() => onReceipt(payment)}>Receipt</Button>}
          {canReverse && !payment.reversedAt && !asking && (
            <Button size="sm" variant="quiet" onClick={() => setAsking("REVERSE")}>Reverse</Button>
          )}
        </span>
      </div>
      {payment.reversedAt && <span style={{ color: colors.muted, fontSize: "0.8rem" }}>Reversed: {payment.reversalReason}</span>}
      {payment.checkStatus === "BOUNCED" && <span style={{ color: colors.danger, fontSize: "0.8rem" }}>Bounced {formatDate(payment.checkStatusOn)}: {payment.checkStatusNote}</span>}
      {asking && (
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          <Input
            aria-label={asking === "REVERSE" ? "Reason for reversing" : "Why the check bounced"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={asking === "REVERSE" ? "Why is this payment being reversed?" : "Why did the check bounce?"}
            style={{ flex: "1 1 240px" }}
          />
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            disabled={!reason.trim()}
            onClick={() => act(() => (asking === "REVERSE" ? onReverse(payment, reason.trim()) : onCheck(payment, "BOUNCED", reason.trim())))}
          >
            {asking === "REVERSE" ? "Reverse payment" : "Mark bounced"}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => { setAsking(null); setReason(""); }}>Cancel</Button>
        </div>
      )}
      {error && <span role="alert" style={{ color: colors.danger, fontSize: "0.8rem", fontWeight: 500 }}>{error}</span>}
    </li>
  );
}

function PaymentList({ payments, labelFor, canReverse, onCheck, onReverse, onReceipt, empty = "No payments yet." }) {
  if (payments.length === 0) return <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>{empty}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {payments.map((payment) => (
        <PaymentRow key={payment.id} payment={payment} label={labelFor?.(payment)} canReverse={canReverse} onCheck={onCheck} onReverse={onReverse} onReceipt={onReceipt} />
      ))}
    </ul>
  );
}

export default PaymentList;
