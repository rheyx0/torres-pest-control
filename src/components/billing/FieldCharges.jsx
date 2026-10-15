// "+ Transportation" and "+ Labor" for the quote and invoice forms (Sprint 5),
// and the technicians × days inputs under a labor line. The lines themselves
// are built by utils/fieldCharges.js.

import { Plus } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { colors } from "../../styles/theme";
import { laborLine, laborParts, transportLine } from "../../utils/fieldCharges";

export function ChargeButtons({ rates = {}, onAdd, size = "sm" }) {
  return (
    <>
      <Button size={size} onClick={() => onAdd(transportLine("", rates.transportRatePerKm ?? ""))}>
        <Plus size={14} /> Transportation
      </Button>
      <Button size={size} onClick={() => onAdd(laborLine(1, 1, rates.laborDailyRate ?? ""))}>
        <Plus size={14} /> Labor
      </Button>
    </>
  );
}

/** The column headings above the lines, on the same grid as each line. */
export function LineHeadings({ columns }) {
  const cell = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.muted, fontWeight: 500 };
  return (
    <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: columns, gap: "0.5rem", alignItems: "end", paddingBottom: "0.2rem", borderBottom: `1px solid ${colors.line}` }}>
      <span />
      <span style={cell}>Description</span>
      <span style={cell}>Qty</span>
      <span style={cell}>Unit price (₱)</span>
      <span style={{ ...cell, textAlign: "right" }}>Amount</span>
      <span style={{ width: "2rem" }} />
    </div>
  );
}

/** The boxed totals beside the notes, clear of the modal's footer. */
export const totalsBox = {
  margin: "0 0 0.5rem",
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "0.35rem 1rem",
  fontSize: "0.88rem",
  color: colors.body,
  padding: "0.75rem 0.9rem",
  border: `1px solid ${colors.line}`,
  borderRadius: "6px",
  background: colors.canvas,
};

/** Under a labor line: technicians × days, which set its quantity. */
export function LaborParts({ line, onChange, indent = "92px" }) {
  const parts = laborParts(line);
  return (
    <span style={{ marginLeft: `calc(${indent} + 0.5rem)`, display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: colors.muted, flexWrap: "wrap" }}>
      <Input aria-label="Technicians" type="number" min="1" step="1" value={parts.technicians} onChange={(event) => onChange({ technicians: event.target.value })} style={{ width: "4.5rem", padding: "4px 8px" }} />
      {Number(parts.technicians) === 1 ? "technician" : "technicians"} ×
      <Input aria-label="Days" type="number" min="1" step="1" value={parts.days} onChange={(event) => onChange({ days: event.target.value })} style={{ width: "4.5rem", padding: "4px 8px" }} />
      {Number(parts.days) === 1 ? "day" : "days"} = {line.quantity || 0} technician-day{Number(line.quantity) === 1 ? "" : "s"} × the daily rate
    </span>
  );
}

/** Under a transportation line: what its quantity and price mean. */
export function TransportHint({ indent = "92px" }) {
  return (
    <span style={{ marginLeft: `calc(${indent} + 0.5rem)`, fontSize: "0.75rem", color: colors.muted }}>
      Quantity is the distance in km; the price is the rate per km.
    </span>
  );
}
