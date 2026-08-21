// Blocks routes the signed-in user's role may not reach.
//
// Sprint AC (Assign Role & Permissions): "Unauthorized users cannot access
// restricted modules."
//
// This closes a real hole: the sidebar only *hid* the admin-only link, so any
// signed-in technician could type /users and edit or deactivate accounts.
// Hiding a link is not access control.
//
// Usage:
//   <RoleBasedRoute subsystem={SUBSYSTEMS.USERS} action="edit">
//     <UsersPage />
//   </RoleBasedRoute>

import { Link } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import PageHeader from "../common/PageHeader";
import { card, pageShell, primaryButton } from "../../styles/theme";

function AccessDenied({ role }) {
  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Restricted" title="You don't have access to this page" />
      <div style={card}>
        <p style={{ margin: "0 0 1.25rem", color: "#4b5563", lineHeight: 1.6 }}>
          Your role ({role || "unknown"}) doesn't include permission for this module. If you think
          this is wrong, ask a system administrator to review your role.
        </p>
        <Link to="/" style={{ ...primaryButton, textDecoration: "none", display: "inline-block" }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

function RoleBasedRoute({ subsystem, action = "view", children }) {
  const { role, can } = useAuth();

  if (!can(subsystem, action)) return <AccessDenied role={role} />;

  return children;
}

export default RoleBasedRoute;
