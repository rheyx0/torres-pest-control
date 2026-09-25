// Primary navigation.
//
// Nav items are derived from the permission matrix rather than a hardcoded
// `role === "ADMIN"` check, so a link appears exactly when the route behind it
// is reachable. RoleBasedRoute does the actual enforcing — this only decides
// what to show.
//
// The rail is a SURFACE, not an accent: plain bone with ink text. The one
// chromatic mark is spent on the active item (white, with a 3px maroon
// marker) and on the count badges, which are the rail's only other claim on
// attention. Below the drawer breakpoint the same element slides in from the
// left over a scrim; the CSS for that lives in globals.css (.app-rail).

import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  CalendarDays,
  Home,
  Lock,
  Package,
  Tag,
  Users,
} from "lucide-react";
import useAuth from "../../hooks/useAuth";
import { SUBSYSTEMS } from "../../utils/permissions";
import { brand, font, neutral, radius, surface, weight } from "../../styles/tokens";
import { colors } from "../../styles/theme";
import ProfileMenu from "./ProfileMenu";

/**
 * Navigation, grouped. The main group carries no visible heading — its four
 * items are the day's work and read as the rail's top level — but it keeps a
 * visually hidden one so a screen reader still announces the grouping.
 *
 * `badge` names a key in the `badges` prop; a count of 0 shows nothing.
 */
const NAV_GROUPS = [
  {
    label: "Main",
    hidden: true,
    items: [
      // The dashboard is the only exact match — "/" prefixes every other route.
      { label: "Today", path: "/", exact: true, subsystem: null, Icon: Home },
      { label: "Schedule", path: "/scheduling", subsystem: SUBSYSTEMS.SCHEDULING, action: "view", Icon: CalendarDays, badge: "scheduling" },
      { label: "Clients", path: "/clients", subsystem: SUBSYSTEMS.CLIENTS, action: "view", Icon: Users },
      { label: "Inventory", path: "/inventory", subsystem: SUBSYSTEMS.INVENTORY, action: "view", Icon: Package, badge: "inventory" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Services", path: "/services", subsystem: SUBSYSTEMS.SETTINGS, action: "view", Icon: Tag },
      { label: "Accounts", path: "/users", subsystem: SUBSYSTEMS.USERS, action: "view", Icon: Lock },
      { label: "Activity log", path: "/activity", subsystem: SUBSYSTEMS.LOGS, action: "view", Icon: Activity },
    ],
  },
];

/**
 * Whether a nav item should read as the current page.
 *
 * A prefix match keeps the parent lit on a detail route (/clients/123), but
 * only for items that opt in: "/" is a prefix of every route in the app, so
 * the dashboard has to stay exact. The `/` boundary check stops /clients
 * lighting up for a hypothetical /clients-archive.
 */
export function isNavItemActive(pathname, item) {
  if (item.exact) return pathname === item.path;
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

/** Turns "Setup" into the id its <ul> points at. */
export function groupHeadingId(label) {
  return `sidebar-group-${label.toLowerCase().replace(/\s+/g, "-")}`;
}

const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

const styles = {
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "2px 8px 18px",
    textDecoration: "none",
    color: neutral.ink,
  },
  brandName: { display: "block", font: `500 15px/1.15 ${font.display}`, color: neutral.ink },
  brandSub: {
    display: "block",
    fontSize: "10.5px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: neutral.bark,
  },
  navGroups: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    // Room for the active marker, which hangs into the rail's padding.
    margin: "0 -14px",
    padding: "0 14px",
  },
  groupLabel: {
    margin: 0,
    padding: "14px 10px 6px",
    fontSize: "10.5px",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontWeight: weight.medium,
    // Saddle rather than bark: bark lands near 3:1 on bone, too low for 10px.
    color: neutral.saddle,
  },
  groupList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  link: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "7px 10px",
    borderRadius: radius.control,
    // Every item carries a border so the active one costs no layout shift.
    //
    // Longhands, not the `border` shorthand — this is load-bearing and has
    // regressed once already. activeLink sets borderColor, so React owns that
    // longhand; when the item goes inactive React removes it by assigning "",
    // which DELETES the declaration rather than falling back to the
    // shorthand's transparent. border-color then drops to its initial value,
    // currentColor, and every tab you have visited keeps an outline. Naming
    // borderColor here gives React a value to write back instead.
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    background: "transparent",
    color: neutral.saddle,
    textDecoration: "none",
    fontSize: "13.5px",
    fontWeight: weight.regular,
    boxSizing: "border-box",
  },
  activeLink: {
    background: surface.panel,
    borderColor: colors.line,
    color: neutral.ink,
    fontWeight: weight.medium,
  },
  marker: {
    position: "absolute",
    left: "-15px",
    top: "6px",
    bottom: "6px",
    width: "3px",
    background: brand.base,
    borderRadius: "0 2px 2px 0",
  },
  badge: {
    marginLeft: "auto",
    minWidth: "18px",
    textAlign: "center",
    fontSize: "11px",
    fontWeight: weight.medium,
    background: brand.base,
    color: surface.panel,
    borderRadius: radius.pill,
    padding: "0 6px",
    lineHeight: "17px",
  },
  foot: {
    marginTop: "12px",
    borderTop: `1px solid ${colors.line}`,
    paddingTop: "12px",
  },
};

/**
 * @param badges  counts keyed by an item's `badge` name, e.g. { scheduling: 3 }.
 * @param open    drawer state below the breakpoint; ignored on desktop.
 * @param onClose asks the shell to close the drawer (link click, Escape).
 */
function Sidebar({ badges = {}, open = false, onClose = () => {} }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, can, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const footRef = useRef(null);

  // Clicking outside the profile menu closes it.
  useEffect(() => {
    if (!profileOpen) return undefined;
    const handlePointerDown = (event) => {
      if (footRef.current && !footRef.current.contains(event.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [profileOpen]);

  const isVisible = (item) => !item.subsystem || can(item.subsystem, item.action);

  // Filter first, then drop any group left empty — a technician must not see
  // a "Setup" heading floating above nothing.
  const navGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(isVisible),
  })).filter((group) => group.items.length > 0);

  const handleNavigate = (path) => {
    setProfileOpen(false);
    onClose();
    navigate(path);
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    try {
      await logout?.();
    } finally {
      navigate("/login");
    }
  };

  return (
    <nav className="app-rail" data-open={open ? "true" : "false"} aria-label="Primary" id="app-rail">
      <Link to="/" style={styles.brandRow} onClick={onClose}>
        <img src="/login-logo.png" alt="" width="30" height="30" style={{ display: "block", objectFit: "contain" }} />
        <span>
          <span style={styles.brandName}>Torres</span>
          <span style={styles.brandSub}>Pest Control</span>
        </span>
      </Link>

      <div style={styles.navGroups}>
        {navGroups.map((group) => {
          const headingId = groupHeadingId(group.label);

          return (
            <div key={group.label}>
              <p id={headingId} style={group.hidden ? visuallyHidden : styles.groupLabel}>
                {group.label}
              </p>

              <ul aria-labelledby={headingId} style={styles.groupList}>
                {group.items.map((item) => {
                  const isActive = isNavItemActive(location.pathname, item);
                  const count = item.badge ? Number(badges[item.badge]) || 0 : 0;

                  return (
                    <li key={item.path}>
                      <Link
                        className="sidebar-nav-link"
                        to={item.path}
                        onClick={onClose}
                        aria-current={isActive ? "page" : undefined}
                        style={{ ...styles.link, ...(isActive ? styles.activeLink : null) }}
                      >
                        {isActive && <span aria-hidden="true" data-active-marker="" style={styles.marker} />}
                        <item.Icon
                          size={16}
                          strokeWidth={1.6}
                          style={{ color: isActive ? neutral.ink : neutral.saddle, flexShrink: 0 }}
                          aria-hidden="true"
                        />
                        {item.label}
                        {count > 0 && (
                          <span style={styles.badge} aria-label={`${count} need attention`}>
                            {count > 99 ? "99+" : count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {currentUser && (
        <div ref={footRef} style={styles.foot}>
          <ProfileMenu
            variant="rail"
            user={currentUser}
            open={profileOpen}
            onToggle={() => setProfileOpen((current) => !current)}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
          />
        </div>
      )}
    </nav>
  );
}

export default Sidebar;
