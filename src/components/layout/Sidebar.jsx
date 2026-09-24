// Primary navigation.
//
// Nav items are now derived from the permission matrix rather than a
// hardcoded `role === "ADMIN"` check, so a link appears exactly when the
// route behind it is reachable. RoleBasedRoute does the actual enforcing —
// this only decides what to show.

import { Link, useLocation } from "react-router-dom";
import {
  BriefcaseBusiness,
  ClipboardPlus,
  Gauge,
  ListChecks,
  Package,
  CalendarDays,
  UserCircle,
  Users,
} from "lucide-react";
import useAuth from "../../hooks/useAuth";
import { SUBSYSTEMS } from "../../utils/permissions";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", subsystem: null, Icon: Gauge },
  { label: "Client Profiles", path: "/clients", subsystem: SUBSYSTEMS.CLIENTS, action: "view", Icon: BriefcaseBusiness },
  { label: "User Accounts", path: "/users", subsystem: SUBSYSTEMS.USERS, action: "view", Icon: Users },
  { label: "Inventory", path: "/inventory", subsystem: SUBSYSTEMS.INVENTORY, action: "view", Icon: Package },
  { label: "Scheduling", path: "/scheduling", subsystem: SUBSYSTEMS.SCHEDULING, action: "view", Icon: CalendarDays },
  { label: "Treatment Methods", path: "/treatment-methods", subsystem: SUBSYSTEMS.SETTINGS, action: "view", Icon: ListChecks },
];

const styles = {
  sidebar: {
    position: "fixed",
    inset: "0 auto 0 0",
    width: "264px",
    height: "100vh",
    background: "#7f1111",
    padding: "0",
    display: "flex",
    flexDirection: "column",
    gap: "0",
    boxShadow: "1px 0 0 rgba(15, 23, 42, 0.14)",
    overflow: "hidden",
  },
  logoWrap: {
    width: "100%",
    boxSizing: "border-box",
    padding: "1rem 0",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
  },
  logoBadge: {
    width: "2.75rem",
    height: "2.75rem",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    padding: "0.375rem",
    background: "#FFFFFF",
    borderRadius: "0.75rem",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
  },
  logoImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
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
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    padding: "0.75rem 0.9rem",
    borderRadius: "12px",
    color: "rgba(255,255,255,0.88)",
    textDecoration: "none",
    fontSize: "0.9rem",
    fontWeight: 600,
    transition: "transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
    border: "none",
    boxSizing: "border-box",
  },
  activeLink: {
    background: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.18)",
    color: "#fff",
  },
  userInfo: {
    marginTop: "auto",
    padding: "0.85rem 0.9rem 0",
    borderTop: "1px solid rgba(255,255,255,0.18)",
    color: "rgba(255,255,255,0.9)",
    fontSize: "0.78rem",
  },
  navLinks: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "1rem 0.875rem 0.75rem",
  },
  logoutButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    marginTop: "0.6rem",
    padding: "0.75rem 0.9rem",
    borderRadius: "12px",
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.96)",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
  },
};

function Sidebar() {
  const location = useLocation();
  const { currentUser, can, logout } = useAuth();

  const navItems = NAV_ITEMS.filter((item) => {
    if (item.role && currentUser?.role !== item.role) return false;
    if (item.subsystem && !can(item.subsystem, item.action)) return false;
    return true;
  });

  return (
    <nav style={styles.sidebar}>
      <div style={styles.logoWrap}>
        <div style={styles.logoBadge}>
          <img src="/login-logo.png" alt="Torres Pest Control" style={styles.logoImage} />
        </div>
      </div>

      <div style={styles.navLinks}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              className="sidebar-nav-link"
              to={item.path}
              aria-current={isActive ? "page" : undefined}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "rgba(255,255,255,0.12)";
                event.currentTarget.style.boxShadow = "0 8px 18px rgba(0, 0, 0, 0.16)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = isActive ? styles.activeLink.background : "transparent";
                event.currentTarget.style.boxShadow = "none";
              }}
              style={{
                ...styles.link,
                ...(isActive ? styles.activeLink : {}),
                background: isActive ? styles.activeLink.background : "transparent",
                border: "none",
                boxShadow: "none",
                outline: "none",
              }}
            >
              <item.Icon size={17} strokeWidth={2} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div style={styles.userInfo} />
    </nav>
  );
}

export default Sidebar;
