// Staff view.
//
// Sprint AC (Login): "User is redirected to the appropriate dashboard based
// on role." Staff work with clients, so the dashboard leads with client
// counts and shortcuts — no account metrics, which staff cannot act on.

import { Link } from "react-router-dom";
import { BriefcaseBusiness, FilePlus2, Search } from "lucide-react";
import MetricCard from "../common/MetricCard";
import PageHeader from "../common/PageHeader";
import useAuth from "../../hooks/useAuth";
import useClients from "../../hooks/useClients";
import { card, colors, pageShell, primaryButton } from "../../styles/theme";

function StaffDashboard() {
  const { currentUser } = useAuth();
  const { clients } = useClients();

  const documentCount = clients.reduce(
    (total, client) => total + (client.documents?.length || 0),
    0
  );

  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Overview" title={`Welcome back, ${currentUser?.name || "there"}`} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <MetricCard
          title="Total Clients"
          value={clients.length}
          accent={`linear-gradient(135deg, ${colors.brand} 0%, #b43d3d 100%)`}
          Icon={BriefcaseBusiness}
        />
        <MetricCard
          title="Attached Documents"
          value={documentCount}
          accent="linear-gradient(135deg, #374151 0%, #64748b 100%)"
          Icon={FilePlus2}
        />
      </div>

      <div style={card}>
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", color: colors.ink }}>Quick actions</h2>
        <p style={{ margin: "0 0 1.25rem", color: colors.muted }}>
          Register a new client or look up an existing profile.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link to="/clients/new" style={{ ...primaryButton, textDecoration: "none", display: "inline-block" }}>
            Create Client Profile
          </Link>
          <Link
            to="/clients"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              border: `1px solid ${colors.line}`,
              background: "#fff",
              color: colors.body,
              borderRadius: "12px",
              padding: "0.9rem 1.2rem",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            <Search size={16} /> Search Clients
          </Link>
        </div>
      </div>
    </div>
  );
}

export default StaffDashboard;
