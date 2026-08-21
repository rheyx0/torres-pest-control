import { CalendarDays, CheckCircle2, CircleDollarSign, Clock3, TrendingUp } from "lucide-react";
import { mockAppointments } from "../../data/mockData";
import useAuth from "../../hooks/useAuth";
import { card, colors, pageShell } from "../../styles/theme";

const statusColors = {
  Pending: { background: "#fff2cc", color: "#9a6700" },
  "In Progress": { background: "#dce9ff", color: "#2454a6" },
  Completed: { background: "#d7f6e7", color: "#087443" },
  Cancelled: { background: "#f9dddd", color: "#a52b2b" },
};

const serviceColors = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6"];

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${date}T00:00:00`)
  );
}

function DashboardOverview() {
  const { currentUser } = useAuth();
  const totalAppointments = mockAppointments.length;
  const pendingAppointments = mockAppointments.filter((appointment) => appointment.status === "Pending").length;
  const completedAppointments = mockAppointments.filter((appointment) => appointment.status === "Completed").length;
  const serviceCounts = mockAppointments.reduce((counts, appointment) => {
    counts[appointment.pestType] = (counts[appointment.pestType] || 0) + 1;
    return counts;
  }, {});
  const topServices = Object.entries(serviceCounts).sort(([, first], [, second]) => second - first);

  return (
    <div style={pageShell}>
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ color: colors.brandInk, fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Overview
        </div>
        <h1 style={{ margin: "0.35rem 0 0", color: colors.ink, fontSize: "2rem", lineHeight: 1.15 }}>
          Welcome back, {currentUser?.name || "there"}
        </h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <SummaryCard title="Total Appointments" value={totalAppointments} detail="All records in system" Icon={CalendarDays} accent="#2563eb" />
        <SummaryCard title="Pending" value={pendingAppointments} detail="Awaiting service" Icon={Clock3} accent="#d97706" />
        <SummaryCard title="Completed" value={completedAppointments} detail="Successfully done" Icon={CheckCircle2} accent="#16a34a" />
        <div style={{ ...card, background: `linear-gradient(135deg, ${colors.brand} 0%, #b83227 100%)`, color: "#fff", borderColor: "transparent", minHeight: "128px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.86 }}>Business Wealth</span>
            <CircleDollarSign size={22} />
          </div>
          <div style={{ fontSize: "1.85rem", fontWeight: 800, lineHeight: 1.1 }}>₱128,400</div>
          <div style={{ marginTop: "0.4rem", fontSize: "0.78rem", opacity: 0.82 }}>Projected service value</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(260px, 1fr)", gap: "1rem", alignItems: "stretch", marginBottom: "1rem" }}>
        <section style={{ ...card, padding: 0, overflow: "hidden" }}>
          <SectionHeader title="Recent Appointments" />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "620px" }}>
              <thead><tr>{["Client", "Service", "Type", "Date", "Status"].map((heading) => <th key={heading} style={tableHeading}>{heading}</th>)}</tr></thead>
              <tbody>
                {mockAppointments.slice(0, 5).map((appointment) => {
                  const status = statusColors[appointment.status] || statusColors.Pending;
                  return <tr key={appointment.id}>
                    <td style={tableCell}><strong>{appointment.clientName}</strong></td>
                    <td style={tableCell}>{appointment.pestType}</td>
                    <td style={tableCell}>{appointment.clientType.split(" (")[0]}</td>
                    <td style={tableCell}>{formatDate(appointment.date)}</td>
                    <td style={tableCell}><span style={{ ...status, borderRadius: "999px", display: "inline-block", fontSize: "0.76rem", fontWeight: 800, padding: "0.35rem 0.65rem" }}>{appointment.status}</span></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ ...card, padding: 0, overflow: "hidden" }}>
          <SectionHeader title="Service Analytics" />
          <div style={{ padding: "1rem 1.25rem" }}>
            {topServices.map(([service, count], index) => {
              const percentage = Math.round((count / totalAppointments) * 100);
              return <div key={service} style={{ marginBottom: index === topServices.length - 1 ? 0 : "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", color: colors.body, fontSize: "0.82rem", fontWeight: 700 }}><span>{service}</span><span style={{ color: colors.muted }}>{percentage}%</span></div>
                <div style={{ height: "7px", marginTop: "0.45rem", borderRadius: "999px", background: "#edf0f3" }}><div style={{ width: `${percentage}%`, height: "100%", borderRadius: "inherit", background: serviceColors[index % serviceColors.length] }} /></div>
              </div>;
            })}
          </div>
        </section>
      </div>

      <section style={{ ...card, background: `linear-gradient(135deg, ${colors.brand} 0%, #561313 100%)`, color: "#fff", borderColor: "transparent" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div><div style={{ fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.8 }}>Business Wealth Analytics</div><h2 style={{ margin: "0.4rem 0 0", fontSize: "1.4rem" }}>Service performance at a glance</h2></div>
          <TrendingUp size={28} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginTop: "1.35rem" }}>
          <WealthStat label="Projected value" value="₱128,400" />
          <WealthStat label="Average service" value="₱32,100" />
          <WealthStat label="Completion rate" value={`${Math.round((completedAppointments / totalAppointments) * 100)}%`} />
          <WealthStat label="Active pipeline" value={`${pendingAppointments + mockAppointments.filter((item) => item.status === "In Progress").length} jobs`} />
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ title, value, detail, Icon, accent }) {
  return <div style={card}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}><span style={{ color: colors.muted, fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{title}</span><span style={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 14, background: `${accent}18`, color: accent }}><Icon size={20} /></span></div>
    <div style={{ color: colors.ink, fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{value}</div><div style={{ marginTop: "0.45rem", color: colors.muted, fontSize: "0.78rem" }}>{detail}</div>
  </div>;
}

function SectionHeader({ title }) { return <div style={{ borderBottom: `1px solid ${colors.line}`, padding: "1rem 1.25rem", color: colors.ink, fontSize: "0.98rem", fontWeight: 800 }}>{title}</div>; }
function WealthStat({ label, value }) { return <div style={{ borderLeft: "2px solid rgba(255,255,255,0.28)", paddingLeft: "0.8rem" }}><div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{value}</div><div style={{ marginTop: "0.25rem", fontSize: "0.76rem", opacity: 0.75 }}>{label}</div></div>; }

const tableHeading = { padding: "0.75rem 0.9rem", borderBottom: `1px solid ${colors.line}`, background: "#f5f6f8", color: "#7b8798", fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.05em", textAlign: "left", textTransform: "uppercase" };
const tableCell = { padding: "0.85rem 0.9rem", borderBottom: `1px solid ${colors.line}`, color: colors.body, fontSize: "0.82rem", whiteSpace: "nowrap" };

export default DashboardOverview;
