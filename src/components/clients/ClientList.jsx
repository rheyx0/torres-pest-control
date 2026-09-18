// Client rows.
//
// Sprint AC: "List displays all client profiles with key info (name,
// classification, contact)" — classification was missing from the rows, it
// only appeared in the selected-client panel.
//
// Clicking a row navigates straight to the detail view. The old page needed
// two clicks: one to select, another on a separate "View Full Profile" link.

import { Link } from "react-router-dom";
import EmptyState from "../common/EmptyState";
import { humanizeEnum } from "../../utils/formatters";
import { badge, colors } from "../../styles/theme";

function ClientList({ clients, emptyMessage = "No client matches your search." }) {
  if (clients.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div style={{ background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "18px", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)", overflow: "hidden" }}>
      {clients.map((client) => (
        <Link
          key={client.id}
          to={`/clients/${client.id}`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
            textDecoration: "none",
            borderTop: "1px solid #f1f5f9",
            background: "#ffffff",
            padding: "1rem 1.25rem",
            color: colors.body,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {client.reference && <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.72rem", fontWeight: 700, color: "#475569", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.1rem 0.4rem", whiteSpace: "nowrap" }}>{client.reference}</span>}
              <span style={{ fontWeight: 700 }}>{client.name || "(unnamed client)"}</span>
            </div>
            <div style={{ fontSize: "0.85rem", color: colors.muted, marginTop: "0.15rem" }}>
              {client.phone || "No phone"} • {client.email || "No email"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {client.status === "ARCHIVED" && (
              <span style={{ ...badge, background: "#fef2f2", color: "#b91c1c" }}>Archived</span>
            )}
            <span style={badge}>{humanizeEnum(client.classification)}</span>
            {client.documents?.length > 0 && (
              <span style={{ ...badge, background: "#f1f5f9", color: "#475569" }}>
                {client.documents.length} doc{client.documents.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default ClientList;
