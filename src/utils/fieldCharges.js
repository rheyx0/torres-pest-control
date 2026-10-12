// Transportation and labor (Sprint 5), added on top of the service price.
// Both are ordinary quote / invoice lines (kind EXTRA), told apart by their
// unit, so the server's totals and every printout handle them unchanged:
//   Transportation: quantity = km, unit "km", unit price = rate per km
//   Labor: quantity = technicians x days, unit "technician-day",
//          unit price = daily rate per technician
// The default rates live in app_settings (migration 076) and stay editable.

export const TRANSPORT_UNIT = "km";
export const LABOR_UNIT = "technician-day";

const plural = (count, word) => `${count} ${word}${Number(count) === 1 ? "" : "s"}`;
const priceText = (rate) => (rate === "" || rate === null || rate === undefined ? "" : String(rate));

/** "TRANSPORT", "LABOR", or null for any other line. */
export function chargeKind(line) {
  if (!line || line.kind !== "EXTRA") return null;
  if (line.unit === TRANSPORT_UNIT) return "TRANSPORT";
  if (line.unit === LABOR_UNIT) return "LABOR";
  return null;
}

export function transportLine(km = "", rate = "") {
  return {
    kind: "EXTRA",
    unit: TRANSPORT_UNIT,
    description: km !== "" && km !== null ? `Transportation (${km} km)` : "Transportation",
    quantity: km === null ? "" : String(km),
    unitPrice: priceText(rate),
  };
}

export function laborLine(technicians = 1, days = 1, rate = "") {
  const count = (Number(technicians) || 0) * (Number(days) || 0);
  return {
    kind: "EXTRA",
    unit: LABOR_UNIT,
    technicians: String(technicians),
    days: String(days),
    description: `Labor (${plural(technicians, "technician")} × ${plural(days, "day")})`,
    quantity: String(count),
    unitPrice: priceText(rate),
  };
}

/** The technicians and days behind a labor line, read back from its description. */
export function laborParts(line) {
  if (line?.technicians !== undefined && line?.days !== undefined) return { technicians: line.technicians, days: line.days };
  const match = /\((\d+(?:\.\d+)?) technicians? × (\d+(?:\.\d+)?) days?\)/.exec(line?.description || "");
  if (match) return { technicians: match[1], days: match[2] };
  return { technicians: String(line?.quantity || 1), days: "1" };
}

/** A line's changes when its km, technicians or days are edited. */
export function updateCharge(line, patch) {
  const kind = chargeKind(line);
  if (kind === "TRANSPORT" && patch.quantity !== undefined) {
    return { ...patch, description: patch.quantity !== "" ? `Transportation (${patch.quantity} km)` : "Transportation" };
  }
  if (kind === "LABOR" && (patch.technicians !== undefined || patch.days !== undefined)) {
    const parts = { ...laborParts(line), ...patch };
    const next = laborLine(parts.technicians, parts.days, line.unitPrice);
    return { ...patch, technicians: next.technicians, days: next.days, description: next.description, quantity: next.quantity };
  }
  return patch;
}

export const CHARGE_LABELS = { TRANSPORT: "Transport", LABOR: "Labor" };
