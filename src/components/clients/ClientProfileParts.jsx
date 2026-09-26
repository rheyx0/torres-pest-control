// Pieces of the client profile page: header, facts column, the "…" menu,
// the Next visit banner and the timeline. Data comes from
// utils/clientTimeline.js; these only draw it.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bug,
  CalendarDays,
  ChevronRight,
  Clock,
  MoreHorizontal,
  Navigation,
  PencilLine,
  Phone,
  Repeat,
  Tag,
} from "lucide-react";
import { brand, font, neutral, radius, status as semantic, surface, weight } from "../../styles/tokens";
import { colors, quietButton } from "../../styles/theme";
import Button from "../ui/Button";
import StatusPill from "../ui/StatusPill";
import { DOCUMENT_CATEGORIES } from "../../utils/constants";
import { formatPeso, humanizeEnum } from "../../utils/formatters";
import { crewOf } from "../../utils/scheduling";
import { directionsUrl, telUrl } from "../../utils/clientTimeline";
import { signatureState } from "../../utils/dashboardMetrics";

export const peso = (value) => formatPeso(value, { minDecimals: 0 });
const shortDate = (value) => new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
const clock = (value) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const iconText = { display: "inline-flex", alignItems: "center", gap: "6px" };

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button variant="quiet" size="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={16} />
      </Button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 30,
            minWidth: "200px",
            background: surface.panel,
            border: `1px solid ${neutral.loam}`,
            borderRadius: radius.card,
            padding: "4px",
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="ui-interactive"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: 0,
                background: "transparent",
                borderRadius: radius.control,
                padding: "8px 10px",
                fontSize: "13px",
                color: item.danger ? semantic.danger : neutral.ink,
                borderTop: item.separated ? `1px solid ${colors.line}` : undefined,
                marginTop: item.separated ? "4px" : 0,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClientHeader({ client, plan, clientSince, canEdit, canBook, menuItems, onEdit }) {
  const classification =
    client.classification === "OTHER" && client.classificationOther ? client.classificationOther : humanizeEnum(client.classification);
  const archived = client.status === "ARCHIVED";
  const tel = telUrl(client.phone);

  return (
    <header style={{ marginBottom: "20px" }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: neutral.bark }}>
        <Link to="/clients" style={{ color: neutral.bark, textDecoration: "none" }}>
          Clients
        </Link>
        <ChevronRight size={13} aria-hidden="true" />
        <span aria-current="page" style={{ color: neutral.saddle, fontWeight: weight.medium }}>
          {client.reference || client.name}
        </span>
      </nav>

      <div style={{ display: "flex", gap: "18px", alignItems: "flex-start", flexWrap: "wrap", marginTop: "6px" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h1 style={{ margin: "0 0 8px", font: `500 30px/1.15 ${font.display}`, letterSpacing: "-0.3px", color: neutral.ink }}>{client.name}</h1>
          <div style={{ display: "flex", gap: "8px 16px", flexWrap: "wrap", alignItems: "center", color: neutral.saddle, fontSize: "13px" }}>
            <StatusPill tone={archived ? "neutral" : "success"}>{archived ? "Archived" : "Active"}</StatusPill>
            {client.classification && (
              <span style={iconText}>
                <Tag size={14} aria-hidden="true" />
                {classification}
              </span>
            )}
            {client.pestConcern && (
              <span style={iconText}>
                <Bug size={14} aria-hidden="true" />
                {client.pestConcern}
              </span>
            )}
            {plan && (
              <span style={iconText}>
                <Repeat size={14} aria-hidden="true" />
                {plan} plan
              </span>
            )}
            {clientSince && (
              <span style={iconText}>
                <Clock size={14} aria-hidden="true" />
                Client since {clientSince}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {tel && (
            <a href={tel} className="ui-interactive" style={{ ...quietButton, ...iconText, minHeight: "34px", padding: "0 14px", textDecoration: "none", fontSize: "13.5px" }}>
              <Phone size={15} aria-hidden="true" /> Call
            </a>
          )}
          {canEdit && (
            <Button variant="quiet" icon={<PencilLine size={15} />} onClick={onEdit}>
              Edit
            </Button>
          )}
          {canBook && !archived && (
            <Link
              to={`/scheduling?new=1&client=${encodeURIComponent(client.id)}`}
              className="ui-interactive"
              style={{
                ...iconText,
                minHeight: "34px",
                padding: "0 14px",
                borderRadius: radius.control,
                background: brand.base,
                border: `1px solid ${brand.base}`,
                color: surface.canvas,
                textDecoration: "none",
                fontSize: "13.5px",
                fontWeight: weight.medium,
              }}
            >
              <CalendarDays size={15} aria-hidden="true" /> Book visit
            </Link>
          )}
          <MoreMenu items={menuItems} />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Facts column
// ---------------------------------------------------------------------------

function Fact({ label, children }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${colors.line}` }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: neutral.bark }}>{label}</div>
      <div style={{ marginTop: "2px", color: neutral.ink }}>{children}</div>
    </div>
  );
}

const linkStyle = { ...iconText, color: brand.base, fontWeight: weight.medium, fontSize: "12.5px", textDecoration: "none" };

export function ClientFacts({ client, value, canEdit, onEdit }) {
  const missing = (label) => (
    <span style={{ color: neutral.bark }}>
      Not provided
      {canEdit && (
        <>
          {" · "}
          <button type="button" onClick={onEdit} style={{ ...linkStyle, border: 0, background: "none", padding: 0, cursor: "pointer" }} aria-label={`Add ${label}`}>
            Add
          </button>
        </>
      )}
    </span>
  );

  return (
    <aside style={{ background: surface.panel, border: `1px solid ${colors.line}`, borderRadius: radius.card, minWidth: 0 }}>
      {client.serviceNotes && (
        <div
          role="note"
          aria-label="Site notes"
          style={{
            display: "flex",
            gap: "8px",
            margin: "14px 18px 4px",
            padding: "10px 12px",
            background: semantic.warningSurface,
            border: "1px solid #efdcbf",
            borderRadius: "4px",
            color: "#5b4122",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
          <div>
            <b style={{ fontWeight: weight.medium }}>Site notes</b>
            <div style={{ whiteSpace: "pre-wrap" }}>{client.serviceNotes}</div>
          </div>
        </div>
      )}
      <div style={{ padding: "6px 18px 8px" }}>
        <Fact label="Phone">
          {client.phone ? (
            <a href={telUrl(client.phone)} style={{ color: neutral.ink, textDecoration: "none", fontVariantNumeric: "tabular-nums" }}>
              {client.phone}
            </a>
          ) : (
            missing("phone")
          )}
        </Fact>
        <Fact label="Email">{client.email ? <a href={`mailto:${client.email}`} style={{ color: neutral.ink }}>{client.email}</a> : missing("email")}</Fact>
        <Fact label="Service address">
          {client.address ? (
            <>
              <div>{client.address}</div>
              <a href={directionsUrl(client.address)} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, marginTop: "4px" }}>
                <Navigation size={13} aria-hidden="true" /> Directions
              </a>
            </>
          ) : (
            missing("address")
          )}
        </Fact>
        <Fact label="Lifetime value">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {peso(value.total)} · {value.visits} {value.visits === 1 ? "visit" : "visits"}
          </span>
        </Fact>
        <Fact label="Source">{client.source || "—"}</Fact>
        <div style={{ padding: "10px 0 4px", fontSize: "12px", color: neutral.bark }}>
          {client.reference ? `${client.reference} · ` : ""}Updated {shortDate(client.updatedAt || client.createdAt)}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Next visit + timeline
// ---------------------------------------------------------------------------

export function NextVisitBanner({ appointment, crewNames }) {
  if (!appointment) return null;
  const when = new Date(appointment.scheduledAt);
  return (
    <Link
      to={`/scheduling?appointment=${encodeURIComponent(appointment.id)}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        margin: "14px 18px 6px",
        padding: "12px 14px",
        border: `1px solid ${brand.base}`,
        borderLeftWidth: "3px",
        borderRadius: "5px",
        background: "rgba(127, 17, 17, 0.07)",
        color: neutral.ink,
        textDecoration: "none",
      }}
    >
      <CalendarDays size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <b style={{ fontWeight: weight.medium }}>
          Next visit · {when.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, {clock(when)}
        </b>
        <span style={{ display: "block", fontSize: "12.5px", color: neutral.saddle }}>
          {[appointment.serviceFrequency && `${appointment.serviceFrequency} service`, appointment.serviceType, crewNames.join(", ") || "Unassigned"]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <StatusPill status={appointment.status} />
    </Link>
  );
}

const DOT = {
  report: { border: semantic.success, background: semantic.success },
  missed: { border: semantic.danger, background: surface.panel },
  cancelled: { border: neutral.loam, background: surface.panel },
  document: { border: neutral.loam, background: surface.panel },
  created: { border: neutral.loam, background: surface.panel },
};

const categoryLabel = (value) => DOCUMENT_CATEGORIES.find((entry) => entry.value === value)?.label || humanizeEnum(value);

function EventBody({ event, nameOf, onOpenReport }) {
  const appointment = event.appointment;
  const crew = appointment ? crewOf(appointment).map(nameOf).filter(Boolean) : [];

  if (event.kind === "report") {
    const state = signatureState(appointment);
    const photos = (appointment.attachments || []).length;
    const materials = (appointment.stockUsed || []).map((entry) => `${entry.name} ${entry.amount} ${entry.unit}`.trim());
    return (
      <>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => onOpenReport(appointment)} style={{ border: 0, background: "none", padding: 0, font: "inherit", fontWeight: weight.medium, color: neutral.ink, cursor: "pointer", textAlign: "left" }}>
            Service report filed
          </button>
          <StatusPill tone={state === "Signed" ? "success" : "warning"}>{state}</StatusPill>
        </div>
        {(appointment.report || appointment.recommendations) && (
          <div style={{ color: neutral.saddle, fontSize: "13px", marginTop: "3px" }}>
            {appointment.report}
            {appointment.recommendations && (
              <>
                {" "}
                <b style={{ fontWeight: weight.medium, color: neutral.ink }}>Recommend:</b> {appointment.recommendations}
              </>
            )}
          </div>
        )}
        <div style={{ fontSize: "12.5px", color: neutral.bark, marginTop: "6px" }}>
          {[
            crew.join(", ") || null,
            appointment.serviceType || appointment.pestConcern || null,
            materials.length ? materials.join(", ") : null,
            photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : null,
            appointment.price !== "" && appointment.price !== null && appointment.price !== undefined ? peso(appointment.price) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </>
    );
  }

  if (event.kind === "missed") {
    return (
      <>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <Link to={`/scheduling?appointment=${encodeURIComponent(appointment.id)}&tab=Report`} style={{ fontWeight: weight.medium, color: neutral.ink, textDecoration: "none" }}>
            Visit — no report yet
          </Link>
          <StatusPill tone="danger">Report due</StatusPill>
        </div>
        <div style={{ fontSize: "12.5px", color: neutral.bark, marginTop: "3px" }}>
          {[crew.join(", ") || "Unassigned", appointment.serviceType || appointment.pestConcern].filter(Boolean).join(" · ")}
        </div>
      </>
    );
  }

  if (event.kind === "cancelled") {
    return (
      <>
        <div style={{ fontWeight: weight.medium, color: neutral.bark, textDecoration: "line-through" }}>Visit cancelled</div>
        <div style={{ fontSize: "12.5px", color: neutral.bark, marginTop: "3px" }}>
          {[appointment.cancellationReason, appointment.serviceType || appointment.pestConcern].filter(Boolean).join(" · ") || "No reason recorded"}
        </div>
      </>
    );
  }

  if (event.kind === "document") {
    return (
      <>
        <div style={{ fontWeight: weight.medium, color: neutral.ink }}>Document added</div>
        <div style={{ fontSize: "13px", color: neutral.saddle, marginTop: "3px" }}>
          {event.document.name} · {categoryLabel(event.document.category)}
        </div>
      </>
    );
  }

  return <div style={{ fontWeight: weight.medium, color: neutral.ink }}>Client created</div>;
}

export function ClientTimeline({ events, nameOf, onOpenReport }) {
  if (events.length === 0) return <p style={{ margin: 0, padding: "16px 18px", color: neutral.bark }}>Nothing has happened yet.</p>;
  return (
    <ol aria-label="Timeline" style={{ listStyle: "none", margin: 0, padding: "6px 18px 10px" }}>
      {events.map((event, index) => {
        const dot = DOT[event.kind] || DOT.created;
        return (
          <li key={event.key} style={{ display: "grid", gridTemplateColumns: "72px 18px minmax(0, 1fr)", gap: "0 12px", padding: "12px 0", position: "relative" }}>
            <div style={{ fontSize: "12.5px", color: neutral.saddle, textAlign: "right", paddingTop: "1px" }}>
              {shortDate(event.at)}
              <small style={{ display: "block", color: neutral.bark, fontSize: "11.5px" }}>{clock(event.at)}</small>
            </div>
            <div aria-hidden="true" style={{ position: "relative" }}>
              <span style={{ display: "block", width: "11px", height: "11px", borderRadius: "50%", border: `2px solid ${dot.border}`, background: dot.background, margin: "4px auto 0", position: "relative", zIndex: 1 }} />
              {index < events.length - 1 && <span style={{ position: "absolute", left: "50%", top: "16px", bottom: "-24px", borderLeft: `1px solid ${colors.line}` }} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <EventBody event={event} nameOf={nameOf} onOpenReport={onOpenReport} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" aria-label="Client history" style={{ display: "flex", gap: "22px", borderBottom: `1px solid ${colors.line}`, padding: "0 18px", overflowX: "auto" }}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            style={{
              border: 0,
              background: "none",
              padding: "12px 0 10px",
              fontSize: "13.5px",
              color: selected ? neutral.ink : neutral.saddle,
              fontWeight: selected ? weight.medium : weight.regular,
              borderBottom: `2px solid ${selected ? brand.base : "transparent"}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
            {tab.count !== undefined && <span style={{ color: neutral.bark, fontSize: "12px", marginLeft: "5px" }}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export { shortDate, clock };
