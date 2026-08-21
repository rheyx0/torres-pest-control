// Technician view.
//
// Technicians are read-only across the system in the current permission
// matrix, so this dashboard is informational: what they can look up, and
// where their own account settings live.

import { Link } from "react-router-dom";
import { BriefcaseBusiness, Boxes } from "lucide-react";
import MetricCard from "../common/MetricCard";
import PageHeader from "../common/PageHeader";
import useAuth from "../../hooks/useAuth";
import useClients from "../../hooks/useClients";
import useInventory from "../../hooks/useInventory";
import { card, colors, pageShell, primaryButton } from "../../styles/theme";

function TechnicianDashboard() {
  const { currentUser } = useAuth();
  const { clients } = useClients();
  const { inventory } = useInventory();

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
          title="Client Profiles"
          value={clients.length}
          accent={`linear-gradient(135deg, ${colors.brand} 0%, #b43d3d 100%)`}
          Icon={BriefcaseBusiness}
        />
        <MetricCard
          title="Inventory Items"
          value={inventory.length}
          accent="linear-gradient(135deg, #374151 0%, #64748b 100%)"
          Icon={Boxes}
        />
      </div>

      <div style={card}>
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", color: colors.ink }}>Your account</h2>
        <p style={{ margin: "0 0 1.25rem", color: colors.muted, lineHeight: 1.6 }}>
          You have view access to client profiles and inventory. Job scheduling arrives in a later
          sprint.
        </p>
        <Link to="/settings" style={{ ...primaryButton, textDecoration: "none", display: "inline-block" }}>
          Change Password
        </Link>
      </div>
    </div>
  );
}

export default TechnicianDashboard;
