// Unit conversion for Stock In.
//
// Supplies arrive in the unit the supplier sells them in — gallons, pounds,
// fluid ounces — and are tracked in whatever unit the item was created with,
// usually litres or kilograms. Staff were converting in their heads before
// typing, which is where a decimal point goes missing.
//
// Everything here is pure arithmetic over a table of factors, so it is testable
// on its own and the Stock In form only has to ask "what unit is on the
// delivery note?". The converted figure is what moves the stock level; both
// figures are stored on the movement (migration 040).

/**
 * Each unit expressed in its dimension's base unit — millilitres for volume,
 * grams for mass. Count units (pcs, boxes, …) are deliberately absent: two
 * boxes are not two of anything in particular, so there is nothing to convert
 * them to and offering it would invent a number.
 */
export const UNIT_DIMENSIONS = {
  VOLUME: {
    base: "mL",
    units: {
      mL: 1,
      L: 1000,
      "fl oz": 29.5735295625,
      qt: 946.352946,
      gal: 3785.411784,
    },
  },
  MASS: {
    base: "g",
    units: {
      g: 1,
      kg: 1000,
      oz: 28.349523125,
      lb: 453.59237,
    },
  },
};

/** Long names for the select, so "gal" is unambiguous at the point of entry. */
export const UNIT_LABELS = {
  mL: "Millilitres (mL)",
  L: "Litres (L)",
  "fl oz": "Fluid ounces (fl oz)",
  qt: "Quarts (qt)",
  gal: "Gallons (gal)",
  g: "Grams (g)",
  kg: "Kilograms (kg)",
  oz: "Ounces (oz)",
  lb: "Pounds (lb)",
};

/**
 * Unit strings are typed by hand on the item form ("Litres", "l", " L "), so
 * matching has to be forgiving or conversion silently stops being offered.
 */
const ALIASES = {
  l: "L",
  lt: "L",
  ltr: "L",
  liter: "L",
  litre: "L",
  liters: "L",
  litres: "L",
  ml: "mL",
  milliliter: "mL",
  millilitre: "mL",
  milliliters: "mL",
  millilitres: "mL",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gram: "g",
  grams: "g",
  gal: "gal",
  gallon: "gal",
  gallons: "gal",
  qt: "qt",
  quart: "qt",
  quarts: "qt",
  "fl oz": "fl oz",
  floz: "fl oz",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
};

/** The canonical spelling of a unit, or "" when it isn't one we can convert. */
export function normalizeUnit(unit) {
  const key = String(unit ?? "").trim().toLowerCase();
  if (!key) return "";
  return ALIASES[key] || "";
}

/** The dimension a unit belongs to, or null for count units and unknowns. */
export function dimensionOf(unit) {
  const canonical = normalizeUnit(unit);
  if (!canonical) return null;
  return Object.values(UNIT_DIMENSIONS).find((dimension) => canonical in dimension.units) || null;
}

/**
 * Units a quantity may be entered in for an item tracked in `unit` — the item's
 * own unit first, then the rest of its dimension. Empty when the item's unit is
 * a count, which is the signal to hide the unit picker entirely.
 */
export function convertibleUnits(unit) {
  const dimension = dimensionOf(unit);
  if (!dimension) return [];
  const canonical = normalizeUnit(unit);
  return [canonical, ...Object.keys(dimension.units).filter((entry) => entry !== canonical)];
}

/**
 * How many `toUnit` one `fromUnit` makes, or null when the two can't be
 * compared. Returning null rather than 1 matters: a silent fallback of 1 would
 * turn an unknown unit into a wrong stock level instead of a visible refusal.
 */
export function conversionFactor(fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return 1;

  const dimension = dimensionOf(from);
  if (!dimension || !(to in dimension.units)) return null;
  return dimension.units[from] / dimension.units[to];
}

/**
 * `amount` of `fromUnit` expressed in `toUnit`, or null when it can't be.
 *
 * Rounded to 4 decimals to match the round() in stock_in_batch(): a gallon into
 * litres is 3.785411784, and carrying binary float noise past that point into
 * a stock level nobody can reconcile helps no one.
 */
export function convertAmount(amount, fromUnit, toUnit) {
  // `Number("")` is 0, so a blank field would otherwise convert to a real
  // zero quantity instead of reading as "nothing entered yet".
  if (amount === "" || amount === null || amount === undefined) return null;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  const factor = conversionFactor(fromUnit, toUnit);
  if (factor === null) return null;
  return Math.round(numeric * factor * 10000) / 10000;
}

/** "5 gal = 18.9271 L", for the line under the quantity field. */
export function describeConversion(amount, fromUnit, toUnit) {
  const converted = convertAmount(amount, fromUnit, toUnit);
  if (converted === null || normalizeUnit(fromUnit) === normalizeUnit(toUnit)) return "";
  return `${Number(amount)} ${fromUnit} = ${converted} ${toUnit}`;
}

/**
 * A price per `fromUnit` re-expressed per `toUnit`, for the Stock In cost box
 * when the unit received in changes (₱1,000 per L is ₱3,785.41 per gal).
 * Rounded to centavos, except a price under ₱1, which keeps 4 decimals:
 * ₱5 per L is ₱0.005 per mL, and rounding that to ₱0.01 would double it.
 * Null when the units can't be compared.
 */
export function convertUnitPrice(price, fromUnit, toUnit) {
  if (price === "" || price === null || price === undefined) return null;
  const numeric = Number(price);
  if (!Number.isFinite(numeric)) return null;
  // A price per one fromUnit buys 1/factor of a toUnit... so per toUnit it is
  // price × (fromUnits in one toUnit).
  const factor = conversionFactor(toUnit, fromUnit);
  if (factor === null) return null;
  const converted = numeric * factor;
  return Math.abs(converted) >= 1
    ? Math.round(converted * 100) / 100
    : Math.round(converted * 10000) / 10000;
}
