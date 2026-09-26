// A small stamp for a status or a role: always a dot plus a word.
//
// Colour alone never carries a status here — someone who can't tell the
// greens from the ambers still reads "Completed". Green, amber and red are
// reserved for status; maroon ("brand") marks a confirmed booking and the
// brand, nothing else.
//
// The pill radius is deliberate and the one place it is allowed — a stamp is
// not a button, and the design language reserves 3.75px for controls.

import { brand, neutral, radius, status as semantic, surface, weight } from "../../styles/tokens";

export const TONES = {
  neutral: { background: surface.sunken, color: neutral.saddle },
  success: { background: semantic.successSurface, color: semantic.success },
  warning: { background: semantic.warningSurface, color: semantic.warning },
  danger: { background: semantic.dangerSurface, color: semantic.danger },
  brand: { background: "rgba(127, 17, 17, 0.07)", color: brand.base },
};

const STATUS_TONES = {
  // Appointments.
  Pending: "warning",
  Confirmed: "brand",
  "In progress": "brand",
  Reschedule: "warning",
  Completed: "success",
  Cancelled: "neutral",
  Scheduled: "neutral",
  // Accounts and records.
  ACTIVE: "success",
  INACTIVE: "neutral",
  PENDING: "warning",
  ARCHIVED: "neutral",
  // Roles.
  ADMIN: "brand",
  STAFF: "neutral",
  TECHNICIAN: "success",
  // Stock.
  Healthy: "success",
  "Low Stock": "danger",
  "Low stock": "danger",
  "Out of stock": "danger",
  Disabled: "neutral",
  // Reports.
  Signed: "success",
  "No signature": "warning",
  "Report due": "danger",
  // Billing (Sprint 3).
  Draft: "neutral",
  Sent: "brand",
  Approved: "success",
  Rejected: "danger",
  Expired: "neutral",
  Received: "success",
  "Pending check": "warning",
  Bounced: "danger",
  Reversed: "neutral",
  "Down payment due": "warning",
  "Down payment paid": "success",
};

/** The tone for a status or role string, falling back to neutral. */
export function toneFor(value) {
  return STATUS_TONES[value] || "neutral";
}

function StatusPill({ children, tone, status, icon = null, dot = true, style, ...rest }) {
  const palette = TONES[tone || toneFor(status || children)] || TONES.neutral;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        borderRadius: radius.pill,
        padding: "1px 9px 1px 8px",
        fontSize: "12px",
        lineHeight: "19px",
        fontWeight: weight.medium,
        whiteSpace: "nowrap",
        ...palette,
        ...style,
      }}
      {...rest}
    >
      {icon ||
        (dot && (
          <span
            aria-hidden="true"
            data-status-dot=""
            style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", flexShrink: 0 }}
          />
        ))}
      {status || children}
    </span>
  );
}

export default StatusPill;
