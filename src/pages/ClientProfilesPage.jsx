import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

function ClientProfilesPage({ clients }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");

  const filteredClients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return clients;

    return clients.filter((client) => {
      const searchable = `${client.name} ${client.phone || ""} ${client.email || ""}`.toLowerCase();
      return searchable.includes(term);
    });
  }, [clients, searchTerm]);

  const selectedClient = filteredClients.find((client) => client.id === selectedClientId) || filteredClients[0] || clients[0];

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.75rem" }}>
          Client Management
        </p>
        <h1 style={{ margin: "0.2rem 0 0", fontSize: "2rem", color: "#111827" }}>Client Profile Search</h1>
      </div>

      <div style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: "16px", padding: "1rem 1.25rem", boxShadow: "0 12px 22px rgba(15, 23, 42, 0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <label style={{ display: "block", fontWeight: 700, color: "#374151", marginBottom: "0.5rem", flex: 1 }}>Search client</label>
          <Link
            to="/clients/new"
            style={{ border: "none", background: "#8b1e1e", color: "#fff", borderRadius: "10px", padding: "0.7rem 1rem", fontWeight: 700, cursor: "pointer", textDecoration: "none" }}
          >
            Create Client Profile
          </Link>
        </div>

        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by name, phone, or email"
          style={{ width: "100%", border: "1px solid #d7d7d7", borderRadius: "10px", padding: "0.8rem 0.9rem", fontSize: "0.96rem" }}
        />

        {filteredClients.length > 0 && (
          <div style={{ marginTop: "0.8rem", display: "grid", gap: "0.5rem" }}>
            {filteredClients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => setSelectedClientId(client.id)}
                style={{
                  textAlign: "left",
                  border: selectedClient?.id === client.id ? "1px solid #8b1e1e" : "1px solid #ececec",
                  background: selectedClient?.id === client.id ? "#fef2f2" : "#ffffff",
                  borderRadius: "12px",
                  padding: "0.8rem 1rem",
                  cursor: "pointer",
                  color: "#111827",
                }}
              >
                <div style={{ fontWeight: 700 }}>{client.name}</div>
                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{client.phone || "No phone provided"} • {client.email || "No email provided"}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedClient ? (
        <div style={{ marginTop: "1.5rem", background: "#fff", borderRadius: "16px", border: "1px solid #ebebeb", padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#111827" }}>{selectedClient.name}</h2>
              <p style={{ margin: "0.35rem 0 0", color: "#6b7280" }}>{selectedClient.classification}</p>
            </div>
            <Link
              to={`/clients/${selectedClient.id}`}
              style={{
                textDecoration: "none",
                background: "#8b1e1e",
                color: "#fff",
                borderRadius: "10px",
                padding: "0.72rem 1rem",
                fontWeight: 700,
              }}
            >
              View Full Profile
            </Link>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            <InfoRow label="Phone" value={selectedClient.phone} />
            <InfoRow label="Email" value={selectedClient.email} />
            <InfoRow label="Address" value={selectedClient.address} />
            <InfoRow label="Source" value={selectedClient.source || "—"} />
          </div>

          <div style={{ marginTop: "1.5rem", padding: "1.25rem", background: "#fafafa", borderRadius: "12px", border: "1px solid #f1f1f1", color: "#6b7280" }}>
            History will be available in a future sprint. For Sprint 1, this client profile focuses on basic profile details and attached documents.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "1.5rem", background: "#fff", border: "1px solid #ebebeb", borderRadius: "16px", padding: "1.5rem", color: "#6b7280" }}>
          No client matches your search.
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ background: "#fafafa", borderRadius: "12px", padding: "0.85rem 1rem", border: "1px solid #f1f1f1" }}>
      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#111827" }}>{value || "—"}</div>
    </div>
  );
}

export default ClientProfilesPage;
