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
    <div style={{ display: "grid", gap: "0.6rem" }}>
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
            border: "1px solid #ececec",
            background: "#ffffff",
            borderRadius: "12px",
            padding: "0.9rem 1rem",
            color: colors.body,
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>{client.name || "(unnamed client)"}</div>
            <div style={{ fontSize: "0.85rem", color: colors.muted, marginTop: "0.15rem" }}>
              {client.phone || "No phone"} • {client.email || "No email"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
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
