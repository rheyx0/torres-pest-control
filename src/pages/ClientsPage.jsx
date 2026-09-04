// Client list + search route.

import { useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import ClientSearch from "../components/clients/ClientSearch";
import ClientList from "../components/clients/ClientList";
import EmptyState from "../components/common/EmptyState";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import { SUBSYSTEMS } from "../utils/permissions";
import { card, pageShell, primaryButton } from "../styles/theme";

function ClientsPage() {
  const { can } = useAuth();
  const { clients, filter, loading, error } = useClients();
  const [searchTerm, setSearchTerm] = useState("");
  const [classification, setClassification] = useState("ALL");

  // Filtering is a pure function in clientService, so an empty result is
  // genuinely empty. The old page fell back to `|| clients[0]`, which made
  // the "no match" state unreachable and showed an unrelated client instead.
  const visibleClients = filter({ searchTerm, classification });

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Client Management"
        title="Client Profiles"
        actions={
          can(SUBSYSTEMS.CLIENTS, "create") && (
            <Link to="/clients/new" style={{ ...primaryButton, textDecoration: "none", display: "inline-block" }}>
              Create Client Profile
            </Link>
          )
        }
      />

      <div style={{ ...card, marginBottom: "1.25rem" }}>
        <ClientSearch
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          classification={classification}
          onClassificationChange={setClassification}
        />
        <div style={{ marginTop: "0.75rem", color: "#6b7280", fontSize: "0.86rem" }}>
          Showing {visibleClients.length} of {clients.length} client
          {clients.length === 1 ? "" : "s"}.
        </div>
      </div>

      {error ? (
        <EmptyState message={`Could not load clients — ${error}`} />
      ) : loading ? (
        <EmptyState message="Loading clients…" />
      ) : (
        <ClientList clients={visibleClients} />
      )}
    </div>
  );
}

export default ClientsPage;
