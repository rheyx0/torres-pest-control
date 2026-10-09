// Shared inline-style objects.
//
// The app styles everything with inline `style={{...}}` props. These objects
// were copy-pasted into nearly every page (inputStyle alone appeared five
// times, with three slightly different paddings). Centralising them keeps the
// look consistent and gives a single place to change when/if the app moves to
// real CSS classes in globals.css.
//
// Every value here is derived from styles/tokens.js — this module composes,
// it does not invent. A restyle should be a tokens.js edit; if it isn't, a
// hardcoded value has leaked in here.
//
// The export names and shapes are load-bearing: forty modules spread these
// objects onto elements. Values change freely, signatures do not.

import {
  accent,
  border,
  brand,
  focusRing,
  font,
  layout,
  line,
  neutral,
  radius,
  shadow,
  space,
  status,
  surface,
  text,
  weight,
} from "./tokens";

export { focusRing };

export const colors = {
  // Brand — fixed, and the system's only chromatic accent.
  brand: brand.base,
  brandLight: brand.light,
  brandInk: brand.ink,
  brandWash: brand.wash,

  // Text, strongest to faintest.
  ink: neutral.ink,
  body: neutral.saddle,
  muted: neutral.bark,

  // Surfaces.
  canvas: surface.canvas,
  panel: surface.panel,
  sunken: surface.sunken,
  inverted: surface.inverted,

  // Strokes. `line` is the workhorse hairline; `softLine` separates rows
  // inside an already-bordered container without drawing a second edge.
  line,
  softLine: "rgba(199, 188, 175, 0.45)",
  strongLine: neutral.ink,
  loam: neutral.loam,

  // Semantic.
  success: status.success,
  danger: status.danger,
  warning: status.warning,

  // Non-brand accents, for highlights only — never a primary action.
  accentSoft: accent.soft,
  sage: accent.sage,
};

export const pageShell = {
  maxWidth: layout.pageMaxWidth,
  margin: "0 auto",
};

/**
 * The standard content surface: white lifted off the parchment canvas by a
 * hairline border and nothing else. No gradient, no coloured top rule, no
 * shadow — separation comes from surface temperature, which is the whole
 * premise of this design language.
 */
export const card = {
  background: surface.panel,
  border: border.hairline,
  borderRadius: radius.card,
  padding: "22px",
  boxShadow: shadow.none,
};

/** A quieter surface for wells and grouped filters, one step warmer. */
export const sunkenPanel = {
  background: surface.sunken,
  border: `1px solid ${neutral.loam}`,
  borderRadius: radius.card,
  padding: space.md,
};

export const inputStyle = {
  width: "100%",
  // Lets a field shrink in a grid or flex row instead of widening it to
  // its longest option (a sideways scrollbar in the window).
  minWidth: 0,
  border: `1px solid ${neutral.loam}`,
  borderRadius: radius.control,
  padding: "8px 11px",
  fontSize: text.body.fontSize,
  fontFamily: font.sans,
  background: surface.panel,
  color: neutral.ink,
  boxShadow: shadow.none,
};

export const invalidInputStyle = {
  ...inputStyle,
  borderColor: status.danger,
  background: status.dangerSurface,
};

/**
 * The single filled action. Ambrook's button is flat: a solid fill, ink-dark
 * or parchment text, 3.75px corners, no shadow and no gradient.
 */
export const primaryButton = {
  border: `1px solid ${brand.base}`,
  borderRadius: radius.control,
  background: brand.base,
  color: surface.canvas,
  padding: "7px 16px",
  fontSize: text.body.fontSize,
  fontWeight: weight.medium,
  cursor: "pointer",
  boxShadow: shadow.none,
};

/** The quiet counterpoint: a thin outlined rectangle, no fill. */
export const secondaryButton = {
  border: `1px solid ${neutral.ink}`,
  background: "transparent",
  color: neutral.ink,
  borderRadius: radius.control,
  padding: "7px 14px",
  fontSize: text.body.fontSize,
  fontWeight: weight.medium,
  cursor: "pointer",
  boxShadow: shadow.none,
};

/**
 * The third rung: a loam-edged white button for everyday row actions
 * ("Assign", "Review", "Open") so a list of them doesn't shout.
 */
export const quietButton = {
  ...secondaryButton,
  border: `1px solid ${neutral.loam}`,
  background: surface.panel,
};

/**
 * Genuinely destructive actions — deleting a record, deactivating an account.
 *
 * `dangerButton` has never been red: it was slate grey, and every call site
 * that wanted real danger overrode it inline. Both names are exported so the
 * existing call sites keep working, but new code should say what it means.
 */
export const destructiveButton = {
  ...secondaryButton,
  border: `1px solid ${status.danger}`,
  background: status.dangerSurface,
  color: status.danger,
};

/** @deprecated Use `destructiveButton` for destructive actions. */
export const dangerButton = destructiveButton;

export const successButton = {
  ...secondaryButton,
  border: `1px solid ${status.success}`,
  background: status.successSurface,
  color: status.success,
};

/** A stamp, not a button — the one place the pill radius is allowed. */
export const badge = {
  background: surface.sunken,
  color: neutral.ink,
  borderRadius: radius.pill,
  padding: "2px 10px",
  fontWeight: weight.medium,
  fontSize: text.caption.fontSize,
  letterSpacing: text.caption.letterSpacing,
};

/**
 * The uppercase tag above a page or section heading. Wide tracking gives it
 * the cadence of a newspaper dateline — a rhythm device this design language
 * leans on heavily.
 */
export const eyebrow = {
  ...text.eyebrow,
  margin: 0,
  color: neutral.saddle,
  fontFamily: font.sans,
};

/** Headings use the display face at weight 500. Never 700 — that is the point. */
export const heading = {
  ...text.heading,
  margin: 0,
  fontFamily: font.display,
  fontWeight: weight.medium,
  color: neutral.ink,
};

/**
 * Serif card / section title. The display face turns muddy below 17px, so
 * smaller titles should use the sans at weight 500 instead.
 */
export const serifTitle = {
  margin: 0,
  fontFamily: font.display,
  fontWeight: weight.medium,
  fontSize: text.bodyLg.fontSize,
  lineHeight: 1.3,
  color: neutral.ink,
};

export const subheading = {
  ...text.subheading,
  margin: 0,
  fontFamily: font.display,
  fontWeight: weight.medium,
  color: neutral.ink,
};

/** The page canvas. Flat parchment — the previous red radial gradient is gone. */
export const appBackground = surface.canvas;

export const fieldGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: space.md,
};

export function buttonWhen(disabled, base = primaryButton) {
  return { ...base, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
}
