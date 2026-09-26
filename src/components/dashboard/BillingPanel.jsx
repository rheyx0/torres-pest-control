// The office's money at a glance on the Today page (Sprint 3).
//
// One connected bar: what came in this month, what is owed and not yet due,
// and what is overdue, each segment as wide as its share. Under it the same
// three figures as a legend, then the loose ends — quotes waiting for an
// answer, down payments not in, checks not cleared, visits not billed.
// Figures from billingSummary() (utils/billing.js); nothing here queries.
//
// Renders nothing without billing (no provider, a technician, or before 061).

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { colors } from "../../styles/theme";
import { neutral, status as semantic } from "../../styles/tokens";
import { useScheduling } from "../../context/SchedulingContext";
import { useOptionalBilling } from "../../hooks/useBilling";
import { billingSummary } from "../../utils/billing";
import { peso, pesoCompact } from "../../utils/dashboardMetrics";
import { plural } from "../../utils/formatters";
import { Panel } from "./DashboardParts";

/** The bar's segments, in order, from a billingSummary(). Exported for tests. */
export function billingSegments(summary) {
  const notDue = Math.max(0, summary.outstanding.amount - summary.overdue.amount);
  return [
    { key: "collected", label: "Collected this month", amount: summary.collected.amount, note: plural(summary.collected.count, "payment"), color: semantic.success },
    { key: "due", label: "Owed, not yet due", amount: notDue, note: plural(Math.max(0, summary.outstanding.count - summary.overdue.count), "invoice"), color: "#c9a25e" },
    { key: "overdue", label: "Overdue", amount: summary.overdue.amount, note: plural(summary.overdue.count, "invoice"), color: semantic.danger },
  ];
}

function BillingPanel() {
  const billing = useOptionalBilling();
  const { appointments } = useScheduling();
  if (!billing || !billing.office || !billing.available) return null;

  const summary = billingSummary({ quotes: billing.quotes, invoices: billing.invoices, payments: billing.payments, appointments });
  const segments = billingSegments(summary);
  const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
  const loose = [
    summary.awaiting.count > 0 && { key: "awaiting", text: `${plural(summary.awaiting.count, "quote")} waiting for the client's answer`, amount: summary.awaiting.amount },
    summary.depositsDue.count > 0 && { key: "deposits", text: `${plural(summary.depositsDue.count, "down payment")} not yet received`, amount: summary.depositsDue.amount },
    summary.pendingChecks.count > 0 && { key: "checks", text: `${plural(summary.pendingChecks.count, "check")} waiting to clear`, amount: summary.pendingChecks.amount },
    billing.invoicesAvailable && summary.toInvoice.count > 0 && { key: "invoice", text: `${plural(summary.toInvoice.count, "completed visit")} not yet invoiced` },
  ].filter(Boolean);

  return (
    <Panel title="Billing" action={<Link to="/billing" style={{ color: colors.brand }}>Open billing</Link>}>
      <div
        role="img"
        aria-label={segments.map((segment) => `${segment.label} ${peso(segment.amount, { decimals: 2 })}`).join(", ")}
        style={{ display: "flex", height: "18px", borderRadius: "9px", overflow: "hidden", background: "#efe9e0" }}
      >
        {total > 0 && segments.filter((segment) => segment.amount > 0).map((segment) => (
          <span
            key={segment.key}
            title={`${segment.label}: ${peso(segment.amount, { decimals: 2 })}`}
            style={{ flex: `${segment.amount} 1 0`, minWidth: "6px", background: segment.color }}
          />
        ))}
      </div>
      {total === 0 && <p style={{ margin: 0, color: colors.muted, fontSize: "0.84rem" }}>No money in or owed yet this month.</p>}

      <div className="dash-joined" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {segments.map((segment) => (
          <div key={segment.key} style={{ background: "#fff", padding: "0.8rem 1rem", display: "grid", gap: "0.15rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.7rem", letterSpacing: "0.07em", textTransform: "uppercase", color: neutral.saddle }}>
              <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "3px", background: segment.color }} />
              {segment.label}
            </span>
            <span title={peso(segment.amount, { decimals: 2 })} style={{ fontSize: "1.45rem", fontWeight: 500, color: segment.key === "overdue" && segment.amount > 0 ? semantic.danger : colors.ink, fontVariantNumeric: "tabular-nums" }}>
              {pesoCompact(segment.amount)}
            </span>
            <span style={{ fontSize: "0.74rem", color: colors.muted }}>
              {segment.note}{total > 0 ? ` · ${Math.round((segment.amount / total) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>

      {loose.length > 0 && (
        <ul className="dash-joined" style={{ listStyle: "none", padding: 0 }}>
          {loose.map((entry) => (
            <li key={entry.key} style={{ background: "#fff" }}>
              <Link to="/billing" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.6rem 1rem", color: colors.body, textDecoration: "none", fontSize: "0.85rem" }}>
                <span style={{ flex: 1 }}>{entry.text}</span>
                {entry.amount !== undefined && <span style={{ color: colors.ink, fontVariantNumeric: "tabular-nums" }}>{pesoCompact(entry.amount)}</span>}
                <ArrowRight size={14} aria-hidden="true" style={{ color: neutral.bark }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default BillingPanel;
