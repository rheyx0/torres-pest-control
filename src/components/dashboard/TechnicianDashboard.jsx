// Technician view: what do I do next?
//
// This split is not cosmetic. Appointment reads are scoped per technician by
// the "Appointment read scope" policy in migration 030, so the shared dashboard
// was counting THEIR jobs and labelling the total "All records in system".
// Every figure here is explicitly about the signed-in technician.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, MapPinned, PackageSearch } from "lucide-react";
import useAuth from "../../hooks/useAuth";
import useClients from "../../hooks/useClients";
import useInventory from "../../hooks/useInventory";
import { useScheduling } from "../../context/SchedulingContext";
import { colors, pageShell, primaryButton } from "../../styles/theme";
import {
  appointmentsThisWeek,
  completedToday,
  lowStockItems,
  remainingToday,
  appointmentsToday,
  tomorrowsJobs,
} from "../../utils/dashboardMetrics";
import { greetingFor } from "../../utils/greetings";
import { Chip, Empty, JobRow, Panel, StatTile, TileRow, timeLabel } from "./DashboardParts";

function TechnicianDashboard() {
  const { currentUser } = useAuth();
  const { appointments, loading, error } = useScheduling();
  const { clients } = useClients();
  const { inventory, loading: inventoryLoading } = useInventory();

  const me = currentUser?.id;
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const nameOf = (appointment) => clientsById.get(appointment.clientId)?.name || "Unknown client";
  const whereOf = (appointment) => {
    const client = clientsById.get(appointment.clientId);
    return appointment.serviceLocation || client?.address || "";
  };

  const mineToday = appointmentsToday(appointments).filter((entry) => entry.technicianId === me);
  const remaining = remainingToday(appointments, me);
  const done = completedToday(appointments, me);
  const nextUp = remaining[0];
  const weeklyJobs = appointmentsThisWeek(appointments).filter((entry) => entry.technicianId === me);
  const weeklyFiled = weeklyJobs.filter((entry) => entry.reportSubmitted).length;
  const tomorrowJobs = tomorrowsJobs(appointments, me, 4);
  const reportsToFile = weeklyJobs.filter((entry) => !entry.reportSubmitted).sort((first, second) => new Date(first.scheduledAt) - new Date(second.scheduledAt));
  const signaturesToAdd = weeklyJobs.filter((entry) => entry.reportSubmitted && !entry.technicianSignaturePath).sort((first, second) => new Date(second.scheduledAt) - new Date(first.scheduledAt));
  const recentCompleted = appointments
    .filter((entry) => entry.technicianId === me && entry.reportSubmitted)
    .sort((first, second) => new Date(second.reportSubmittedAt || second.scheduledAt) - new Date(first.reportSubmittedAt || first.scheduledAt))
    .slice(0, 4);
  const lowStock = lowStockItems(inventory).slice(0, 4);
  const nextScheduled = appointments
    .filter((entry) => entry.technicianId === me && entry.status !== "Cancelled" && new Date(entry.scheduledAt) >= new Date())
    .sort((first, second) => new Date(first.scheduledAt) - new Date(second.scheduledAt))[0];

  const note = useMemo(() => {
    if (loading) return "Loading your schedule…";
    if (mineToday.length === 0) return "Nothing booked for you today.";
    if (remaining.length === 0) return "Every visit today is filed. Nice work.";
    if (remaining.length === 1) return "One visit left today.";
    return `${remaining.length} visits left today.`;
  }, [loading, mineToday.length, remaining.length]);

  return (
    <div style={pageShell}>
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ color: colors.brandInk, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Today
        </div>
        <h1 style={{ margin: "0.3rem 0 0", color: colors.ink, fontSize: "1.9rem", lineHeight: 1.15 }}>
          {greetingFor(currentUser?.name || currentUser?.username)}
        </h1>
        <p style={{ margin: "0.25rem 0 0", color: colors.muted, fontSize: "0.9rem" }}>{note}</p>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: "1rem", padding: "0.8rem 1rem", borderRadius: "12px", background: "#fdf0ef", border: "1px solid #eeb0ac", color: colors.danger, fontWeight: 700, fontSize: "0.85rem" }}>
          Couldn't load your schedule: {error}
        </div>
      )}

      <div style={{ display: "grid", gap: "1rem" }}>
        <TileRow>
          <StatTile
            label="Remaining today"
            value={loading ? "—" : remaining.length}
            note={nextUp ? `Next at ${timeLabel(nextUp.scheduledAt)}` : "Nothing left to file"}
            tone="plain"
          />
          <StatTile
            label="Completed today"
            value={loading ? "—" : done.length}
            note={done.length > 0 ? "Reports filed" : "None filed yet"}
            tone="done"
          />
          <StatTile
            label="Tomorrow"
            value={loading ? "—" : tomorrowJobs.length}
            note={tomorrowJobs.length === 1 ? "Assigned visit" : "Assigned visits"}
            tone="plain"
          />
          <StatTile
            label="Needs attention"
            value={loading ? "—" : reportsToFile.length + signaturesToAdd.length}
            note="Reports or signatures"
            tone={reportsToFile.length + signaturesToAdd.length > 0 ? "warning" : "done"}
          />
        </TileRow>

        <Panel title="Field summary" action="This week">
          <TileRow min="145px">
            <StatTile label="Scheduled this week" value={loading ? "—" : weeklyJobs.length} note="Assigned visits" />
            <StatTile label="Reports filed" value={loading ? "—" : weeklyFiled} note="Completed reports" tone="done" />
            <StatTile label="Reports to file" value={loading ? "—" : weeklyJobs.length - weeklyFiled} note="Visits still open" tone={weeklyJobs.length - weeklyFiled > 0 ? "attn" : "done"} />
          </TileRow>
          {nextScheduled ? (
            <div style={{ padding: "0.8rem", borderRadius: "10px", background: "#fff7ed", border: "1px solid #fed7aa" }}>
              <div style={{ color: "#9a3412", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Next scheduled visit</div>
              <div style={{ marginTop: "0.25rem", color: colors.ink, fontSize: "0.92rem", fontWeight: 800 }}>{nameOf(nextScheduled)}</div>
              <div style={{ marginTop: "0.2rem", color: colors.body, fontSize: "0.78rem" }}>{new Date(nextScheduled.scheduledAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {nextScheduled.durationMinutes || 60} minutes</div>
              <div style={{ marginTop: "0.15rem", color: colors.muted, fontSize: "0.75rem" }}>{whereOf(nextScheduled) || "No service address recorded."}</div>
            </div>
          ) : <Empty>No upcoming visit is scheduled.</Empty>}
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(280px, 1fr)", gap: "1rem", alignItems: "start" }}>
          <Panel title="Needs attention" action={`${reportsToFile.length + signaturesToAdd.length} open items`}>
            {reportsToFile.length === 0 && signaturesToAdd.length === 0 && <Empty>Everything assigned this week is up to date.</Empty>}
            {reportsToFile.map((appointment, index) => (
              <JobRow
                key={`report-${appointment.id}`}
                first={index === 0}
                when={timeLabel(appointment.scheduledAt)}
                title={nameOf(appointment)}
                detail={["Report still to file", appointment.pestConcern].filter(Boolean).join(" · ")}
                action={<Link to="/scheduling" style={{ ...primaryButton, textDecoration: "none", padding: "0.45rem 0.65rem", fontSize: "0.72rem", whiteSpace: "nowrap" }}>Open report</Link>}
              />
            ))}
            {signaturesToAdd.map((appointment, index) => (
              <JobRow
                key={`signature-${appointment.id}`}
                first={reportsToFile.length === 0 && index === 0}
                when={timeLabel(appointment.scheduledAt)}
                title={nameOf(appointment)}
                detail="Technician signature still needed"
                action={<Link to={`/scheduling?appointment=${encodeURIComponent(appointment.id)}&tab=Report`} style={{ ...primaryButton, textDecoration: "none", padding: "0.45rem 0.65rem", fontSize: "0.72rem", whiteSpace: "nowrap" }}>Sign report</Link>}
              />
            ))}
          </Panel>

          <Panel title="Field tools" action="Quick access">
            <div style={{ display: "grid", gap: "0.55rem" }}>
              <Link to="/scheduling" style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.65rem 0.7rem", borderRadius: "10px", background: "#fff7ed", color: "#9a3412", textDecoration: "none", fontSize: "0.78rem", fontWeight: 800 }}>
                <ClipboardCheck size={16} /> Open service reports <ArrowRight size={14} style={{ marginLeft: "auto" }} />
              </Link>
              <Link to="/clients" style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.65rem 0.7rem", borderRadius: "10px", background: "#f0f9f5", color: "#1f7a5f", textDecoration: "none", fontSize: "0.78rem", fontWeight: 800 }}>
                <MapPinned size={16} /> Find client history <ArrowRight size={14} style={{ marginLeft: "auto" }} />
              </Link>
              <Link to="/inventory" style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.65rem 0.7rem", borderRadius: "10px", background: "#f8fafc", color: colors.body, textDecoration: "none", fontSize: "0.78rem", fontWeight: 800 }}>
                <PackageSearch size={16} /> Check inventory <ArrowRight size={14} style={{ marginLeft: "auto" }} />
              </Link>
            </div>
          </Panel>
        </div>

        <Panel title="My schedule today" action={new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}>
          {loading && mineToday.length === 0 && <Empty>Loading your schedule…</Empty>}
          {!loading && mineToday.length === 0 && <Empty>No visits booked for you today.</Empty>}
          {mineToday.map((appointment, index) => (
            <JobRow
              key={appointment.id}
              first={index === 0}
              when={timeLabel(appointment.scheduledAt)}
              title={nameOf(appointment)}
              detail={[whereOf(appointment), appointment.pestConcern].filter(Boolean).join(" · ")}
              action={appointment.reportSubmitted
                ? <Chip tone="done">Filed</Chip>
                : <Link to="/scheduling" style={{ ...primaryButton, textDecoration: "none", padding: "0.55rem 0.8rem", fontSize: "0.78rem", whiteSpace: "nowrap" }}>File Report</Link>}
            />
          ))}
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
          <Panel title="Tomorrow's route" action={tomorrowJobs.length ? `${tomorrowJobs.length} visits` : "No visits"}>
            {tomorrowJobs.length === 0 ? <Empty>No visits are assigned for tomorrow.</Empty> : tomorrowJobs.map((appointment, index) => (
              <JobRow
                key={appointment.id}
                first={index === 0}
                when={timeLabel(appointment.scheduledAt)}
                title={nameOf(appointment)}
                detail={[whereOf(appointment), appointment.serviceType || appointment.pestConcern].filter(Boolean).join(" · ")}
                action={<Chip tone={appointment.reportSubmitted ? "done" : "attn"}>{appointment.reportSubmitted ? "Filed" : "Open"}</Chip>}
              />
            ))}
          </Panel>

          <Panel title="Recent completed work" action="Latest reports">
            {recentCompleted.length === 0 ? <Empty>No completed reports yet.</Empty> : recentCompleted.map((appointment, index) => (
              <JobRow
                key={appointment.id}
                first={index === 0}
                when={timeLabel(appointment.reportSubmittedAt || appointment.scheduledAt)}
                title={nameOf(appointment)}
                detail={[appointment.treatmentMethods?.length ? `${appointment.treatmentMethods.length} treatment method${appointment.treatmentMethods.length === 1 ? "" : "s"}` : "Report filed", appointment.technicianSignaturePath ? "Signed" : "Signature pending"].join(" · ")}
                action={appointment.technicianSignaturePath
                  ? <Chip tone="done">Complete</Chip>
                  : <Link to={`/scheduling?appointment=${encodeURIComponent(appointment.id)}&tab=Report`} style={{ textDecoration: "none" }}><Chip tone="attn">Sign</Chip></Link>}
              />
            ))}
          </Panel>

          <Panel title="Supplies to watch" action={inventoryLoading ? "Loading" : `${lowStock.length} shown`}>
            {lowStock.length === 0 ? <Empty>No items are currently at or below reorder level.</Empty> : lowStock.map((item, index) => (
              <JobRow
                key={item.id}
                first={index === 0}
                when={`${item.quantity} ${item.unit || ""}`}
                title={item.name}
                detail={`Reorder level: ${item.reorderLevel} ${item.unit || ""}`}
                action={<Chip tone="crit">Low</Chip>}
              />
            ))}
          </Panel>
        </div>

      </div>
    </div>
  );
}

export default TechnicianDashboard;
