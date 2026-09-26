// How an appointment looks on the calendar: STATUS IS THE ONLY COLOUR.
//
// Cards used to be filled with a per-technician colour assigned by list
// position, with status squeezed into the rail, a hatch and a glyph. That
// was four encodings and no legend, Pending and Reschedule shared a colour,
// and adding or deactivating an account repainted everyone. Technicians are
// now told apart by initials (see ui/Avatar), and a card is a white surface
// whose 3px left edge — plus fill, border style and strike — says its status:
//
//   Confirmed   maroon edge, white
//   In progress maroon edge, maroon wash           (on site now)
//   Pending     amber edge, white, dashed border   (not yet agreed)
//   Reschedule  amber edge, amber wash             (needs a new slot)
//   Completed   green edge, green wash
//   Cancelled   loam edge, no fill, struck through
//
// The same five are drawn by CalendarLegend, which is always on screen.

import { brand, neutral, status as semantic, surface } from "../../styles/tokens";

const VISUALS = {
  Confirmed: { label: "Confirmed", edge: brand.base, fill: surface.panel, borderStyle: "solid", strike: false, muted: false },
  Pending: { label: "Pending", edge: semantic.warning, fill: surface.panel, borderStyle: "dashed", strike: false, muted: false },
  // Booked by the office, not yet confirmed by the client: between Pending's
  // dashed amber and Confirmed's maroon.
  Scheduled: { label: "Scheduled", edge: neutral.saddle, fill: surface.panel, borderStyle: "solid", strike: false, muted: false },
  // Migration 048: a technician has started the visit on site.
  "In progress": { label: "In progress", edge: brand.base, fill: "rgba(127, 17, 17, 0.07)", borderStyle: "solid", strike: false, muted: false },
  Reschedule: { label: "Reschedule", edge: semantic.warning, fill: semantic.warningSurface, borderStyle: "solid", strike: false, muted: false },
  Completed: { label: "Completed", edge: semantic.success, fill: semantic.successSurface, borderStyle: "solid", strike: false, muted: false },
  Cancelled: { label: "Cancelled", edge: neutral.loam, fill: "transparent", borderStyle: "solid", strike: true, muted: true },
};

/** The statuses the legend explains, in the order it lists them. */
export const LEGEND_STATUSES = ["Confirmed", "In progress", "Scheduled", "Pending", "Reschedule", "Completed", "Cancelled"];

/**
 * The visual treatment for one status: `{ edge, fill, borderStyle, strike,
 * muted }`. An unknown status draws as Confirmed.
 */
export function statusVisual(status) {
  return VISUALS[status] || VISUALS.Confirmed;
}

/** Background and text for a status pill, in the warm palette. */
export const STATUS_COLORS = {
  Pending: [semantic.warningSurface, semantic.warning],
  Scheduled: [semantic.infoSurface, semantic.info],
  Confirmed: ["rgba(127, 17, 17, 0.07)", brand.base],
  Reschedule: [semantic.warningSurface, semantic.warning],
  "In progress": ["rgba(127, 17, 17, 0.07)", brand.base],
  Completed: [semantic.successSurface, semantic.success],
  Cancelled: [surface.sunken, neutral.saddle],
};

export function badgeStyle(status) {
  const [background, color] = STATUS_COLORS[status] || STATUS_COLORS.Pending;
  return {
    background,
    color,
    borderRadius: 999,
    padding: "1px 9px",
    fontSize: "12px",
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
}

/** The status edge colour, for list rows and day panels outside the grid. */
export function statusAccent(status) {
  return statusVisual(status).edge;
}

/**
 * How much of an appointment a card can show.
 *
 * Height alone is not enough: a card in a three-deep cluster is a third of a
 * column wide, so a long client name wraps to two or three lines and pushes
 * everything below it out of the box. The same 70px card that comfortably
 * holds time, a two-line name and a technician at full width is overfull at
 * half width. So width, expressed as the number of side-by-side columns,
 * caps the tier that height would otherwise allow.
 *
 * The old flags (`roomy`, `tight`, `compact`) were read directly in the
 * render and each tier redefined its own font sizes inline. Naming the tiers
 * means the card has one switch instead of four conditionals.
 */
export function contentTier(height, columns = 1) {
  // A third of a column fits one line of anything, whatever the height.
  if (columns >= 3) return "compact";

  // 68 rather than a rounder number on purpose: a one-hour visit is the most
  // common booking, and in a nine-hour window it renders at 70px (a 72px row
  // less the 2px gap). A 76px threshold pushed exactly that case down a tier,
  // so the most common card lost its technician line for six pixels.
  const byHeight = height >= 68 ? "full" : height >= 48 ? "medium" : "compact";

  // Half width has room for a name and a time, not for a wrapped name plus a
  // technician line.
  if (columns === 2 && byHeight === "full") return "medium";

  return byHeight;
}
