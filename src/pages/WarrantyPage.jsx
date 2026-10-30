// Warranty route: every warranty in one place (quotations and contracts,
// migration 078), with what the adviser asked to see for each one:
//
//   Service     the paid job the warranty came with
//   Checkups    each checkup period with its checkup, or "Not booked"
//   Follow-ups  warranty re-treatments (free) and follow-up visits on the job
//
// The office books checkups and re-treatments from here too (WarrantyActions,
// the same buttons as on the quotation, the contract and the client profile).
// Quotes and contracts come from BillingContext, which loads for office
// accounts only, so the route is gated on Billing.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import { Card, Input, SegmentedControl, StatusPill } from "../components/ui";
import { StatTile, TileRow } from "../components/dashboard/DashboardParts";
import WarrantyActions from "../components/billing/WarrantyActions";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import useServices from "../hooks/useServices";
import useUsers from "../hooks/useUsers";
import { useOptionalBilling } from "../hooks/useBilling";
import { useScheduling } from "../context/SchedulingContext";
import { colors, pageShell } from "../styles/theme";
import { formatDate } from "../utils/formatters";
import { checkupLabel } from "../utils/categories";
import { SUBSYSTEMS } from "../utils/permissions";
import { appointmentReference, crewOf } from "../utils/scheduling";
import { allWarranties, checkupReminders, warrantyLabel, warrantyOverview, warrantyServiceIds, warrantyState } from "../utils/warranty";

const STATE_WORDS = { ACTIVE: "Under warranty", NOT_STARTED: "Not started", ENDED: "Ended" };
const STATE_TONES = { ACTIVE: "success", NOT_STARTED: "neutral", ENDED: "neutral" };
const FILTERS = [
  { value: "ACTIVE", word: "Under warranty" },
  { value: "NOT_STARTED", word: "Not started" },
  { value: "ENDED", word: "Ended" },
  { value: "ALL", word: "All" },
];

const sectionTitle = { margin: 0, fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: colors.muted, fontWeight: 500 };
const rowStyle = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "6px 0", borderTop: `1px solid ${colors.line}`, fontSize: "13px" };

function VisitRow({ visit, label, note, crewName, onOpen }) {
  return (
    <li style={rowStyle}>
      <button type="button" onClick={() => onOpen(visit)} title="Open this visit on the Schedule" style={{ border: 0, background: "none", padding: 0, font: "inherit", color: colors.ink, textDecoration: "underline", cursor: "pointer" }}>
        {appointmentReference(visit)}
      </button>
      {label && <span style={{ color: colors.ink }}>{label}</span>}
      <span style={{ color: colors.body }}>{formatDate(visit.scheduledAt)}</span>
      {note && <span style={{ color: colors.muted }}>{note}</span>}
      <span style={{ color: colors.muted }}>{crewName(visit)}</span>
      <span style={{ marginLeft: "auto" }}><StatusPill status={visit.status} /></span>
    </li>
  );
}

function Section({ title, empty, children, count }) {
  return (
    <div style={{ display: "grid", gap: "4px", alignContent: "start", minWidth: 0 }}>
      <h3 style={sectionTitle}>{title}{count ? ` · ${count}` : ""}</h3>
      {count ? <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{children}</ul> : <p style={{ margin: 0, padding: "6px 0", borderTop: `1px solid ${colors.line}`, fontSize: "13px", color: colors.muted }}>{empty}</p>}
    </div>
  );
}

function WarrantyCard({ warranty, appointments, clientName, serviceNames, crewName, technicians, canBook, onBook, onOpen, now }) {
  const state = warrantyState(warranty, now);
  const overview = warrantyOverview(warranty, appointments, now);
  const sourceLink = warranty.type === "CONTRACT" ? `/billing?contract=${warranty.id}` : `/billing?quote=${warranty.id}`;
  const covers = serviceNames(warranty);
  const booked = overview.periods.filter((entry) => entry.visit).length;
  const checkupCount = overview.periods.length + overview.extras.length;
  const followUpCount = overview.retreatments.length + overview.followUps.length;

  return (
    <Card padded={false}>
      <div style={{ display: "grid", gap: "12px", padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <ShieldCheck size={16} aria-hidden="true" style={{ color: state === "ACTIVE" ? "#2f6b3f" : colors.muted }} />
          <Link to={`/clients/${warranty.source.clientId}`} style={{ fontWeight: 600, color: colors.ink, textDecoration: "none" }}>{clientName(warranty.source.clientId)}</Link>
          <StatusPill tone={STATE_TONES[state]}>{STATE_WORDS[state]}</StatusPill>
          <Link to={sourceLink} style={{ color: colors.muted, fontSize: "12.5px" }}>
            {warranty.type === "CONTRACT" ? "Contract" : "Quotation"} {warranty.reference}
          </Link>
        </div>

        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "8px 16px", fontSize: "13px" }}>
          <div>
            <dt style={{ color: colors.muted, fontSize: "12px" }}>Warranty</dt>
            <dd style={{ margin: 0, color: colors.ink }}>
              {warrantyLabel(warranty.months)}
              {state === "NOT_STARTED"
                ? (warranty.type === "CONTRACT" ? " · starts when the contract is signed" : " · starts when the job is completed")
                : ` · ${formatDate(warranty.start)} – ${formatDate(warranty.end)}`}
            </dd>
          </div>
          <div>
            <dt style={{ color: colors.muted, fontSize: "12px" }}>Services covered</dt>
            <dd style={{ margin: 0, color: colors.ink }}>{covers || "—"}</dd>
          </div>
          <div>
            <dt style={{ color: colors.muted, fontSize: "12px" }}>Checkups</dt>
            <dd style={{ margin: 0, color: colors.ink }}>
              {warranty.frequency
                ? `${checkupLabel(warranty.frequency)} · ${overview.checkupsDone} of ${overview.checkupsPlanned} done · ${booked} booked`
                : "No checkups on this warranty"}
            </dd>
          </div>
          <div>
            <dt style={{ color: colors.muted, fontSize: "12px" }}>Next checkup</dt>
            <dd style={{ margin: 0, color: colors.ink }}>
              {overview.next ? `${formatDate(overview.next.scheduledAt)} (${appointmentReference(overview.next)})` : "None booked"}
            </dd>
          </div>
        </dl>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px 20px" }}>
          <Section title="Service" count={overview.service.length} empty={state === "NOT_STARTED" ? "No visit done yet." : "No service visit on file."}>
            {overview.service.map((visit) => (
              <VisitRow key={visit.id} visit={visit} label={visit.serviceType || ""} crewName={crewName} onOpen={onOpen} />
            ))}
          </Section>

          <Section title="Checkups" count={checkupCount} empty={warranty.frequency ? "Starts with the warranty." : "This warranty has no checkups."}>
            {overview.periods.map(({ period, visit }) => (visit ? (
              <VisitRow key={`p-${period.index}`} visit={visit} label={`Checkup ${period.index + 1}`} crewName={crewName} onOpen={onOpen} />
            ) : (
              <li key={`p-${period.index}`} style={rowStyle}>
                <span style={{ color: colors.ink }}>Checkup {period.index + 1}</span>
                <span style={{ color: colors.body }}>due {formatDate(period.from)} – {formatDate(period.to)}</span>
                <span style={{ marginLeft: "auto", color: colors.muted }}>Not booked</span>
              </li>
            )))}
            {overview.extras.map((visit) => (
              <VisitRow key={visit.id} visit={visit} label="Extra checkup" crewName={crewName} onOpen={onOpen} />
            ))}
          </Section>

          <Section title="Follow-ups" count={followUpCount} empty="No re-treatment or follow-up yet.">
            {overview.retreatments.map((visit) => (
              <VisitRow key={visit.id} visit={visit} label="Warranty re-treatment" note="free" crewName={crewName} onOpen={onOpen} />
            ))}
            {overview.followUps.map((visit) => (
              <VisitRow key={visit.id} visit={visit} label="Follow-up visit" crewName={crewName} onOpen={onOpen} />
            ))}
          </Section>
        </div>

        {canBook && state === "ACTIVE" && (
          <WarrantyActions warranty={warranty} appointments={appointments} technicians={technicians} onBook={onBook} now={now} />
        )}
      </div>
    </Card>
  );
}

function WarrantyPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const billing = useOptionalBilling();
  const { appointments, bookWarrantyVisits, loading } = useScheduling();
  const { clients } = useClients();
  const { serviceById } = useServices();
  const { users = [], technicians: technicianAccounts = [] } = useUsers();
  const [filter, setFilter] = useState("ACTIVE");
  const [search, setSearch] = useState("");
  const now = new Date();

  const quotes = billing?.quotes || [];
  const contracts = billing?.contracts || [];
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const clientName = (id) => clientById.get(id)?.name || "Unknown client";
  const personName = (id) => {
    const match = users.find((user) => user.id === id);
    return match?.name || match?.username || "";
  };
  const crewName = (visit) => crewOf(visit).map(personName).filter(Boolean).join(", ") || "Unassigned";
  const serviceNames = (warranty) => {
    const names = warrantyServiceIds(warranty).map((id) => serviceById?.(id)?.name).filter(Boolean);
    if (names.length) return [...new Set(names)].join(", ");
    // No catalog link: the contract's name snapshot, or the quotation's service lines.
    if (warranty.type === "CONTRACT") return warranty.source.serviceNames || "";
    return [...new Set((warranty.source.lines || []).filter((line) => line.kind === "SERVICE").map((line) => line.description).filter(Boolean))].join(", ");
  };
  const activeTechs = technicianAccounts.filter((account) => account.status !== "INACTIVE");
  const canBook = can(SUBSYSTEMS.SCHEDULING, "create") && Boolean(bookWarrantyVisits);

  const warranties = useMemo(
    () => allWarranties({ quotes, contracts, appointments }, now),
    // `now` is per render; the list only changes with the records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotes, contracts, appointments]
  );
  const needle = search.trim().toLowerCase();
  const matching = warranties.filter((warranty) => !needle
    || `${clientName(warranty.source.clientId)} ${warranty.reference} ${serviceNames(warranty)}`.toLowerCase().includes(needle));
  const counts = matching.reduce((tally, warranty) => {
    const state = warrantyState(warranty, now);
    return { ...tally, [state]: (tally[state] || 0) + 1 };
  }, {});
  const shown = matching.filter((warranty) => filter === "ALL" || warrantyState(warranty, now) === filter);

  const running = warranties.filter((warranty) => warrantyState(warranty, now) === "ACTIVE");
  const dueSoon = checkupReminders({ quotes, contracts, appointments }, now);
  const totals = running.reduce((sum, warranty) => {
    const overview = warrantyOverview(warranty, appointments, now);
    return {
      done: sum.done + overview.checkupsDone,
      planned: sum.planned + overview.checkupsPlanned,
      followUps: sum.followUps + overview.retreatments.length + overview.followUps.length,
    };
  }, { done: 0, planned: 0, followUps: 0 });

  const openVisit = (visit) => navigate(`/scheduling?appointment=${encodeURIComponent(visit.id)}`);

  if (!billing?.office) {
    return (
      <div style={pageShell}>
        <PageHeader eyebrow="Work" title="Warranty" />
        <Card><p style={{ margin: 0 }}>Warranties are kept with the office's quotations and contracts.</p></Card>
      </div>
    );
  }

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Work"
        title="Warranty"
        description="Every warranty with its service, checkups and follow-ups. Book checkups and free re-treatments while a warranty runs."
      />

      <div style={{ marginBottom: "1rem" }}>
        <TileRow min="170px">
          <StatTile label="Under warranty" tone="done" value={running.length} note={`${warranties.length} warrant${warranties.length === 1 ? "y" : "ies"} on file`} onClick={() => setFilter("ACTIVE")} />
          <StatTile label="Checkups due soon" tone={dueSoon.length ? "attn" : "plain"} value={dueSoon.length} note={dueSoon.length ? "Due within 7 days, not booked" : "Nothing to book this week"} />
          <StatTile label="Checkups done" value={`${totals.done} of ${totals.planned}`} note="On running warranties" />
          <StatTile label="Follow-ups" value={totals.followUps} note="Re-treatments and follow-up visits" />
        </TileRow>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <SegmentedControl
          ariaLabel="Warranty status"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map(({ value, word }) => {
            const count = value === "ALL" ? matching.length : counts[value] || 0;
            return {
              value,
              label: (
                <>
                  {word}
                  {count > 0 && <span aria-hidden="true" style={{ color: colors.muted, fontVariantNumeric: "tabular-nums" }}>{count}</span>}
                </>
              ),
            };
          })}
        />
        <Input aria-label="Search warranties" placeholder="Search client, reference or service" value={search} onChange={(event) => setSearch(event.target.value)} style={{ flex: "1 1 220px", maxWidth: "320px" }} />
      </div>

      {billing.error && <p role="alert" style={{ color: colors.danger }}>{billing.error}</p>}

      {loading || billing.loading ? (
        <Card><p style={{ margin: 0, color: colors.muted }}>Loading warranties…</p></Card>
      ) : shown.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: colors.muted }}>
            {warranties.length === 0
              ? "No warranties yet. Set a warranty on a quotation or contract in Billing, and it shows here."
              : "No warranty matches this filter."}
          </p>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {shown.map((warranty) => (
            <WarrantyCard
              key={`${warranty.type}-${warranty.id}`}
              warranty={warranty}
              appointments={appointments}
              clientName={clientName}
              serviceNames={serviceNames}
              crewName={crewName}
              technicians={activeTechs}
              canBook={canBook}
              onBook={bookWarrantyVisits}
              onOpen={openVisit}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default WarrantyPage;
