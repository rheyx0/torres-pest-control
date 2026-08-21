// Slim top bar above the page content.
//
// Shows who is signed in and gives the profile/settings shortcuts a home that
// isn't the sidebar. Kept deliberately light — the sidebar is still primary
// navigation.

import { Link } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { badge, colors } from "../../styles/theme";

const ROLE_BADGES = {
  ADMIN: { background: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  STAFF: { background: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  TECHNICIAN: { background: "#dbeafe", color: "#1d4ed8", border: "#93c5fd" },
};

function Navbar() {
  const { currentUser } = useAuth();
  if (!currentUser) return null;

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "1rem",
        padding: "0 0 1.5rem",
        borderBottom: "1px solid rgba(127, 17, 17, 0.1)",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          ...badge,
          ...ROLE_BADGES[currentUser.role],
          border: `1px solid ${ROLE_BADGES[currentUser.role]?.border || colors.brandLight}`,
          display: "inline-flex",
          alignItems: "center",
          minHeight: "32px",
        }}
      >
        {currentUser.role}
      </span>
      <Link
        to="/account"
        style={{ color: colors.brandInk, fontWeight: 700, textDecoration: "none", fontSize: "0.9rem" }}
      >
        {currentUser.name}
      </Link>
    </header>
  );
}

export default Navbar;
