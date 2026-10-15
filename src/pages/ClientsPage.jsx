// Client list + search route.
//
// A real table rather than padded card rows: name and reference, address,
// last and next visit, pest concern and status, every column sortable and
// 50 rows a page. The old rows fit about eleven clients on a screen.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import ClientSearch from "../components/clients/ClientSearch";
import Button from "../components/ui/Button";
import DataTable from "../components/ui/DataTable";
import StatusPill from "../components/ui/StatusPill";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import { useScheduling } from "../context/SchedulingContext";
import { SUBSYSTEMS } from "../utils/permissions";
import { visitDatesByClient } from "../utils/clientTimeline";
import { humanizeEnum } from "../utils/formatters";
import { sharedClientEmails } from "../utils/validators";
import { neutral, radius, surface, weight } from "../styles/tokens";
import { colors, pageShell } from "../styles/theme";
import Skeleton from "../components/ui/Skeleton";

export const CLIENT_PAGE_SIZE = 50;

const dateCell = (value, empty) =>
  value ? (
    <span style={{ whiteSpace: "nowrap" }}>{new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
  ) : (
    <span style={{ color: neutral.bark }}>{empty}</span>
  );

function ClientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { clients, filter, loading, error } = useClients();
  const { appointments } = useScheduling();
  const [searchTerm, setSearchTerm] = useState("");
  const [classification, setClassification] = useState("ALL");
  // Archived clients are kept out of the default view (they're inactive
  // records, not deleted ones) but stay one dropdown away.
  const [status, setStatus] = useState("ACTIVE");
  const [limit, setLimit] = useState(CLIENT_PAGE_SIZE);

  const visibleClients = filter({ searchTerm, classification, status });
  const dates = useMemo(() => visitDatesByClient(appointments), [appointments]);
  const sharedEmails = useMemo(() => sharedClientEmails(clients), [clients]);
  const rows = visibleClients.map((client) => ({ ...client, lastVisit: dates.get(client.id)?.last || null, nextVisit: dates.get(client.id)?.next || null }));
  const shown = rows.slice(0, limit);

  const columns = [
    {
      key: "name",
      label: "Client",
      sortable: true,
      render: (row) => (
        <span>
          <Link to={`/clients/${row.id}`} onClick={(event) => event.stopPropagation()} style={{ color: neutral.ink, fontWeight: weight.medium, textDecoration: "none" }}>
            {row.name}
          </Link>
          <span style={{ display: "block", fontSize: "12px", color: neutral.bark }}>
            {[row.reference, row.classification && (row.classification === "OTHER" && row.classificationOther ? row.classificationOther : humanizeEnum(row.classification))]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      ),
    },
    { key: "address", label: "Address", sortable: true, render: (row) => <span style={{ color: neutral.saddle }}>{row.address || "—"}</span> },
    { key: "lastVisit", label: "Last visit", sortable: true, render: (row) => dateCell(row.lastVisit, "Never") },
    { key: "nextVisit", label: "Next visit", sortable: true, render: (row) => dateCell(row.nextVisit, "Not booked") },
    { key: "pestConcern", label: "Pest concern", sortable: true, render: (row) => row.pestConcern || <span style={{ color: neutral.bark }}>—</span> },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => <StatusPill tone={row.status === "ARCHIVED" ? "neutral" : "success"}>{row.status === "ARCHIVED" ? "Archived" : "Active"}</StatusPill>,
    },
  ];

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Operations"
        title="Clients"
        description={`${clients.length} ${clients.length === 1 ? "client" : "clients"}`}
        actions={
          can(SUBSYSTEMS.CLIENTS, "create") && (
            <Link
              to="/clients/new"
              className="ui-interactive"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                minHeight: "34px",
                padding: "0 14px",
                borderRadius: radius.control,
                border: `1px solid ${neutral.ink}`,
                color: neutral.ink,
                textDecoration: "none",
                fontSize: "13.5px",
                fontWeight: weight.medium,
              }}
            >
              <Plus size={15} aria-hidden="true" /> Add client
            </Link>
          )
        }
      />

      {sharedEmails.length > 0 && (
        <div role="alert" style={{ marginBottom: "14px", padding: "10px 14px", border: `1px solid ${colors.line}`, borderLeft: `3px solid ${colors.danger}`, borderRadius: radius.card, background: surface.panel, fontSize: "13.5px", color: colors.body }}>
          <strong style={{ fontWeight: weight.medium, color: colors.ink }}>
            {sharedEmails.length === 1 ? "One email is" : `${sharedEmails.length} emails are`} shared by more than one client.
          </strong>{" "}
          Quotes and invoices are emailed, so give each client their own:
          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
            {sharedEmails.map((entry) => (
              <li key={entry.email}>
                {entry.email}: {entry.clients.map((owner, index) => (
                  <span key={owner.id}>
                    {index > 0 && ", "}
                    <Link to={`/clients/${owner.id}`} style={{ color: colors.brandInk }}>{owner.name}{owner.reference ? ` (${owner.reference})` : ""}</Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section style={{ background: surface.panel, border: `1px solid ${colors.line}`, borderRadius: radius.card, overflow: "hidden" }}>
        <ClientSearch
          searchTerm={searchTerm}
          onSearchChange={(value) => {
            setSearchTerm(value);
            setLimit(CLIENT_PAGE_SIZE);
          }}
          classification={classification}
          onClassificationChange={setClassification}
          status={status}
          onStatusChange={setStatus}
        />

        {error ? (
          <p style={{ margin: 0, padding: "16px 18px", color: colors.danger }}>Could not load clients — {error}</p>
        ) : loading && clients.length === 0 ? (
          <Skeleton label="Loading clients…" lines={6} />
        ) : (
          <DataTable
            caption="Clients"
            columns={columns}
            rows={shown}
            initialSort={{ key: "name", direction: "asc" }}
            onRowClick={(row) => navigate(`/clients/${row.id}`)}
            empty="No clients match these filters."
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 18px", borderTop: `1px solid ${colors.line}`, color: neutral.bark, fontSize: "12.5px" }}>
          Showing {shown.length} of {rows.length}
          {rows.length !== clients.length ? ` (filtered from ${clients.length})` : ""}
          {shown.length < rows.length && (
            <Button size="sm" variant="quiet" onClick={() => setLimit((value) => value + CLIENT_PAGE_SIZE)}>
              Show {Math.min(CLIENT_PAGE_SIZE, rows.length - shown.length)} more
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

export default ClientsPage;
