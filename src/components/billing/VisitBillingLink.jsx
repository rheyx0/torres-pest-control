// What a visit is billed under (Sprint 3): the quote it was booked from, or
// the contract whose plan it belongs to. A visit booked straight from the
// Schedule has neither; the office can link it here afterwards, as it can in
// the booking form. Only an approved quote whose down payment is in can take
// it (the server's rule), and a contract only a visit in a recurring plan.
//
// Office only, and only once billing is set up — renders nothing otherwise.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Select } from "../ui";
import { colors } from "../../styles/theme";
import { canBookFromQuote } from "../../utils/billing";
import { formatPeso } from "../../utils/formatters";
import { SUBSYSTEMS } from "../../utils/permissions";
import useAuth from "../../hooks/useAuth";
import { useOptionalBilling } from "../../hooks/useBilling";

function VisitBillingLink({ appointment }) {
  const { can } = useAuth();
  const billing = useOptionalBilling();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!billing?.office || !billing.available || !can(SUBSYSTEMS.BILLING, "view")) return null;

  const quote = billing.quoteById(appointment.quoteId);
  const contract = appointment.planId ? (billing.contracts || []).find((entry) => entry.planId === appointment.planId) : null;

  const box = (children) => (
    <section aria-label="Billing link" style={{ display: "grid", gap: "0.4rem", padding: "0.7rem 0.8rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px" }}>
      {children}
    </section>
  );

  if (quote || contract) {
    return box(
      <span style={{ fontSize: "0.88rem", color: colors.body }}>
        {quote && <>Booked from quote <Link to={`/billing?quote=${quote.id}`} style={{ color: colors.brand }}>{quote.reference}</Link></>}
        {quote && contract && " · "}
        {contract && <>Part of contract <Link to={`/billing?contract=${contract.id}`} style={{ color: colors.brand }}>{contract.reference}</Link></>}
      </span>
    );
  }

  const canLink = can(SUBSYSTEMS.BILLING, "edit") && appointment.status !== "Cancelled" && !appointment.invoiceId;
  const quotes = billing.quotes
    .filter((entry) => entry.clientId === appointment.clientId && entry.status === "APPROVED")
    .map((entry) => ({ entry, check: canBookFromQuote(entry, billing.paymentsForQuote(entry.id)) }));
  const contracts = appointment.planId
    ? (billing.contracts || []).filter((entry) => entry.clientId === appointment.clientId && entry.status === "ACTIVE" && !entry.planId)
    : [];

  const link = async () => {
    const [type, id] = choice.split(":");
    setBusy(true);
    setError("");
    const result = type === "contract"
      ? await billing.linkContractPlan(id, appointment.id)
      : await billing.linkQuoteAppointments(id, [appointment.id]);
    setBusy(false);
    if (typeof result === "string") setError(result);
    else setChoice("");
  };

  return box(
    <>
      <span style={{ fontSize: "0.88rem", color: colors.warning }}>
        Not linked to a quote or contract{appointment.invoiceId ? "." : ": no down payment was collected, and it is billed from its price."}
      </span>
      {canLink && (quotes.length > 0 || contracts.length > 0) && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          <Select aria-label="Link to quote or contract" value={choice} onChange={(event) => setChoice(event.target.value)} style={{ flex: "1 1 220px" }}>
            <option value="">Choose a quote or contract</option>
            {quotes.length > 0 && (
              <optgroup label="Approved quotes">
                {quotes.map(({ entry, check }) => (
                  <option key={entry.id} value={`quote:${entry.id}`} disabled={!check.ok}>
                    {entry.reference} · {formatPeso(entry.total)}{check.ok ? "" : ` — ${check.reason}`}
                  </option>
                ))}
              </optgroup>
            )}
            {contracts.length > 0 && (
              <optgroup label="Active contracts">
                {contracts.map((entry) => <option key={entry.id} value={`contract:${entry.id}`}>{entry.reference} · {entry.title}</option>)}
              </optgroup>
            )}
          </Select>
          <Button size="sm" loading={busy} disabled={!choice} onClick={link}>Link</Button>
        </div>
      )}
      {error && <span role="alert" style={{ color: colors.danger, fontSize: "0.8rem", fontWeight: 500 }}>{error}</span>}
    </>
  );
}

export default VisitBillingLink;
