// Technician view: "Your day". Phone first, and a proper two-column page on a
// computer, in the same parchment-and-maroon theme as the office dashboard.
//
//   - four figures for the day: visits, done, work left, reports to file;
//   - the day as a timeline of points, one per visit: done, now, later;
//   - the Up next card: where, what, the site note, Directions, Call site, and
//     the one big action — Start visit, or Continue once it is under way;
//   - Later today, Done (with a "Sign" nudge where the customer has not
//     signed), and any reports still owed from earlier this week;
//   - beside them on a wide screen (below on a phone): the rest of the week,
//     stock they have checked out (migration 054) and their time off (057).
//
// Appointment reads are scoped to the signed-in technician by migration 030,
// so every figure here is theirs.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bug, CalendarDays, Check, MapPin, Navigation, Package, Phone, Plane } from "lucide-react";
import useAuth from "../../hooks/useAuth";
import useClients from "../../hooks/useClients";
import useInventory from "../../hooks/useInventory";
import useUsers from "../../hooks/useUsers";
import useNow from "../../hooks/useNow";
import { useScheduling } from "../../context/SchedulingContext";
import { useToast } from "../../context/ToastContext";
import { brand, font, neutral, radius, status as semantic, surface, weight } from "../../styles/tokens";
import { colors } from "../../styles/theme";
import StatusPill from "../ui/StatusPill";
import { crewOf, isAssignedTo } from "../../utils/scheduling";
import { dayKey, reportsDue } from "../../utils/dashboardMetrics";
import { directionsUrl, telUrl } from "../../utils/clientTimeline";
import { canStart, dayPlan, isDone, leadsCrew, workLeftLabel } from "../../utils/techDay";
import { openCheckouts } from "../../utils/custody";
import { absenceDates, currentAndUpcoming } from "../../utils/absences";
import { formatDuration } from "../../utils/calendarDates";

const clock = (value) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const firstName = (user) => (user?.name || user?.username || "").split(" ")[0];

const sectionLabel = {
  margin: "22px 0 4px",
  fontSize: "11.5px",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: neutral.saddle,
};

const card = { background: surface.panel, border: `1px solid ${colors.line}`, borderRadius: radius.card };

function VisitRow({ time, title, detail, badge, to }) {
  const [hm, ampm] = time.split(" ");
  return (
    <li style={{ borderBottom: `1px solid ${colors.line}` }}>
      <Link to={to} style={{ display: "grid", gridTemplateColumns: "58px minmax(0, 1fr) auto", gap: "12px", alignItems: "center", padding: "14px 0", color: "inherit", textDecoration: "none" }}>
        <span style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
          <span style={{ display: "block", color: neutral.ink, fontWeight: weight.medium }}>{hm}</span>
          <span style={{ display: "block", color: neutral.bark, fontSize: "12px" }}>{ampm}</span>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", font: `500 17px/1.3 ${font.display}`, color: neutral.ink }}>{title}</span>
          <span style={{ display: "block", color: neutral.saddle, fontSize: "13px" }}>{detail}</span>
        </span>
        {badge}
      </Link>
    </li>
  );
}

/** One figure for the day. */
function Stat({ label, value, tone }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: neutral.bark }}>{label}</div>
      <div style={{ marginTop: "2px", font: `500 24px/1.2 ${font.display}`, color: tone === "danger" ? semantic.danger : neutral.ink }}>{value}</div>
    </div>
  );
}

/**
 * The day as points on a line: a filled check for each visit done, a ringed
 * point for the one up next, an open one for the rest — labelled with times.
 */
function DayTimeline({ visits, upNext, clientName }) {
  if (visits.length === 0) return null;
  const doneCount = visits.filter(isDone).length;
  return (
    <ol
      aria-label={`${doneCount} of ${visits.length} visits done`}
      style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gridTemplateColumns: `repeat(${visits.length}, minmax(0, 1fr))` }}
    >
      {visits.map((entry, index) => {
        const done = isDone(entry);
        const current = entry === upNext;
        return (
          <li key={entry.id} title={`${clock(entry.scheduledAt)} · ${clientName(entry)}`} style={{ position: "relative", display: "grid", justifyItems: "center", gap: "6px" }}>
            {index < visits.length - 1 && (
              <span aria-hidden="true" style={{ position: "absolute", top: "13px", left: "50%", width: "100%", height: "3px", borderRadius: "2px", background: done ? brand.base : surface.sunken }} />
            )}
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontSize: "12px",
                fontWeight: weight.medium,
                background: done ? brand.base : surface.panel,
                color: done ? surface.canvas : current ? brand.base : neutral.bark,
                border: `2px solid ${done || current ? brand.base : neutral.loam}`,
                boxShadow: current ? `0 0 0 4px ${brand.wash}` : "none",
              }}
            >
              {done ? <Check size={14} strokeWidth={2.5} /> : index + 1}
            </span>
            <span aria-hidden="true" style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums", color: current ? brand.base : done ? neutral.ink : neutral.bark, fontWeight: current ? weight.medium : weight.regular }}>
              {clock(entry.scheduledAt)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const outlineButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  minHeight: "46px",
  borderRadius: radius.control,
  border: `1px solid ${neutral.loam}`,
  background: surface.panel,
  color: neutral.ink,
  textDecoration: "none",
  fontSize: "15px",
  fontWeight: weight.medium,
};

function UpNextCard({ appointment, client, crewNames, me, onStart, starting, now }) {
  const inProgress = appointment.status === "In progress";
  const startable = canStart(appointment, now);
  const address = appointment.serviceLocation || client?.address || "";
  const tel = telUrl(client?.phone);
  const others = crewNames.filter((name) => name !== me);

  return (
    <section
      aria-label="Up next"
      style={{ ...card, borderTop: `4px solid ${brand.base}`, padding: "18px 20px 20px", marginTop: "18px" }}
    >
      <p style={{ margin: 0, fontSize: "11.5px", letterSpacing: "0.1em", textTransform: "uppercase", color: brand.base, fontWeight: weight.medium }}>
        {inProgress ? "In progress" : "Up next"} · {clock(appointment.scheduledAt)}
        {others.length ? ` · with ${others.join(", ")}` : ""}
      </p>
      <h2 style={{ margin: "8px 0 10px", font: `500 26px/1.2 ${font.display}`, color: neutral.ink }}>{client?.name || "Visit"}</h2>
      {address && (
        <p style={{ margin: "0 0 6px", display: "flex", gap: "8px", alignItems: "flex-start", color: neutral.saddle }}>
          <MapPin size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px", color: brand.base }} />
          {address}
        </p>
      )}
      <p style={{ margin: 0, display: "flex", gap: "8px", alignItems: "flex-start", color: neutral.saddle }}>
        <Bug size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px", color: brand.base }} />
        {[appointment.pestConcern, appointment.serviceType, formatDuration(appointment.durationMinutes || 60)].filter(Boolean).join(" · ")}
      </p>
      {client?.serviceNotes && (
        <p style={{ margin: "14px 0 0", padding: "10px 12px", borderRadius: radius.control, background: surface.sunken, color: neutral.ink, fontSize: "14px", lineHeight: 1.5 }}>
          <b style={{ fontWeight: 600 }}>Site note:</b> {client.serviceNotes}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "16px" }}>
        {address ? (
          <a href={directionsUrl(address)} target="_blank" rel="noopener noreferrer" style={outlineButton}>
            <Navigation size={17} aria-hidden="true" /> Directions
          </a>
        ) : (
          <span style={{ ...outlineButton, opacity: 0.5 }}>No address</span>
        )}
        {tel ? (
          <a href={tel} style={outlineButton}>
            <Phone size={17} aria-hidden="true" /> Call site
          </a>
        ) : (
          <span style={{ ...outlineButton, opacity: 0.5 }}>No phone</span>
        )}
      </div>
      {(inProgress || startable) && (
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          style={{
            marginTop: "10px",
            width: "100%",
            minHeight: "54px",
            border: 0,
            borderRadius: radius.control,
            background: brand.base,
            color: surface.canvas,
            fontSize: "17px",
            fontWeight: weight.medium,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            cursor: starting ? "default" : "pointer",
            opacity: starting ? 0.7 : 1,
          }}
        >
          {starting ? "Starting…" : inProgress ? "Continue visit" : "Start visit"} <ArrowRight size={18} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** A card in the side column. */
function SideCard({ title, Icon, children }) {
  return (
    <section aria-label={title} style={{ ...card, padding: "14px 16px" }}>
      <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: "8px", font: `500 15px/1.3 ${font.display}`, color: neutral.ink }}>
        <Icon size={16} aria-hidden="true" style={{ color: brand.base }} /> {title}
      </h3>
      {children}
    </section>
  );
}

const sideEmpty = { margin: 0, color: neutral.bark, fontSize: "13px" };
const sideRow = { display: "flex", justifyContent: "space-between", gap: "10px", padding: "7px 0", borderTop: `1px solid ${colors.line}`, fontSize: "13px" };

function TechnicianDashboard() {
  const { currentUser } = useAuth();
  const { appointments, absences = [], loading, error, startVisit } = useScheduling();
  const { clients } = useClients();
  const { movements = [] } = useInventory();
  const { users } = useUsers();
  const { showError } = useToast();
  const navigate = useNavigate();
  const now = useNow(60000);
  const [starting, setStarting] = useState(false);

  const me = currentUser?.id;
  const myName = currentUser?.name || currentUser?.username || "";
  const clientOf = (appointment) => clients.find((client) => client.id === appointment.clientId);
  const clientName = (appointment) => clientOf(appointment)?.name || "Visit";
  const nameOf = (id) => {
    const person = users.find((user) => user.id === id);
    return person?.name || person?.username || "";
  };

  const plan = dayPlan(appointments, me, now);
  const { today, done, upNext, later, minutesLeft } = plan;
  const owed = reportsDue(appointments, me, now).filter((entry) => !today.includes(entry));

  // The rest of the week: their visits after today, the next seven days.
  const todayKey = dayKey(now);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const thisWeek = appointments
    .filter((entry) => isAssignedTo(entry, me) && !["Cancelled", "Completed"].includes(entry.status))
    .filter((entry) => dayKey(entry.scheduledAt) > todayKey && new Date(entry.scheduledAt) < weekEnd)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const carrying = openCheckouts(movements).filter(({ checkout }) => checkout.technicianId === me);
  const timeOff = currentAndUpcoming(absences.filter((absence) => absence.technicianId === me), todayKey);

  const handleStart = async () => {
    if (!upNext) return;
    if (upNext.status === "In progress") {
      navigate(`/visit/${upNext.id}`);
      return;
    }
    setStarting(true);
    const result = await startVisit(upNext.id);
    setStarting(false);
    if (result !== true) {
      showError(result);
      return;
    }
    navigate(`/visit/${upNext.id}`);
  };

  const summary = loading
    ? "Loading your schedule…"
    : today.length === 0
      ? "Nothing booked for you today."
      : [`${done.length} done`, `${today.length - done.length} to go`, workLeftLabel(minutesLeft)].filter(Boolean).join(" · ");

  return (
    <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
      <p style={{ margin: 0, fontSize: "11.5px", letterSpacing: "0.09em", textTransform: "uppercase", color: neutral.saddle }}>
        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </p>
      <h1 style={{ margin: "4px 0 0", font: `500 30px/1.2 ${font.display}`, letterSpacing: "-0.33px" }}>
        Your day{firstName(currentUser) ? `, ${firstName(currentUser)}` : ""}
      </h1>
      <p style={{ margin: "8px 0 0", color: neutral.saddle }}>{summary}</p>

      <div className="tech-day-stats" style={{ marginTop: "16px" }}>
        <Stat label="Visits today" value={today.length} />
        <Stat label="Done" value={done.length} />
        <Stat label="Work left" value={minutesLeft ? formatDuration(minutesLeft) : "—"} />
        <Stat label="Reports to file" value={owed.length + today.filter((entry) => isDone(entry) && !entry.reportSubmitted).length} tone={owed.length ? "danger" : undefined} />
      </div>

      <DayTimeline visits={today} upNext={upNext} clientName={clientName} />

      {error && (
        <p role="alert" style={{ margin: "16px 0 0", padding: "10px 12px", borderRadius: radius.control, background: semantic.dangerSurface, color: semantic.danger }}>
          Couldn't load your schedule: {error}
        </p>
      )}

      <div className="tech-day-grid">
        <div style={{ minWidth: 0 }}>
          {upNext && (
            <UpNextCard
              appointment={upNext}
              client={clientOf(upNext)}
              crewNames={crewOf(upNext).map(nameOf).filter(Boolean)}
              me={myName}
              onStart={handleStart}
              starting={starting}
              now={now}
            />
          )}

          {later.length > 0 && (
            <>
              <p style={sectionLabel}>Later today</p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {later.map((entry) => {
                  const others = crewOf(entry).map(nameOf).filter((name) => name && name !== myName);
                  return (
                    <VisitRow
                      key={entry.id}
                      time={clock(entry.scheduledAt)}
                      title={clientName(entry)}
                      detail={[entry.pestConcern || entry.serviceType, others.length ? `with ${others.join(", ")}` : formatDuration(entry.durationMinutes || 60)].filter(Boolean).join(" · ")}
                      badge={leadsCrew(entry, me) ? <StatusPill tone="brand">Lead</StatusPill> : null}
                      to={`/scheduling?appointment=${encodeURIComponent(entry.id)}`}
                    />
                  );
                })}
              </ul>
            </>
          )}

          {done.length > 0 && (
            <>
              <p style={sectionLabel}>Done</p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {done.map((entry) => {
                  const unsigned = !entry.signaturePath;
                  return (
                    <VisitRow
                      key={entry.id}
                      time={clock(entry.scheduledAt)}
                      title={clientName(entry)}
                      detail={entry.reportSubmitted ? (unsigned ? "Report filed · awaiting signature" : "Report filed · signed") : "Completed"}
                      badge={unsigned && entry.reportSubmitted ? <StatusPill tone="warning">Sign</StatusPill> : null}
                      to={unsigned && entry.reportSubmitted ? `/visit/${entry.id}?step=Sign` : `/scheduling?appointment=${encodeURIComponent(entry.id)}&tab=Report`}
                    />
                  );
                })}
              </ul>
            </>
          )}

          {owed.length > 0 && (
            <>
              <p style={sectionLabel}>Reports still to file</p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {owed.map((entry) => (
                  <VisitRow
                    key={entry.id}
                    time={clock(entry.scheduledAt)}
                    title={clientName(entry)}
                    detail={`${new Date(entry.scheduledAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · no report yet`}
                    badge={<StatusPill tone="danger">Report due</StatusPill>}
                    to={`/visit/${entry.id}`}
                  />
                ))}
              </ul>
            </>
          )}

          {!loading && today.length === 0 && owed.length === 0 && (
            <p style={{ marginTop: "20px", color: neutral.bark }}>
              Nothing waiting. Your upcoming visits are on the{" "}
              <Link to="/scheduling" style={{ color: brand.base }}>
                schedule
              </Link>
              .
            </p>
          )}
        </div>

        <aside aria-label="More about your week" style={{ display: "grid", gap: "14px", alignContent: "start", marginTop: "18px" }}>
          <SideCard title="This week" Icon={CalendarDays}>
            {thisWeek.length === 0 ? (
              <p style={sideEmpty}>No more visits booked this week.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {thisWeek.slice(0, 6).map((entry) => (
                  <li key={entry.id} style={sideRow}>
                    <Link to={`/scheduling?appointment=${encodeURIComponent(entry.id)}`} style={{ color: neutral.ink, textDecoration: "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {clientName(entry)}
                    </Link>
                    <span style={{ color: neutral.bark, whiteSpace: "nowrap" }}>
                      {new Date(entry.scheduledAt).toLocaleDateString([], { weekday: "short" })} {clock(entry.scheduledAt)}
                    </span>
                  </li>
                ))}
                {thisWeek.length > 6 && (
                  <li style={{ ...sideRow, color: neutral.bark }}>
                    <Link to="/scheduling" style={{ color: brand.base }}>+{thisWeek.length - 6} more on the schedule</Link>
                  </li>
                )}
              </ul>
            )}
          </SideCard>

          <SideCard title="Stock you're carrying" Icon={Package}>
            {carrying.length === 0 ? (
              <p style={sideEmpty}>Nothing checked out to you.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {carrying.map(({ checkout, remaining }) => (
                  <li key={checkout.id} style={sideRow}>
                    <span style={{ color: neutral.ink }}>{checkout.itemName}</span>
                    <span style={{ color: neutral.saddle, fontVariantNumeric: "tabular-nums" }}>{remaining} {checkout.itemUnit}</span>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ ...sideEmpty, marginTop: "8px", fontSize: "12px" }}>Used first when you record a visit's materials.</p>
          </SideCard>

          <SideCard title="Time off" Icon={Plane}>
            {timeOff.length === 0 ? (
              <p style={sideEmpty}>None coming up.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {timeOff.map((absence) => (
                  <li key={absence.id} style={sideRow}>
                    <span style={{ color: neutral.ink }}>{absenceDates(absence)}</span>
                    <span style={{ color: neutral.saddle }}>{absence.reason || "Out"}</span>
                  </li>
                ))}
              </ul>
            )}
          </SideCard>
        </aside>
      </div>
    </div>
  );
}

export default TechnicianDashboard;
