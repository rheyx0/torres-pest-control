// Office view, shared by admin and staff.
//
// One file rather than two: "Pending / Unscheduled" and "Needs Scheduling" are
// the same count, and "Technician Workload" and "Today's Overview" answer the
// same question, so a separate admin file would have been a near-duplicate to
// keep in sync. The genuinely admin-only panels are gated inline instead.
//
// On money: the schema records what the business SPENDS and never what it
// CHARGES — there is no price, fee or invoice column anywhere — so the cost
// panel is deliberately named for what it is. Revenue and margin need a pricing
// feature first, not a dashboard panel.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import useClients from "../../hooks/useClients";
import useUsers from "../../hooks/useUsers";
import { useScheduling } from "../../context/SchedulingContext";
import { useInventoryContext } from "../../context/InventoryContext";
import { ROLES } from "../../utils/constants";
import { dashboardNote, greetingFor } from "../../utils/greetings";
import { colors, pageShell } from "../../styles/theme";
import {
  appointmentsToday,
  averageMaterialCost,
  awaitingReschedule,
  dayKey,
  lowStockItems,
  needsScheduling,
  peso,
  pesoCompact,
  recentlyCompleted,
  reorderExposure,
  spendBySupplier,
  spendThisMonth,
  stockOnHandValue,
  weekWindow,
} from "../../utils/dashboardMetrics";
import {
  Chip, Empty, JobRow, Panel, PieChart, RankedBars, StatTile, TileRow, dateLabel,
} from "./DashboardParts";

function OfficeDashboard() {
  const { currentUser } = useAuth();
  const { appointments, loading, error } = useScheduling();
  const { clients } = useClients();
  const { users } = useUsers();
  const { inventory, movements } = useInventoryContext();

  const isAdmin = currentUser?.role === ROLES.ADMIN;
  const note = useMemo(() => dashboardNote(), []);

  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const nameOf = (appointment) => clientsById.get(appointment.clientId)?.name || "Unknown client";
  const technicians = users.filter((user) => user.role === ROLES.TECHNICIAN);
  const techName = (id) => {
    const match = users.find((user) => user.id === id);
    return match?.name || match?.username || "Unassigned";
  };

  const today = appointmentsToday(appointments);
  const unscheduled = needsScheduling(appointments);
  const toRebook = awaitingReschedule(appointments);
  const lowStock = lowStockItems(inventory);
  const currentWeek = useMemo(() => weekWindow(), []);
  const schedule = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(currentWeek.start);
      date.setDate(date.getDate() + index);
      const key = dayKey(date);
      const count = appointments.filter((appointment) => {
        if (appointment.status === "Cancelled") return false;
        const scheduled = new Date(appointment.scheduledAt);
        return dayKey(scheduled) === key;
      }).length;
      return {
        label: date.toLocaleDateString([], { weekday: "short" }),
        date: date.getDate(),
        value: count,
      };
    });
  }, [appointments, currentWeek]);
  const scheduleTotal = schedule.reduce((total, day) => total + day.value, 0);
  const busiestDay = schedule.reduce((busiest, day) => day.value > busiest.value ? day : busiest, schedule[0]);

  const workload = useMemo(() => {
    const rows = technicians.map((technician) => ({
      label: technician.name || technician.username || "Technician",
      value: appointments.filter((appointment) => appointment.status !== "Cancelled"
        && appointment.technicianId === technician.id
        && new Date(appointment.scheduledAt) >= currentWeek.start
        && new Date(appointment.scheduledAt) < currentWeek.end).length,
    }));
    const unassigned = appointments.filter((appointment) => appointment.status !== "Cancelled"
      && !appointment.technicianId
      && new Date(appointment.scheduledAt) >= currentWeek.start
      && new Date(appointment.scheduledAt) < currentWeek.end).length;
    if (unassigned > 0) rows.push({ label: "Unassigned", value: unassigned });
    return rows.filter((row) => row.value > 0).sort((first, second) => second.value - first.value);
  }, [appointments, currentWeek, technicians]);
  const serviceMix = useMemo(() => {
    const counts = new Map();
    appointments
      .filter((appointment) => appointment.status !== "Cancelled"
        && new Date(appointment.scheduledAt) >= currentWeek.start
        && new Date(appointment.scheduledAt) < currentWeek.end)
      .forEach((appointment) => {
        const label = appointment.pestConcern || appointment.serviceType || "Unspecified";
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((first, second) => second.value - first.value);
  }, [appointments, currentWeek]);
  const completed = recentlyCompleted(appointments);

  const monthSpend = spendThisMonth(movements);
  const onHand = stockOnHandValue(inventory);
  const exposure = reorderExposure(inventory);
  const materials = averageMaterialCost(appointments, inventory);
  const suppliers = spendBySupplier(movements, inventory);

  return (
    <div style={pageShell}>
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ color: colors.brandInk, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Overview
        </div>
        <h1 style={{ margin: "0.3rem 0 0", color: colors.ink, fontSize: "1.9rem", lineHeight: 1.15 }}>
          {greetingFor(currentUser?.name || currentUser?.username)}
        </h1>
        <p style={{ margin: "0.25rem 0 0", color: colors.muted, fontSize: "0.9rem" }}>{note}</p>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: "1rem", padding: "0.8rem 1rem", borderRadius: "12px", background: "#fdf0ef", border: "1px solid #eeb0ac", color: colors.danger, fontWeight: 700, fontSize: "0.85rem" }}>
          Couldn't load appointments: {error}
        </div>
      )}

      <div style={{ display: "grid", gap: "1rem" }}>
        <TileRow>
          <StatTile
            label="Needs scheduling"
            value={loading ? "—" : unscheduled.length}
            note="Pending, no technician"
            tone={unscheduled.length > 0 ? "crit" : "done"}
          />
          <StatTile
            label="To reschedule"
            value={loading ? "—" : toRebook.length}
            note="Awaiting a new slot"
            tone={toRebook.length > 0 ? "attn" : "done"}
          />
          <StatTile
            label="Today's jobs"
            value={loading ? "—" : today.length}
            note={`Across ${technicians.length} technician${technicians.length === 1 ? "" : "s"}`}
          />
          <StatTile
            label="Low stock"
            value={lowStock.length}
            note="At or below reorder level"
            tone={lowStock.length > 0 ? "attn" : "done"}
          />
        </TileRow>

        <Panel title="Scheduling overview" action={<Link to="/scheduling?view=week" style={{ color: colors.brand, textDecoration: "none" }}>This week</Link>}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", paddingBottom: "0.35rem" }}>
              <div>
                <div style={{ color: colors.ink, fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.1 }}>{scheduleTotal}</div>
                <div style={{ color: colors.muted, fontSize: "0.68rem" }}>Appointments</div>
              </div>
              <div>
                <div style={{ color: colors.ink, fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.1 }}>{busiestDay.value}</div>
                <div style={{ color: colors.muted, fontSize: "0.68rem" }}>Peak day</div>
              </div>
              <div>
                <div style={{ color: colors.ink, fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.1 }}>{today.length}</div>
                <div style={{ color: colors.muted, fontSize: "0.68rem" }}>Today</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.55rem", alignItems: "end", height: "150px", padding: "0.75rem 0.25rem 0", borderTop: "1px solid #f3eaea", background: "repeating-linear-gradient(to top, transparent 0, transparent 37px, #f3eaea 38px)" }}>
              {schedule.map((day) => (
                <div key={`${day.label}-${day.date}`} title={`${day.value} ${day.value === 1 ? "appointment" : "appointments"} on ${day.label} ${day.date}`} style={{ display: "grid", gridTemplateRows: "1fr auto", alignItems: "end", gap: "0.35rem", height: "100%", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "end", justifyContent: "center", height: "100%" }}>
                    <div style={{ width: "min(28px, 70%)", height: `${Math.max(8, busiestDay.value ? (day.value / busiestDay.value) * 100 : 8)}%`, minHeight: day.value ? "12px" : "5px", borderRadius: "4px 4px 2px 2px", background: day.value ? colors.brandLight : "#eadede" }} />
                  </div>
                  <div style={{ textAlign: "center", color: colors.muted, fontSize: "0.64rem", fontWeight: 700, whiteSpace: "nowrap" }}>{day.label}</div>
                </div>
              ))}
            </div>
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
          <Panel title="Who's where this week">
            <PieChart rows={workload} format={(value) => `${value} ${value === 1 ? "job" : "jobs"}`} />
          </Panel>

          <Panel title="Services this week">
            <PieChart rows={serviceMix} />
          </Panel>
        </div>

        {/* Cost, not revenue — see the note at the top of this file. */}
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

          {isAdmin && (
            <div style={{ marginTop: "0.5rem", paddingTop: "0.85rem", borderTop: "1px solid #f3eaea" }}>
              <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.8rem", fontWeight: 800, color: colors.body }}>
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

        {lowStock.length > 0 && (
          <Panel title="Running low" action={<Link to="/inventory" style={{ color: colors.brand, textDecoration: "none" }}>Open Inventory →</Link>}>
            {lowStock.slice(0, 5).map((item, index) => (
              <JobRow
                key={item.id}
                first={index === 0}
                when={`${item.quantity} ${item.unit || ""}`.trim()}
                title={item.name}
                detail={`Reorder level ${item.reorderLevel}${item.supplier ? ` · ${item.supplier}` : ""}`}
                action={<Chip tone="attn">Low</Chip>}
              />
            ))}
          </Panel>
        )}

        {isAdmin && (
          <Panel title="Recently completed">
            {completed.length === 0 && <Empty>No reports filed yet.</Empty>}
            {completed.map((appointment, index) => (
              <JobRow
                key={appointment.id}
                first={index === 0}
                when={dateLabel(appointment.reportSubmittedAt || appointment.scheduledAt)}
                title={`${nameOf(appointment)} — ${appointment.pestConcern || "Service"}`}
                detail={`${techName(appointment.technicianId)}${appointment.customerName ? ` · signed by ${appointment.customerName}` : " · no signature on file"}`}
                action={appointment.signaturePath
                  ? <Chip tone="done">Signed</Chip>
                  : <Chip tone="attn">Unsigned</Chip>}
              />
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

export default OfficeDashboard;
