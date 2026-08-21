// Primary navigation.
//
// Nav items are now derived from the permission matrix rather than a
// hardcoded `role === "ADMIN"` check, so a link appears exactly when the
// route behind it is reachable. RoleBasedRoute does the actual enforcing —
// this only decides what to show.

import { Link, useLocation } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { SUBSYSTEMS } from "../../utils/permissions";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", subsystem: null },
  { label: "Client Profiles", path: "/clients", subsystem: SUBSYSTEMS.CLIENTS, action: "view" },
  { label: "Create Client Profile", path: "/clients/new", subsystem: SUBSYSTEMS.CLIENTS, action: "create" },
  { label: "User Accounts", path: "/users", subsystem: SUBSYSTEMS.USERS, action: "view" },
  { label: "Create Account", path: "/users/new", subsystem: SUBSYSTEMS.USERS, action: "create" },
  { label: "Activity Log", path: "/activity", subsystem: SUBSYSTEMS.LOGS, action: "view" },
  { label: "Inventory", path: "/inventory", subsystem: SUBSYSTEMS.INVENTORY, action: "view" },
  { label: "My Profile", path: "/account", subsystem: null },
  { label: "Settings", path: "/settings", subsystem: SUBSYSTEMS.SETTINGS, action: "view" },
];

const styles = {
  sidebar: {
    position: "fixed",
    inset: "0 auto 0 0",
    width: "264px",
    height: "100vh",
    background: "linear-gradient(180deg, #7f1111 0%, #561313 100%)",
    padding: "1.4rem 1rem 1.2rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    boxShadow: "18px 0 40px rgba(86, 19, 19, 0.18)",
    overflow: "hidden",
  },
  logoWrap: {
    marginBottom: "1.25rem",
    padding: "0.85rem 0.8rem 1rem",
    borderBottom: "1px solid rgba(255,255,255,0.18)",
  },
  logo: {
    color: "#fff",
    fontWeight: 800,
    fontSize: "1.15rem",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    lineHeight: 1.3,
  },
  small: {
    display: "block",
    opacity: 0.8,
    fontSize: "0.68rem",
    fontWeight: 600,
    letterSpacing: "0.12em",
    marginTop: "0.4rem",
  },
  link: {
    display: "block",
    padding: "0.75rem 0.9rem",
    borderRadius: "12px",
    color: "rgba(255,255,255,0.88)",
    textDecoration: "none",
    fontSize: "0.9rem",
    fontWeight: 600,
    transition: "all 0.2s ease",
    border: "1px solid transparent",
  },
  activeLink: {
    background: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.12)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
    color: "#fff",
  },
  userInfo: {
    marginTop: "auto",
    padding: "0.85rem 0.9rem 0",
    borderTop: "1px solid rgba(255,255,255,0.18)",
    color: "rgba(255,255,255,0.75)",
    fontSize: "0.78rem",
  },
  navLinks: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    paddingBottom: "0.5rem",
  },
  logoutButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    marginTop: "0.6rem",
    padding: "0.75rem 0.9rem",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "transparent",
    color: "rgba(255,255,255,0.88)",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

function Sidebar() {
  const location = useLocation();
  const { currentUser, can, logout } = useAuth();

  const navItems = NAV_ITEMS.filter(
    (item) => !item.subsystem || can(item.subsystem, item.action)
  );

  return (
    <nav style={styles.sidebar}>
      <div style={styles.logoWrap}>
        <div style={styles.logo}>Torres</div>
        <span style={styles.small}>PEST CONTROL</span>
      </div>

      <div style={styles.navLinks}>
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              ...styles.link,
              ...(location.pathname === item.path ? styles.activeLink : {}),
            }}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div style={styles.userInfo}>
        {currentUser && (
          <>
            Logged in as <strong>{currentUser.name}</strong> ({currentUser.role})
          </>
        )}
        <button type="button" onClick={logout} style={styles.logoutButton}>
          Logout
        </button>
      </div>
    </nav>
  );
}

export default Sidebar;
