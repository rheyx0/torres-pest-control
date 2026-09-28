// Sidebar + top bar + content: the shell for every authenticated page.
//
// Wide screens: a two-column grid, the rail sticky on the left. Below the
// drawer breakpoint (860px, in globals.css) the rail leaves the grid and
// slides in over a scrim when the top bar's menu button asks for it; it
// closes again on navigation, on Escape and on a scrim tap, and focus goes
// back to the button that opened it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import BottomTabs from "./BottomTabs";
import { ROLES } from "../../utils/constants";
import useAuth from "../../hooks/useAuth";
import useInventory from "../../hooks/useInventory";
import { useScheduling } from "../../context/SchedulingContext";
import { lowStockItems, needsScheduling } from "../../utils/dashboardMetrics";
import { SUBSYSTEMS } from "../../utils/permissions";
import { useOptionalBilling } from "../../hooks/useBilling";
import { paymentReminders } from "../../utils/sprint4";
import { layout } from "../../styles/tokens";
import { appBackground } from "../../styles/theme";

/**
 * Sidebar counts: visits nobody has been assigned to, active items at or
 * below their reorder level, and invoices overdue or due within 3 days
 * (Sprint 4's payment reminders). Each only for someone who can act on it.
 */
export function navBadges({ appointments, inventory, canSchedule, canStock, billing = null }) {
  const reminders = billing ? paymentReminders(billing.invoices || [], billing.payments || []) : null;
  return {
    billing: reminders ? reminders.overdue.length + reminders.dueSoon.length : 0,
    scheduling: canSchedule ? needsScheduling(appointments).length : 0,
    inventory: canStock
      ? lowStockItems(inventory.filter((item) => item.status !== "DISABLED")).length
      : 0,
  };
}

function Layout({ children }) {
  const location = useLocation();
  const { can, currentUser } = useAuth();
  // A technician on a phone gets bottom tabs; during a visit the screen is
  // the visit alone (its own header and footer, no tabs, no top bar).
  const isTechnician = currentUser?.role === ROLES.TECHNICIAN;
  const inVisit = location.pathname.startsWith("/visit/");
  const { appointments } = useScheduling();
  const { inventory } = useInventory();
  const billing = useOptionalBilling();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef(null);

  const badges = useMemo(
    () =>
      navBadges({
        appointments,
        inventory,
        canSchedule: can(SUBSYSTEMS.SCHEDULING, "create"),
        canStock: can(SUBSYSTEMS.INVENTORY, "edit"),
        billing: billing?.office && billing.invoicesAvailable ? billing : null,
      }),
    [appointments, inventory, can, billing]
  );

  const closeDrawer = useCallback(() => {
    setDrawerOpen((wasOpen) => {
      if (wasOpen) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      return false;
    });
  }, []);

  // Any navigation closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen, closeDrawer]);

  return (
    <div
      className="app-shell"
      data-drawer={drawerOpen ? "open" : "closed"}
      data-focus={inVisit ? "visit" : undefined}
      data-tabs={isTechnician && !inVisit ? "on" : undefined}
      style={{ background: appBackground }}
    >
      <Sidebar badges={badges} open={drawerOpen} onClose={closeDrawer} />
      <div className="app-scrim" aria-hidden="true" onClick={closeDrawer} />

      <div className="app-main">
        <Navbar onOpenMenu={() => setDrawerOpen(true)} menuOpen={drawerOpen} menuButtonRef={menuButtonRef} />
        <div
          className="app-content"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") event.preventDefault();
          }}
        >
          <div style={{ maxWidth: layout.pageMaxWidth }}>{children || <Outlet />}</div>
        </div>
        {isTechnician && !inVisit && <BottomTabs />}
      </div>
    </div>
  );
}

export default Layout;
