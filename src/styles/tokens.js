// Design tokens — the single source of truth for every visual value.
//
// Adapted from the Ambrook style reference ("harvest ledger on butcher
// paper"): a warm parchment canvas, ink-dark type, hairline borders, small
// radii, and — critically — no drop shadows. Ambrook builds hierarchy from
// surface temperature (parchment -> bone -> white -> charcoal) and 1px
// borders, not from elevation. Reaching for a box-shadow here is a sign the
// surface stack is being used wrong.
//
// ONE DELIBERATE DEPARTURE FROM THE REFERENCE
// -------------------------------------------
// Ambrook's rules say honey amber (#e8b672) is the only chromatic accent and
// that red must never be introduced. Torres Pest Control's brand is maroon,
// and the brand does not change — so maroon takes the accent role wherever
// the reference says amber. This works because maroon is warm: it sits on
// parchment the way amber does, which it never did on the cool slate-blue
// surfaces this app used before. Amber is kept as `accentSoft` for low-
// emphasis highlights only, never for a primary action.
//
// Consumers should import from styles/theme.js, not from here. This module
// holds raw values; theme.js composes them into the style objects the app
// actually spreads onto elements.

/**
 * The brand palette. These three values are fixed — they are the company's
 * identity, not a design choice, and no restyle may change them.
 */
export const brand = {
  base: "#7f1111",
  light: "#bf3e3e",
  ink: "#8b1e1e",
  /** Maroon at low alpha, for tinted fills and rings over parchment. */
  wash: "rgba(127, 17, 17, 0.08)",
  ring: "rgba(127, 17, 17, 0.22)",
  /** Pressed / hovered primary fill. */
  hover: "#661010",
};

/**
 * Surfaces, warmest to darkest. Hierarchy comes from stepping through these,
 * never from shadow. Level 0 is the page; 1 lifts a card off it; 2 marks a
 * section boundary or a sunken well; 3 inverts for a focused work surface.
 */
export const surface = {
  canvas: "#fcfaf1", // parchment — the page background signature
  panel: "#ffffff", // pure white — lifts a card above the canvas
  sunken: "#efe9e0", // bone — wells, table headers, section bands
  inverted: "#252a23", // charcoal olive — inverted product panels
  /**
   * The navigation rail. Plain bone: the earlier maroon-warmed "#e8dcd7" read
   * as dusty pink next to the parchment page. The active item lifts to white
   * with a maroon marker, so the rail itself needs no brand tint.
   */
  rail: "#efe9e0",
};

/** Warm neutrals for text and strokes, lightest to darkest. */
export const neutral = {
  loam: "#c7bcaf", // low-emphasis dividers and card edges
  bark: "#8a7d70", // muted helper text, metadata, placeholders
  saddle: "#50463c", // secondary body text, subdued icon fills
  ink: "#211b15", // primary text and strong borders — warm near-black
  olive: "#434f40", // organic dark divider, icon strokes
};

/** Non-brand accents. `soft` is Ambrook's honey amber, demoted to highlights. */
export const accent = {
  soft: "#e8b672", // honey amber — highlights only, never a primary action
  /**
   * The same honey amber, named for its one sanctioned use as a fill: a
   * call to action sitting on the dark olive surface, where maroon vanishes.
   */
  amber: "#e8b672",
  wheat: "#f0c891", // lighter amber for decorative strokes
  sage: "#7a9779", // green, for outlined emphasis — never a primary CTA
};

/** Semantic colors. Kept desaturated so they sit inside the warm palette. */
export const status = {
  success: "#4a6b4a",
  successSurface: "#eef2ec",
  warning: "#9a6420",
  warningSurface: "#faf0e2",
  danger: "#9a2d24",
  dangerSurface: "#f9ecea",
  info: "#50463c",
  infoSurface: "#efe9e0",
};

/**
 * Borders. Ambrook uses exactly two weights: a bone hairline for quiet
 * separation and an ink line for anything that must read as an edge.
 */
/** The hairline colour: a shade warmer and darker than bone, so a white card reads on parchment. */
export const line = "#e6dfd3";

export const border = {
  hairline: `1px solid ${line}`,
  soft: `1px solid ${neutral.loam}`,
  strong: `1px solid ${neutral.ink}`,
};

/** 4px base unit. */
export const space = {
  xs: "4px",
  sm: "8px",
  md: "15px",
  lg: "30px",
  xl: "45px",
  xxl: "60px",
};

/**
 * Radii. The reference is emphatic that this system is defined by subtle
 * rounding: 3.75px on controls, 7.5px on cards. Pills are reserved for
 * status badges, which read as stamps rather than buttons.
 */
export const radius = {
  control: "3.75px",
  card: "7.5px",
  panel: "11.25px",
  pill: "9999px",
};

/**
 * Type. Inter substitutes for Lateral, Source Serif for Lateral Display.
 * Both are loaded in globals.css.
 *
 * The scale is Ambrook's, truncated at the top: this is a dense internal
 * tool, so the 38-68px display sizes would spend a third of a screen on a
 * page title. `pageTitle` caps at the reference's heading-sm.
 */
export const font = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  display: "'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, Menlo, Consolas, monospace",
};

/** Weight 500, not 700, is the reference's signature restraint. */
export const weight = {
  regular: 400,
  medium: 500,
  bold: 700,
};

export const text = {
  caption: { fontSize: "11px", lineHeight: 1.5, letterSpacing: "0.107px" },
  eyebrow: {
    fontSize: "13px",
    lineHeight: 1.6,
    letterSpacing: "0.058em",
    textTransform: "uppercase",
    fontWeight: weight.regular,
  },
  small: { fontSize: "13px", lineHeight: 1.5, letterSpacing: "0px" },
  body: { fontSize: "14px", lineHeight: 1.55, letterSpacing: "0px" },
  bodyLg: { fontSize: "17px", lineHeight: 1.6, letterSpacing: "0px" },
  subheading: { fontSize: "19px", lineHeight: 1.43, letterSpacing: "-0.21px" },
  heading: { fontSize: "30px", lineHeight: 1.33, letterSpacing: "-0.33px" },
  /** Only for a genuinely editorial moment — the login hero, not a page title. */
  display: { fontSize: "38px", lineHeight: 1.14, letterSpacing: "-0.42px" },
};

/**
 * Elevation is a lie in this system — it exists so call sites have something
 * to reference instead of inventing a box-shadow. `none` is the default and
 * the right answer almost everywhere; `overlay` is the single exception,
 * because a modal floating over the page genuinely needs to read as detached.
 */
export const shadow = {
  none: "none",
  overlay: "0 24px 48px rgba(33, 27, 21, 0.18)",
};

/** A visible keyboard focus ring. The app previously had none at all. */
export const focusRing = `0 0 0 3px ${brand.ring}`;

export const layout = {
  // No cap: every page uses the full width beside the sidebar. (It was 1280px,
  // which left an empty band on a wide screen.) Focused forms set their own.
  pageMaxWidth: "none",
  sidebarWidth: "232px",
  /** Below this width the rail becomes a drawer. Mirrored in globals.css. */
  drawerBreakpoint: 860,
};
