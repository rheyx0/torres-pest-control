// Technician view: "Your day". Phone first, and a proper two-column page on a
// computer, in the same parchment-and-maroon theme as the office dashboard.
//
//   - a plain header: the date, the greeting, and a thin bar for the day's
//     progress;
//   - four figures for the day in one joined strip: visits, done, work left
//     (as "1h 30m"), reports to file;
//   - the next seven days as a strip, each with its status: visits, done,
//     off, or free;
//   - Today's visits as a slim row of chips, one per visit (done, now, later);
//   - Up next, always there: the next visit with Start, or "No appointment
//     today" with the next one booked;
//   - the Up next card: where, what, the site note, Directions, Call site, and
//     the one big action — Start visit, or Continue once it is under way;
//   - Later today, Done (with a "Sign" nudge where the customer has not
//     signed), and any reports still owed from earlier this week;
//   - Coming up this week, last in the main column, stretching to meet the
//     side panel so neither column leaves an empty gap;
//   - beside them on a wide screen (below on a phone), one panel: their month
//     so far, stock they have checked out (migration 054), what they finished
//     recently and their time off (057).
//
// Appointment reads are scoped to the signed-in technician by migration 030,
// so every figure here is theirs.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, Bug, CalendarDays, CalendarX2, Check, CheckCircle2, MapPin, Navigation, Package, Phone, Plane } from "lucide-react";
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
import { absenceDates, currentAndUpcoming, outOn } from "../../utils/absences";
import { formatDuration } from "../../utils/calendarDates";
import { useConfirm } from "../../context/ConfirmContext";

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

/** "1h 30m": short, so the figure fits its tile on one line. */
export function shortDuration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return { hours, minutes: rest };
}

const unit = { fontFamily: "inherit", fontSize: "14px", color: neutral.bark, marginLeft: "1px", marginRight: "4px" };

/** One figure for the day. */
function Stat({ label, value, tone }) {
  return (
    <div style={{ background: surface.panel, padding: "14px 16px" }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: neutral.bark }}>{label}</div>
      <div style={{ marginTop: "2px", font: `500 24px/1.2 ${font.display}`, color: tone === "danger" ? semantic.danger : neutral.ink, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

/** The work-left figure: "1h 30m", with the units small. */
function WorkLeft({ minutes }) {
  const parts = shortDuration(minutes);
  if (!parts) return "—";
  return (
    <>
      {parts.hours > 0 && <>{parts.hours}<span style={unit}>h</span></>}
      {parts.minutes > 0 && <>{parts.minutes}<span style={unit}>m</span></>}
    </>
  );
}

/**
 * Today's visits as a slim row of chips, one per visit: a check when done,
 * a ringed dot for the one up next, a plain dot for the rest.
 */
function TodaysVisits({ visits, upNext, clientName, loading }) {
  const doneCount = visits.filter(isDone).length;
  return (
    <section aria-label="Today's visits" style={{ ...card, padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <span style={{ fontSize: "11.5px", letterSpacing: "0.09em", textTransform: "uppercase", color: neutral.saddle }}>Today</span>
      {visits.length === 0 ? (
        <span style={{ fontSize: "13.5px", color: neutral.bark }}>{loading ? "Loading…" : "No visits today"}</span>
      ) : (
        <ol aria-label={`${doneCount} of ${visits.length} visits done`} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {visits.map((entry) => {
            const done = isDone(entry);
            const current = entry === upNext;
            return (
              <li
                key={entry.id}
                title={`${clock(entry.scheduledAt)} · ${clientName(entry)}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px 4px 8px",
                  borderRadius: "999px", fontSize: "12.5px", fontVariantNumeric: "tabular-nums",
                  border: `1px solid ${current ? brand.base : colors.line}`,
                  background: current ? brand.wash : surface.panel,
                  color: done ? neutral.bark : neutral.ink,
                }}
              >
                {done
                  ? <Check size={13} strokeWidth={2.5} aria-hidden="true" style={{ color: semantic.success }} />
                  : <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: current ? brand.base : neutral.loam }} />}
                <span style={{ fontWeight: current ? weight.medium : weight.regular }}>{clock(entry.scheduledAt)}</span>
                <span style={{ maxWidth: "14ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: done ? "line-through" : "none" }}>{clientName(entry)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {visits.length > 0 && <span style={{ marginLeft: "auto", fontSize: "12.5px", color: neutral.saddle }}>{doneCount} of {visits.length} done</span>}
    </section>
  );
}

/** How a day in the strip reads: off, all done, visits booked, or free. */
function dayStatus(day) {
  if (day.off) return { text: `Off${day.off.reason ? ` · ${day.off.reason}` : ""}`, color: semantic.warning };
  if (day.count > 0 && day.done === day.count) return { text: "Done", color: semantic.success, Icon: CheckCircle2 };
  if (day.count > 0) return { text: `${day.count} visit${day.count === 1 ? "" : "s"}`, color: brand.base };
  return { text: "Free", color: neutral.bark };
}

/** The next seven days, starting today, each with its status. */
function WeekStrip({ days }) {
  return (
    <ol aria-label="Your next seven days" className="dash-joined" style={{ listStyle: "none", padding: 0, marginTop: "14px", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
      {days.map((day) => {
        const status = dayStatus(day);
        return (
          <li
            key={day.key}
            aria-label={`${day.date.toLocaleDateString([], { weekday: "long" })}: ${day.off ? status.text : `${day.count} ${day.count === 1 ? "visit" : "visits"}`}`}
            style={{ background: day.off ? semantic.warningSurface : surface.panel, padding: "10px 4px 9px", display: "grid", justifyItems: "center", gap: "3px", minWidth: 0 }}
          >
            <span style={{ fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: day.isToday ? brand.base : neutral.bark, fontWeight: day.isToday ? weight.medium : weight.regular }}>
              {day.isToday ? "Today" : day.date.toLocaleDateString([], { weekday: "short" })}
            </span>
            <span style={{
              width: "30px", height: "30px", borderRadius: "50%", display: "grid", placeItems: "center",
              font: `500 16px/1 ${font.display}`,
              background: day.isToday ? brand.base : "transparent",
              color: day.isToday ? surface.canvas : neutral.ink,
            }}>
              {day.date.getDate()}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px", color: status.color, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {status.Icon && <status.Icon size={11} aria-hidden="true" />}
              {status.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The rest of the week, in the main column: a date block, the client and
 * what is booked, and the time. It stretches (flex: 1) to meet the side
 * panel, so neither column leaves an empty gap under it.
 */
function ComingUp({ visits, clientName }) {
  return (
    <section aria-label="This week" style={{ ...card, marginTop: "14px", padding: "14px 16px", flex: 1, display: "flex", flexDirection: "column" }}>
      <h3 style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: "8px", font: `500 15px/1.3 ${font.display}`, color: neutral.ink }}>
        <CalendarDays size={16} aria-hidden="true" style={{ color: brand.base }} /> Coming up this week
        <Link to="/scheduling" style={{ marginLeft: "auto", fontFamily: "inherit", fontSize: "12.5px", color: brand.base, textDecoration: "none" }}>Full schedule</Link>
      </h3>
      {visits.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", minHeight: "90px", textAlign: "center", color: neutral.bark, fontSize: "13px" }}>
          <span>
            <CalendarDays size={22} aria-hidden="true" style={{ display: "block", margin: "0 auto 6px", color: neutral.loam }} />
            No more visits booked this week.
          </span>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {visits.slice(0, 6).map((entry) => {
            const date = new Date(entry.scheduledAt);
            return (
              <li key={entry.id} style={{ borderTop: `1px solid ${colors.line}` }}>
                <Link to={`/scheduling?appointment=${encodeURIComponent(entry.id)}`} style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", gap: "12px", alignItems: "center", padding: "10px 0", color: "inherit", textDecoration: "none" }}>
                  <span style={{ textAlign: "center", lineHeight: 1.1 }}>
                    <span style={{ display: "block", fontSize: "10.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: neutral.bark }}>{date.toLocaleDateString([], { weekday: "short" })}</span>
                    <span style={{ display: "block", font: `500 18px/1.2 ${font.display}`, color: neutral.ink }}>{date.getDate()}</span>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", color: neutral.ink, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clientName(entry)}</span>
                    <span style={{ display: "block", color: neutral.saddle, fontSize: "12.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.serviceType || entry.pestConcern || "Service visit"}</span>
                  </span>
                  <span style={{ color: neutral.saddle, fontSize: "13px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{clock(entry.scheduledAt)}</span>
                </Link>
              </li>
            );
          })}
          {visits.length > 6 && (
            <li style={{ borderTop: `1px solid ${colors.line}`, padding: "8px 0 0", fontSize: "13px" }}>
              <Link to="/scheduling" style={{ color: brand.base }}>+{visits.length - 6} more on the schedule</Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Up next when nothing is left today: says so, and shows what is coming. */
function NoAppointmentCard({ nextVisit, clientName }) {
  return (
    <section aria-label="Up next" style={{ ...card, borderTop: `4px solid ${neutral.loam}`, padding: "18px 20px 20px", marginTop: "14px" }}>
      <p style={{ margin: 0, fontSize: "11.5px", letterSpacing: "0.1em", textTransform: "uppercase", color: neutral.saddle, fontWeight: weight.medium }}>Up next</p>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "10px" }}>
        <span aria-hidden="true" style={{ width: "44px", height: "44px", borderRadius: "50%", display: "grid", placeItems: "center", background: surface.sunken, color: brand.base, flexShrink: 0 }}>
          <CalendarX2 size={21} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, font: `500 22px/1.25 ${font.display}`, color: neutral.ink }}>No appointment today</h2>
          <p style={{ margin: "3px 0 0", color: neutral.saddle, fontSize: "14px" }}>
            {nextVisit
              ? <>Next: <Link to={`/scheduling?appointment=${encodeURIComponent(nextVisit.id)}`} style={{ color: brand.base }}>{clientName(nextVisit)}</Link>, {new Date(nextVisit.scheduledAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at {clock(nextVisit.scheduledAt)}</>
              : "Nothing else booked for you yet."}
          </p>
        </div>
      </div>
      <Link to="/scheduling" style={{ ...outlineButton, marginTop: "16px", width: "100%" }}>
        <CalendarDays size={17} aria-hidden="true" /> Open schedule
      </Link>
    </section>
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
      style={{ ...card, borderTop: `4px solid ${brand.base}`, padding: "18px 20px 20px", marginTop: "14px" }}
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
    <section aria-label={title} style={{ padding: "14px 16px", borderTop: `1px solid ${colors.line}` }}>
      <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: "8px", font: `500 15px/1.3 ${font.display}`, color: neutral.ink }}>
        <Icon size={16} aria-hidden="true" style={{ color: brand.base }} /> {title}
      </h3>
      {children}
    </section>
  );
}

const plainLink = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  color: brand.base,
  textDecoration: "none",
  fontWeight: weight.medium,
};

const sideEmpty = { margin: 0, color: neutral.bark, fontSize: "13px" };
const sideRow = { display: "flex", justifyContent: "space-between", gap: "10px", padding: "7px 0", borderTop: `1px solid ${colors.line}`, fontSize: "13px" };

function TechnicianDashboard() {
  const { currentUser } = useAuth();
  const { appointments, absences = [], loading, error, startVisit } = useScheduling();
  const { clients } = useClients();
  const { movements = [] } = useInventory();
  const { users } = useUsers();
  const { showError } = useToast();
  const confirm = useConfirm();
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

  // Their live visits, for the week strip, the next visit and the month.
  const mine = appointments.filter((entry) => isAssignedTo(entry, me) && entry.status !== "Cancelled");
  const nextVisit = mine
    .filter((entry) => !isDone(entry) && dayKey(entry.scheduledAt) > todayKey)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0] || null;
  const myAbsences = absences.filter((absence) => absence.technicianId === me);
  const weekDays = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    const key = dayKey(date);
    const onDay = mine.filter((entry) => dayKey(entry.scheduledAt) === key);
    return { key, date, isToday: offset === 0, count: onDay.length, done: onDay.filter(isDone).length, off: outOn(myAbsences, key)[0] || null };
  });
  const recentlyDone = mine
    .filter((entry) => isDone(entry) && dayKey(entry.scheduledAt) <= todayKey)
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
    .slice(0, 4);
  const monthKey = todayKey.slice(0, 7);
  const thisMonth = mine.filter((entry) => dayKey(entry.scheduledAt).slice(0, 7) === monthKey);
  const monthDone = thisMonth.filter(isDone).length;
  const monthReports = thisMonth.filter((entry) => entry.reportSubmitted).length;
  const dayProgress = today.length ? Math.round((done.length / today.length) * 100) : 0;

  const handleStart = async () => {
    if (!upNext) return;
    if (upNext.status === "In progress") {
      navigate(`/visit/${upNext.id}`);
      return;
    }
    if (!(await confirm({ title: "Start this visit?", message: "Do this when you are on site. The office sees the visit as In progress.", confirmLabel: "Start visit" }))) return;
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
    // Full width: a centred cap left a wide empty band beside it on a big screen.
    <div style={{ width: "100%" }}>
      <header>
        <p style={{ margin: 0, fontSize: "11.5px", letterSpacing: "0.09em", textTransform: "uppercase", color: neutral.saddle }}>
          {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
          <h1 style={{ margin: "4px 0 0", font: `500 30px/1.2 ${font.display}`, letterSpacing: "-0.33px" }}>
            Your day{firstName(currentUser) ? `, ${firstName(currentUser)}` : ""}
          </h1>
          <span style={{ display: "flex", gap: "14px", marginLeft: "auto", fontSize: "13px" }}>
            <Link to="/scheduling" style={plainLink}><CalendarDays size={14} aria-hidden="true" /> Schedule</Link>
            <Link to="/inventory" style={plainLink}><Package size={14} aria-hidden="true" /> Stock</Link>
          </span>
        </div>
        <p style={{ margin: "6px 0 0", color: neutral.saddle }}>{summary}</p>
        <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            role="progressbar"
            aria-label="Today's visits done"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={dayProgress}
            style={{ flex: 1, height: "4px", borderRadius: "2px", background: surface.sunken, overflow: "hidden" }}
          >
            <span style={{ display: "block", height: "100%", width: `${dayProgress}%`, background: brand.base }} />
          </div>
          <span style={{ fontSize: "12px", color: neutral.bark, whiteSpace: "nowrap" }}>{today.length ? `${dayProgress}% of today done` : "A free day"}</span>
        </div>
      </header>

      <div className="tech-day-stats dash-joined" style={{ marginTop: "14px" }}>
        <Stat label="Visits today" value={today.length} />
        <Stat label="Done" value={done.length} />
        <Stat label="Work left" value={<WorkLeft minutes={minutesLeft} />} />
        <Stat label="Reports to file" value={owed.length + today.filter((entry) => isDone(entry) && !entry.reportSubmitted).length} tone={owed.length ? "danger" : undefined} />
      </div>


      {error && (
        <p role="alert" style={{ margin: "16px 0 0", padding: "10px 12px", borderRadius: radius.control, background: semantic.dangerSurface, color: semantic.danger }}>
          Couldn't load your schedule: {error}
        </p>
      )}

      <WeekStrip days={weekDays} />

      <div className="tech-day-grid">
        {/* A column, so Coming up can stretch: both columns end on one line. */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <TodaysVisits visits={today} upNext={upNext} clientName={clientName} loading={loading} />

          {upNext ? (
            <UpNextCard
              appointment={upNext}
              client={clientOf(upNext)}
              crewNames={crewOf(upNext).map(nameOf).filter(Boolean)}
              me={myName}
              onStart={handleStart}
              starting={starting}
              now={now}
            />
          ) : (
            <NoAppointmentCard nextVisit={nextVisit} clientName={clientName} />
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

          <ComingUp visits={thisWeek} clientName={clientName} />
        </div>

        <aside aria-label="More about your week" className="tech-side" style={{ ...card, marginTop: "14px", overflow: "hidden" }}>
          <SideCard title="Your month" Icon={BarChart3}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", textAlign: "center" }}>
              {[["Visits", thisMonth.length], ["Done", monthDone], ["Reports", monthReports]].map(([label, value], index) => (
                <div key={label} style={{ padding: "2px 4px", borderLeft: index ? `1px solid ${colors.line}` : "none" }}>
                  <div style={{ font: `500 22px/1.2 ${font.display}`, color: neutral.ink }}>{value}</div>
                  <div style={{ fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: neutral.bark }}>{label}</div>
                </div>
              ))}
            </div>
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

          <SideCard title="Recently done" Icon={CheckCircle2}>
            {recentlyDone.length === 0 ? (
              <p style={sideEmpty}>Nothing finished yet.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {recentlyDone.map((entry) => (
                  <li key={entry.id} style={sideRow}>
                    <Link to={`/scheduling?appointment=${encodeURIComponent(entry.id)}&tab=Report`} style={{ color: neutral.ink, textDecoration: "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {clientName(entry)}
                    </Link>
                    <span style={{ color: neutral.bark, whiteSpace: "nowrap" }}>
                      {new Date(entry.scheduledAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
