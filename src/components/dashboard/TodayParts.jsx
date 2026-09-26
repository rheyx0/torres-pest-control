// Building blocks for the office "Today" dashboard: summary cards, the
// dispatch board, the Needs attention queue, the week chart and the
// recently-finished list. The data comes from utils/dispatch.js; these only
// draw it.

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Box,
  FileText,
  FlaskConical,
  PenLine,
  Repeat,
  Users,
  Wrench,
} from "lucide-react";
import { brand, font, neutral, radius, status as semantic, surface, weight } from "../../styles/tokens";
import { colors, quietButton } from "../../styles/theme";
import Avatar from "../ui/Avatar";
import Card from "../ui/Card";
import StatusPill from "../ui/StatusPill";
import { LegendSwatch } from "../scheduling/CalendarLegend";
import { statusVisual } from "../scheduling/appointmentTheme";
import { BOARD_END_HOUR, BOARD_START_HOUR, nowPlacement } from "../../utils/dispatch";
import { endOf, startOf } from "../../utils/scheduling";

const eyebrowText = {
  fontSize: "11.5px",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: neutral.saddle,
};

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

/** A clickable summary card: label, a big serif number, one line of context. */
export function KpiCard({ label, value, footer, to }) {
  return (
    <Link
      to={to}
      className="ui-interactive"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "16px 18px",
        background: surface.panel,
        border: `1px solid ${colors.line}`,
        borderRadius: radius.card,
        color: neutral.ink,
        textDecoration: "none",
        minWidth: 0,
      }}
    >
      <span style={eyebrowText}>{label}</span>
      <span style={{ font: `500 32px/1.1 ${font.display}`, marginTop: "6px", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12.5px", color: neutral.saddle, minHeight: "21px" }}>
        <span style={{ minWidth: 0 }}>{footer}</span>
        <ArrowRight size={14} aria-hidden="true" style={{ marginLeft: "auto", color: neutral.bark, flexShrink: 0 }} />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Dispatch board
// ---------------------------------------------------------------------------

const LANE_HEIGHT = 60;
const HOURS = Array.from({ length: BOARD_END_HOUR - BOARD_START_HOUR }, (_, index) => BOARD_START_HOUR + index);
const hourLabel = (hour) => String(hour > 12 ? hour - 12 : hour);
const trackGrid = `repeating-linear-gradient(90deg, transparent 0 calc(100% / ${HOURS.length} - 1px), ${colors.line} calc(100% / ${HOURS.length} - 1px) calc(100% / ${HOURS.length}))`;

/** Where a job is in its day: done, on site now, or just its status. */
function jobState(appointment, now) {
  if (appointment.status === "Completed" || appointment.reportSubmitted) return "done";
  if (appointment.status === "In progress") return "onsite";
  if (appointment.status === "Confirmed" && startOf(appointment) <= now.getTime() && endOf(appointment) > now.getTime()) return "onsite";
  return appointment.status;
}

function DispatchJob({ job, clientName, now, draggable, onDragStart }) {
  const { appointment, placement } = job;
  const state = jobState(appointment, now);
  const visual = statusVisual(state === "done" ? "Completed" : appointment.status);
  const detail =
    state === "done"
      ? `${appointment.pestConcern || appointment.serviceType || "Visit"} · done`
      : state === "onsite"
        ? `${appointment.pestConcern || appointment.serviceType || "Visit"} · on site`
        : draggable
          ? "Drag to assign"
          : appointment.status === "Pending"
            ? "Pending"
            : appointment.pestConcern || appointment.serviceType || appointment.status;
  const time = new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <Link
      to={`/scheduling?appointment=${encodeURIComponent(appointment.id)}`}
      draggable={draggable}
      onDragStart={(event) => {
        if (event.dataTransfer) {
          event.dataTransfer.setData("text/plain", appointment.id);
          event.dataTransfer.effectAllowed = "move";
        }
        onDragStart?.(appointment);
      }}
      title={`${clientName} · ${time} · ${appointment.status}`}
      data-status={appointment.status}
      style={{
        position: "absolute",
        top: "4px",
        bottom: "4px",
        left: `${placement.left}%`,
        width: `${placement.width}%`,
        borderRadius: "4px",
        borderWidth: "1px",
        borderStyle: visual.borderStyle,
        borderColor: neutral.loam,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: visual.edge,
        background: state === "onsite" ? "rgba(127, 17, 17, 0.07)" : visual.fill === "transparent" ? surface.panel : visual.fill,
        padding: "3px 8px",
        fontSize: "11.5px",
        lineHeight: 1.3,
        overflow: "hidden",
        whiteSpace: "nowrap",
        color: neutral.ink,
        textDecoration: "none",
        cursor: draggable ? "grab" : "pointer",
        zIndex: 1,
      }}
    >
      <b style={{ fontWeight: weight.medium, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{clientName}</b>
      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", color: neutral.saddle }}>{detail}</span>
    </Link>
  );
}

/**
 * One row per technician across 7 AM – 6 PM, with a line for now and an
 * Unassigned row. With `onAssign`, an unassigned visit can be dragged onto a
 * technician's row to give it to them.
 */
// `outIds` (migration 057): Map<technicianId, absence> for the board's day —
// the lane says "Out" and takes no drops.
export function DispatchBoard({ lanes, outIds = new Map(), day, now = new Date(), clientName, onAssign = null, dayChoice, onDayChange }) {
  const [dropLane, setDropLane] = useState(null);
  const [dragging, setDragging] = useState(null);
  const nowAt = nowPlacement(day, now);
  const nowLabel = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <Card
      title={dayChoice === "tomorrow" ? "Tomorrow's dispatch" : "Today's dispatch"}
      aside="7:00 AM – 6:00 PM"
      actions={
        <div role="group" aria-label="Day" style={{ display: "inline-flex", border: `1px solid ${neutral.loam}`, borderRadius: "4px", background: surface.panel, padding: "2px" }}>
          {["today", "tomorrow"].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={dayChoice === option}
              onClick={() => onDayChange(option)}
              style={{
                border: 0,
                borderRadius: "3px",
                padding: "4px 12px",
                fontSize: "12.5px",
                background: dayChoice === option ? neutral.ink : "transparent",
                color: dayChoice === option ? surface.canvas : neutral.saddle,
                cursor: "pointer",
              }}
            >
              {option === "today" ? "Today" : "Tomorrow"}
            </button>
          ))}
        </div>
      }
      padded={false}
    >
      <div className="scroll-x">
        <div style={{ minWidth: "720px", padding: "6px 18px 12px" }}>
          <div
            aria-hidden="true"
            style={{
              display: "grid",
              gridTemplateColumns: `150px repeat(${HOURS.length}, 1fr)`,
              fontSize: "11px",
              color: neutral.bark,
              padding: "8px 0 6px",
              borderBottom: `1px solid ${colors.line}`,
            }}
          >
            <span />
            {HOURS.map((hour) => (
              <span key={hour}>{hourLabel(hour)}</span>
            ))}
          </div>

          {lanes.map((lane, laneIndex) => {
            const isUnassigned = !lane.technician;
            const away = isUnassigned ? null : outIds.get(lane.technician.id);
            const canDropHere = Boolean(onAssign && dragging && !isUnassigned && !away);
            const name = isUnassigned ? "Unassigned" : lane.technician.name || lane.technician.username;
            return (
              <div
                key={lane.key}
                role="group"
                aria-label={away ? `${name}: out${away.reason ? ` (${away.reason})` : ""}` : `${name}: ${lane.jobs.length} ${lane.jobs.length === 1 ? "visit" : "visits"}`}
                onDragOver={(event) => {
                  if (!canDropHere) return;
                  event.preventDefault();
                  setDropLane(lane.key);
                }}
                onDragLeave={() => setDropLane((current) => (current === lane.key ? null : current))}
                onDrop={(event) => {
                  if (!canDropHere) return;
                  event.preventDefault();
                  setDropLane(null);
                  setDragging(null);
                  onAssign(dragging, lane.technician);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "150px 1fr",
                  alignItems: "center",
                  height: `${LANE_HEIGHT}px`,
                  borderBottom: laneIndex === lanes.length - 1 ? 0 : `1px solid ${colors.line}`,
                  background: dropLane === lane.key ? colors.brandWash : "transparent",
                }}
              >
                <span style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: isUnassigned ? neutral.bark : neutral.ink, minWidth: 0 }}>
                  <Avatar user={lane.technician} size="sm" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: away ? 0.6 : 1 }}>{name}</span>
                  {away && (
                    <span title={away.reason || "Out"} style={{ flex: "none", fontSize: "11px", color: "#9a2d24", border: "1px solid #f5c2bd", background: "#f9ecea", borderRadius: "999px", padding: "0 6px" }}>
                      Out
                    </span>
                  )}
                </span>
                <div style={{ position: "relative", height: "48px", background: trackGrid }}>
                  {nowAt !== null && (
                    <span
                      aria-hidden="true"
                      style={{ position: "absolute", top: "-6px", bottom: "-6px", left: `${nowAt}%`, borderLeft: `1.5px solid ${brand.base}`, zIndex: 2 }}
                    >
                      {laneIndex === 0 && (
                        <span style={{ position: "absolute", top: "-3px", left: "-4.5px", width: "7px", height: "7px", borderRadius: "50%", background: brand.base }} />
                      )}
                    </span>
                  )}
                  {lane.jobs
                    .filter((job) => job.placement)
                    .map((job) => (
                      <DispatchJob
                        key={job.appointment.id}
                        job={job}
                        now={now}
                        clientName={clientName(job.appointment.clientId)}
                        draggable={Boolean(onAssign && isUnassigned)}
                        onDragStart={setDragging}
                      />
                    ))}
                  {lane.jobs.length === 0 && (
                    <span style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", fontSize: "12px", color: neutral.bark }}>
                      {isUnassigned ? "Nothing waiting" : "No visits"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", alignItems: "center", fontSize: "12px", color: neutral.saddle, padding: "0 18px 14px" }}>
        {["Confirmed", "Pending", "Completed"].map((entry) => (
          <span key={entry} style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
            <LegendSwatch status={entry} />
            {entry}
          </span>
        ))}
        <span style={{ marginLeft: "auto", color: neutral.bark }}>
          {onAssign ? "Drag an unassigned visit onto a technician to assign it. " : ""}
          {nowAt !== null ? `Red line = now (${nowLabel})` : ""}
        </span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

const KIND_ICONS = {
  unassigned: Users,
  report: FileText,
  expiry: FlaskConical,
  maintenance: Wrench,
  reservice: Repeat,
  reorder: Box,
  signature: PenLine,
};

const TONE_TILES = {
  warning: { background: semantic.warningSurface, color: semantic.warning },
  danger: { background: semantic.dangerSurface, color: semantic.danger },
  neutral: { background: surface.sunken, color: neutral.saddle },
};

const rowStyle = (last) => ({
  display: "flex",
  gap: "12px",
  alignItems: "center",
  padding: "12px 18px",
  borderBottom: last ? 0 : `1px solid ${colors.line}`,
});

export function AttentionList({ items, loading = false }) {
  return (
    <Card
      title="Needs attention"
      actions={<StatusPill tone="neutral" dot={false}>{loading ? "…" : items.length}</StatusPill>}
      padded={false}
    >
      {items.length === 0 ? (
        <p style={{ margin: 0, padding: "16px 18px", color: neutral.bark }}>{loading ? "Checking…" : "Nothing needs you right now."}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item, index) => {
            const Icon = KIND_ICONS[item.kind] || FileText;
            const tile = TONE_TILES[item.tone] || TONE_TILES.neutral;
            return (
              <li key={item.key} style={rowStyle(index === items.length - 1)}>
                <span aria-hidden="true" style={{ width: "30px", height: "30px", borderRadius: "4px", display: "grid", placeItems: "center", flex: "none", ...tile }}>
                  <Icon size={16} strokeWidth={1.6} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontWeight: weight.medium, color: neutral.ink }}>{item.title}</span>
                  <span style={{ display: "block", fontSize: "12.5px", color: neutral.bark }}>{item.detail}</span>
                </span>
                <Link
                  to={item.action.to}
                  className="ui-interactive"
                  style={{ ...quietButton, padding: "0 10px", minHeight: "28px", display: "inline-flex", alignItems: "center", fontSize: "12.5px", textDecoration: "none", flexShrink: 0 }}
                >
                  {item.action.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Visits this week
// ---------------------------------------------------------------------------

export function WeekBarsCard({ bars, rangeLabel }) {
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const top = Math.max(...bars.map((bar) => bar.value), 1);
  return (
    <Card
      title="Visits this week"
      aside={`${rangeLabel} · ${total} total`}
      actions={
        <Link to="/scheduling" style={{ color: brand.base, fontWeight: weight.medium, fontSize: "12.5px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}>
          Open schedule <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
      padded={false}
    >
      <div style={{ padding: "14px 18px" }}>
        <div role="list" aria-label="Visits per day" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "10px", alignItems: "end", height: "130px" }}>
          {bars.map((bar) => (
            <div
              key={bar.key}
              role="listitem"
              aria-label={`${bar.label}: ${bar.value} ${bar.value === 1 ? "visit" : "visits"}${bar.isToday ? " (today)" : ""}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: "4px", fontSize: "12px" }}
            >
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: bar.isToday ? 600 : 400, color: neutral.ink }}>{bar.value}</span>
              <span
                style={{
                  display: "block",
                  width: "min(26px, 80%)",
                  height: `${Math.max(bar.value ? 4 : 1, (bar.value / top) * 100 * 0.8)}%`,
                  borderRadius: "4px 4px 0 0",
                  background: bar.isFuture ? neutral.loam : brand.base,
                  opacity: bar.isFuture || bar.isToday ? 1 : 0.8,
                }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "10px", borderTop: `1px solid ${neutral.ink}`, paddingTop: "6px", fontSize: "11.5px", color: neutral.bark, textAlign: "center" }}>
          {bars.map((bar) => (
            <span key={bar.key} style={bar.isToday ? { color: neutral.ink, fontWeight: 600 } : undefined}>
              {bar.label}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recently completed
// ---------------------------------------------------------------------------

const SIGNATURE_TONES = { Signed: "success", "No signature": "warning", "Report due": "danger" };

export function RecentList({ rows }) {
  return (
    <Card title="Recently completed" padded={false}>
      {rows.length === 0 ? (
        <p style={{ margin: 0, padding: "16px 18px", color: neutral.bark }}>No visits have finished in the last few days.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((row, index) => (
            <li key={row.id} style={rowStyle(index === rows.length - 1)}>
              <span style={{ width: "64px", flex: "none", fontSize: "12.5px", color: neutral.bark, fontVariantNumeric: "tabular-nums" }}>{row.when}</span>
              <Link to={row.to} style={{ minWidth: 0, flex: 1, color: "inherit", textDecoration: "none" }}>
                <span style={{ display: "block", fontWeight: weight.medium, color: neutral.ink }}>{row.title}</span>
                <span style={{ display: "block", fontSize: "12.5px", color: neutral.bark }}>{row.detail}</span>
              </Link>
              <StatusPill tone={SIGNATURE_TONES[row.state] || "neutral"}>{row.state}</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

