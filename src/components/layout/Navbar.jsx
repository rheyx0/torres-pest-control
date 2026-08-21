// Slim top bar above the page content.
//
// Shows who is signed in and gives the profile/settings shortcuts a home that
// isn't the sidebar. Kept deliberately light — the sidebar is still primary
// navigation.

import { Link } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { badge, colors } from "../../styles/theme";

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
      <span style={badge}>{currentUser.role}</span>
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
