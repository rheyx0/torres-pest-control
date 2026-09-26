// One service contract (Sprint 3, migration 063) and what can happen next:
//
//   Draft      Edit · Upload signed copy · Activate (needs the signed copy) · Delete
//   Active     Book visits (as a recurring plan) · End · Cancel with a reason
//   Ended / Cancelled   read only
//
// Cancelling cancels the visits still to come on its plan.

import { useRef, useState } from "react";
import { Button, Input, Modal, StatusPill } from "../ui";
import { colors } from "../../styles/theme";
import { BILLING_SCHEDULES, CONTRACT_STATUS_LABELS, PAYMENT_TERMS } from "../../utils/constants";
import { appointmentReference } from "../../utils/scheduling";
import { formatDate, formatPeso } from "../../utils/formatters";
import { validateDocument } from "../../utils/validators";

export const CONTRACT_TONES = { DRAFT: "neutral", ACTIVE: "success", ENDED: "neutral", CANCELLED: "danger" };

const labelOf = (list, value) => list.find((entry) => entry.value === value)?.label || value;

function ContractDetail({ contract, client, signedDocument = null, visits = [], onEdit, onUploadSigned, onViewSigned, onActivate, onEnd, onCancel, onDelete, onBook, onClose }) {
  const fileRef = useRef(null);
  const [asking, setAsking] = useState(null); // "CANCEL" | "DELETE"
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (call) => {
    setBusy(true);
    setError("");
    const result = await call();
    setBusy(false);
    if (typeof result === "string") setError(result);
    else setAsking(null);
    return result;
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = validateDocument(file);
    if (problem) {
      setError(problem);
      return;
    }
    await act(() => onUploadSigned(file));
  };

  const { status } = contract;
  const done = visits.filter((visit) => visit.status === "Completed").length;
  const live = visits.filter((visit) => visit.status !== "Cancelled").length;

  const footer = (
    <>
      {error && <span role="alert" style={{ marginRight: "auto", alignSelf: "center", color: colors.danger, fontSize: "0.85rem", fontWeight: 500 }}>{error}</span>}
      {asking === "CANCEL" && (
        <>
          <Input aria-label="Why the contract is cancelled" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is the contract being cancelled?" style={{ flex: "1 1 260px" }} />
          <Button variant="quiet" onClick={() => { setAsking(null); setReason(""); }}>Keep</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => act(() => onCancel(reason.trim()))}>Cancel contract</Button>
        </>
      )}
      {asking === "DELETE" && (
        <>
          <span style={{ marginRight: "auto", alignSelf: "center", color: colors.danger }}>Delete this draft for good?</span>
          <Button variant="quiet" onClick={() => setAsking(null)}>Keep</Button>
          <Button variant="danger" loading={busy} onClick={() => act(onDelete)}>Delete draft</Button>
        </>
      )}
      {!asking && status === "DRAFT" && (
        <>
          <Button variant="quiet" onClick={() => setAsking("DELETE")}>Delete</Button>
          <Button variant="quiet" onClick={() => setAsking("CANCEL")}>Cancel</Button>
          <Button onClick={onEdit}>Edit</Button>
          <Button variant="primary" loading={busy} disabled={!contract.signedDocumentId} title={contract.signedDocumentId ? undefined : "Upload the signed copy first."} onClick={() => act(onActivate)}>Activate</Button>
        </>
      )}
      {!asking && status === "ACTIVE" && (
        <>
          <Button variant="quiet" onClick={() => setAsking("CANCEL")}>Cancel contract</Button>
          <Button onClick={() => act(onEnd)} loading={busy}>Mark ended</Button>
          {!contract.planId && <Button variant="primary" onClick={onBook}>Book visits</Button>}
        </>
      )}
    </>
  );

  const row = (label, value) => (
    <>
      <dt style={{ color: colors.muted }}>{label}</dt>
      <dd style={{ margin: 0, color: colors.ink }}>{value || "—"}</dd>
    </>
  );

  return (
    <Modal title={`${contract.reference} · ${client?.name || "Client"}`} eyebrow="Service contract" size="lg" onClose={onClose} footer={footer}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ color: colors.ink }}>{contract.title}</strong>
          <StatusPill tone={CONTRACT_TONES[status]} status={CONTRACT_STATUS_LABELS[status]} />
        </div>
        {status === "CANCELLED" && <p style={{ margin: 0, color: colors.danger }}>Cancelled {formatDate(contract.cancelledAt)}: {contract.cancellationReason}</p>}

        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.35rem 1.25rem", fontSize: "0.88rem" }}>
          {row("Services", contract.serviceNames)}
          {row("How often", contract.frequency)}
          {row("Period", `${formatDate(contract.startsOn)} – ${contract.endsOn ? formatDate(contract.endsOn) : `${contract.visitCount} visits`}`)}
          {row("Price per visit", formatPeso(contract.pricePerVisit))}
          {contract.visitCount ? row("Contract value", formatPeso(contract.visitCount * contract.pricePerVisit)) : null}
          {row("Billed", labelOf(BILLING_SCHEDULES, contract.billingSchedule))}
          {row("Payment terms", labelOf(PAYMENT_TERMS, contract.paymentTerms))}
          {row("Included", contract.inclusions)}
          {row("Cancellation", contract.cancellationTerms)}
          {contract.notes ? row("Notes", contract.notes) : null}
        </dl>

        <section aria-label="Signed copy" style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", padding: "0.7rem 0.8rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px" }}>
          <span style={{ color: colors.body, fontSize: "0.88rem", marginRight: "auto" }}>
            {signedDocument ? <>Signed copy: <strong style={{ color: colors.ink }}>{signedDocument.name}</strong></> : contract.signedDocumentId ? "Signed copy on file." : "No signed copy yet. Upload the contract the client signed (PDF or photo)."}
          </span>
          {signedDocument && <Button size="sm" variant="ghost" onClick={onViewSigned}>View</Button>}
          {(status === "DRAFT" || status === "ACTIVE") && (
            <>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={upload} style={{ display: "none" }} aria-label="Signed contract file" />
              <Button size="sm" loading={busy && !asking} onClick={() => fileRef.current?.click()}>{contract.signedDocumentId ? "Replace signed copy" : "Upload signed copy"}</Button>
            </>
          )}
        </section>

        {contract.planId ? (
          <section aria-label="Visits under this contract">
            <h3 style={{ margin: "0 0 0.3rem", fontSize: "0.95rem", color: colors.ink }}>Visits · {done} of {live} done</h3>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", color: colors.body, fontSize: "0.88rem" }}>
              {visits.map((visit) => <li key={visit.id}>{appointmentReference(visit)} · {formatDate(visit.scheduledAt)} · {visit.status}</li>)}
            </ul>
          </section>
        ) : status === "ACTIVE" ? (
          <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>No visits booked yet. "Book visits" opens the booking form with the contract's services, frequency and price.</p>
        ) : null}
      </div>
    </Modal>
  );
}

export default ContractDetail;
