// The office "Today" page, shared by admin and staff.
//
// Top to bottom, in the order the office works the day:
//   - four summary cards, each a link to the list behind it;
//   - the dispatch board: who is where today (or tomorrow), with a line for
//     now and an Unassigned row whose visits can be dragged onto a technician;
//   - Needs attention: one row per kind of loose end, each with the one
//     action that closes it;
//   - visits per day this week, and the visits that just finished with their
//     report / signature state;
//   - billing: owed, overdue, collected, and the loose ends (Sprint 3);
//   - for admins, the cost & stock figures.
//
// Every figure is computed in utils/dispatch.js from lists already in
// context; nothing here queries.
//
// On money: "Booked this week" is the sum of appointments.price (migration
// 041) for this week's live visits — what was agreed, not what was
// collected. What was collected is the Billing panel's (invoices, payments).

import { useMemo, useState } from "react";
import useAuth from "../../hooks/useAuth";
import useClients from "../../hooks/useClients";
import useUsers from "../../hooks/useUsers";
import { useScheduling } from "../../context/SchedulingContext";
import { useInventoryContext } from "../../context/InventoryContext";
import { useToast } from "../../context/ToastContext";
import { ROLES } from "../../utils/constants";
import { SUBSYSTEMS } from "../../utils/permissions";
import { bookableTechnicians, crewOf, endOf, findTechnicianConflicts } from "../../utils/scheduling";
import { greetingFor } from "../../utils/greetings";
import { absenceDuring, describeOut, outOn } from "../../utils/absences";
import { plural } from "../../utils/formatters";
import {
  attentionItems,
  dispatchLanes,
  overdueReports,
  recentVisits,
  unassignedUpcoming,
  weekBars,
  weekRevenue,
} from "../../utils/dispatch";
import {
  averageMaterialCost,
  appointmentsToday,
  lowStockItems,
  peso,
  pesoCompact,
  reorderExposure,
  signatureState,
  spendBySupplier,
  dayKey,
  spendThisMonth,
  stockOnHandValue,
  weekWindow,
} from "../../utils/dashboardMetrics";
import { colors, pageShell } from "../../styles/theme";
import { neutral } from "../../styles/tokens";
import StatusPill from "../ui/StatusPill";
import { Panel, RankedBars, StatTile, TileRow, whenLabel } from "./DashboardParts";
import { AttentionList, DispatchBoard, KpiCard, RecentList, WeekBarsCard } from "./TodayParts";
import BillingPanel from "./BillingPanel";

/**
 * The detail line under a recently completed visit. "Signed by" only when a
 * signature image exists: a typed customer name is not a signature.
 */
export function recentDetail(appointment, crewNames) {
  const who = crewNames.join(", ") || "Unassigned";
  if (signatureState(appointment) === "Signed") {
    return `${who} · signed${appointment.customerName ? ` by ${appointment.customerName}` : ""}`;
  }
  return `${who} · no customer signature`;
}

/** "7 visits today across 3 technicians. 4 things need you." */
export function daySummary({ visitsToday, technicianCount, attentionCount }) {
  const visits = visitsToday === 0 ? "No visits today" : `${plural(visitsToday, "visit")} today`;
  const across = visitsToday > 0 && technicianCount > 0 ? ` across ${plural(technicianCount, "technician")}` : "";
  const needs = attentionCount === 0 ? "Nothing needs you right now." : `${plural(attentionCount, "thing")} ${attentionCount === 1 ? "needs" : "need"} you.`;
  return `${visits}${across}. ${needs}`;
}

const firstName = (user) => (user?.name || user?.username || "").split(" ")[0];

function OfficeDashboard() {
  const { currentUser, can } = useAuth();
  const { appointments, absences, loading, error, updateAppointment } = useScheduling();
  const { clients } = useClients();
  const { users } = useUsers();
  const { inventory, movements } = useInventoryContext();
  const { showError, showSuccess } = useToast();
  const [dayChoice, setDayChoice] = useState("today");

  const isAdmin = currentUser?.role === ROLES.ADMIN;
  const canAssign = can(SUBSYSTEMS.SCHEDULING, "edit");
  const canBook = can(SUBSYSTEMS.SCHEDULING, "create");
  const canSeeStock = can(SUBSYSTEMS.INVENTORY, "view");
  // The clock the whole page reads; fixed per render so every figure agrees.
  const now = new Date();

  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const clientName = (id) => clientsById.get(id)?.name || "Unknown client";
  const personName = (id) => {
    const match = users.find((user) => user.id === id);
    return match?.name || match?.username || "";
  };
  const technicians = useMemo(
    () => bookableTechnicians(users.filter((user) => user.role === ROLES.TECHNICIAN)),
    [users]
  );

  const boardDay = new Date(now);
  if (dayChoice === "tomorrow") boardDay.setDate(boardDay.getDate() + 1);
  const lanes = dispatchLanes(appointments, technicians, boardDay);
  // Who is out on the board's day (migration 057): their lane says so and
  // takes no drops.
  const outOnBoard = new Map(outOn(absences, dayKey(boardDay)).map((absence) => [absence.technicianId, absence]));

  const today = appointmentsToday(appointments);
  const doneToday = today.filter((entry) => entry.status === "Completed" || entry.reportSubmitted).length;
  // Started on site (migration 048), or confirmed and inside its time slot.
  const onSiteNow = today.filter(
    (entry) =>
      !entry.reportSubmitted &&
      (entry.status === "In progress" || (entry.status === "Confirmed" && new Date(entry.scheduledAt) <= now && endOf(entry) > now.getTime()))
  ).length;
  const toGo = today.length - doneToday - onSiteNow;
  const workingToday = new Set(today.flatMap((entry) => crewOf(entry))).size;
  const unassigned = unassignedUpcoming(appointments, now);
  const overdue = overdueReports(appointments, now);
  const revenue = weekRevenue(appointments, now);
  const lowStock = lowStockItems(inventory.filter((item) => item.status !== "DISABLED"));
  const attention = attentionItems({ appointments, clients, inventory, users, absences }, { now, canBook, canSeeStock });
  const bars = weekBars(appointments, now);
  const { start: weekStart, end: weekEnd } = weekWindow(now);
  const lastDay = new Date(weekEnd);
  lastDay.setDate(lastDay.getDate() - 1);
  const rangeLabel = `${weekStart.toLocaleDateString([], { month: "short", day: "numeric" })} – ${lastDay.toLocaleDateString([], {
    month: weekStart.getMonth() === lastDay.getMonth() ? undefined : "short",
    day: "numeric",
  })}`;

  const recent = recentVisits(appointments, now).map((entry) => ({
    id: entry.id,
    when: whenLabel(entry.scheduledAt, now).replace("Today · ", "").replace("Yesterday · ", "Yest. "),
    title: clientName(entry.clientId),
    detail: [entry.pestConcern || entry.serviceType, crewOf(entry).map(personName).filter(Boolean).join(", ") || "Unassigned"]
      .filter(Boolean)
      .join(" · "),
    state: signatureState(entry),
    to: `/scheduling?appointment=${encodeURIComponent(entry.id)}${entry.reportSubmitted ? "" : "&tab=Report"}`,
  }));

  // Drag from the Unassigned row onto a technician. Only the crew changes —
  // no time change, so no Reschedule step (unlike a calendar move) — and the
  // status is left as it is.
  const assign = async (appointment, technician) => {
    if (!appointment || !technician) return;
    const away = absenceDuring(absences, technician.id, appointment);
    if (away) {
      showError(`${technician.name || technician.username} is ${describeOut(away)}.`);
      return;
    }
    const assigned = { ...appointment, technicianId: technician.id, technicianIds: [technician.id] };
    if (findTechnicianConflicts(appointments, assigned).length > 0) {
      showError(`${technician.name || technician.username} is already booked at that time.`);
      return;
    }
    const result = await updateAppointment(assigned);
    if (typeof result === "string") {
      showError(result);
      return;
    }
    showSuccess(`${clientName(appointment.clientId)} assigned to ${technician.name || technician.username}.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await updateAppointment({ ...appointment, technicianId: "", technicianIds: [] });
          if (typeof undo === "string") showError(undo);
        },
      },
    });
  };

  const dash = loading ? "—" : null;

  return (
    <div style={pageShell}>
      <header style={{ marginBottom: "22px" }}>
        <p style={{ margin: 0, fontSize: "11.5px", letterSpacing: "0.09em", textTransform: "uppercase", color: neutral.saddle }}>
          {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <h1 style={{ margin: "4px 0 0", fontSize: "30px", lineHeight: 1.2, letterSpacing: "-0.33px" }}>
          {greetingFor(firstName(currentUser))}
        </h1>
        <p style={{ margin: "4px 0 0", color: neutral.saddle }}>
          {loading ? "Loading today's schedule…" : daySummary({ visitsToday: today.length, technicianCount: workingToday, attentionCount: attention.length })}
        </p>
      </header>

      {error && (
        <div role="alert" style={{ marginBottom: "1rem", padding: "0.8rem 1rem", borderRadius: "3.75px", background: "#f9ecea", color: colors.danger, fontWeight: 500, fontSize: "0.85rem" }}>
          Couldn't load appointments: {error}
        </div>
      )}

      {/* One board, no gaps: every widget shares its edges (.dash-joined). */}
      <div className="dash-joined">
        <div className="dash-joined dash-kpis">
          <KpiCard
            label="Visits today"
            value={dash ?? today.length}
            footer={today.length ? `${doneToday} done · ${onSiteNow} on site · ${toGo} to go` : "Nothing booked today"}
            to="/scheduling"
          />
          <KpiCard
            label="Unassigned"
            value={dash ?? unassigned.length}
            footer={unassigned.length ? <StatusPill tone="warning">Needs a technician</StatusPill> : "Every visit has a technician"}
            to={unassigned.length ? `/scheduling?appointment=${encodeURIComponent(unassigned[0].id)}` : "/scheduling"}
          />
          <KpiCard
            label="Reports overdue"
            value={dash ?? overdue.length}
            footer={overdue.length ? <StatusPill tone="danger">Over 24 h</StatusPill> : "All filed"}
            to={overdue.length ? `/scheduling?appointment=${encodeURIComponent(overdue[0].id)}&tab=Report` : "/scheduling"}
          />
          {isAdmin ? (
            <KpiCard
              label="Booked this week"
              value={dash ?? pesoCompact(revenue.total)}
              footer={
                revenue.priced
                  ? `${plural(revenue.visits, "visit")} · ${pesoCompact(revenue.average)} avg`
                  : `${plural(revenue.visits, "visit")} · no prices set`
              }
              to="/scheduling"
            />
          ) : (
            <KpiCard
              label="Low stock"
              value={lowStock.length}
              footer={lowStock.length ? "At or below reorder level" : "Nothing low"}
              to="/inventory"
            />
          )}
        </div>

        <DispatchBoard
          lanes={lanes}
          outIds={outOnBoard}
          day={boardDay}
          now={now}
          clientName={clientName}
          onAssign={canAssign ? assign : null}
          dayChoice={dayChoice}
          onDayChange={setDayChoice}
        />

        <div className="today-columns dash-joined">
          <AttentionList items={attention} loading={loading} />
          <div className="dash-joined">
            <WeekBarsCard bars={bars} rangeLabel={rangeLabel} />
            <RecentList rows={recent} />
          </div>
        </div>

        <BillingPanel />
        {isAdmin && <CostPanel inventory={inventory} movements={movements} appointments={appointments} />}
      </div>
    </div>
  );
}

/** Admin only: what the stock costs. Cost, not revenue. */
function CostPanel({ inventory, movements, appointments }) {
  const monthSpend = spendThisMonth(movements);
  const onHand = stockOnHandValue(inventory);
  const exposure = reorderExposure(inventory);
  const materials = averageMaterialCost(appointments, inventory);
  const suppliers = spendBySupplier(movements, inventory);

  return (
    <Panel title="Cost &amp; stock" action="This month">
      {/* Compact figures with the exact amount on hover: a peso total has no
          fixed width, and the full number did not fit the tile. */}
      <TileRow min="150px">
        <StatTile label="Stock received" value={pesoCompact(monthSpend)} title={peso(monthSpend, { decimals: 2 })} note="Recorded on Stock In" />
        <StatTile label="Stock on hand" value={pesoCompact(onHand)} title={peso(onHand, { decimals: 2 })} note="Quantity × unit cost" />
        <StatTile
          label="Restock cost"
          value={pesoCompact(exposure)}
          title={peso(exposure, { decimals: 2 })}
          note="To clear every low item"
          tone={exposure > 0 ? "attn" : "done"}
        />
        <StatTile
          label="Materials per job"
          value={pesoCompact(materials.average)}
          title={peso(materials.average, { decimals: 2 })}
          note={materials.jobs > 0 ? `Est. across ${materials.jobs} job${materials.jobs === 1 ? "" : "s"}` : "No jobs filed yet"}
        />
      </TileRow>

      {/* Only worth a chart once there is more than one supplier to compare. */}
      {suppliers.length > 1 && (
        <div style={{ marginTop: "0.5rem", paddingTop: "0.85rem", borderTop: "1px solid #f3eaea" }}>
          <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.8rem", fontWeight: 500, color: colors.body }}>
            Spend by supplier
          </h3>
          <RankedBars
            rows={suppliers}
            format={(value) => `${pesoCompact(value)} (${monthSpend > 0 ? Math.round((value / monthSpend) * 100) : 0}%)`}
          />
        </div>
      )}

      <p style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: colors.muted, fontStyle: "italic" }}>
        Materials per job is an estimate: a stock-out records the quantity used, not what it
        cost that day, so it is priced at each item's current cost.
      </p>
    </Panel>
  );
}

export default OfficeDashboard;
