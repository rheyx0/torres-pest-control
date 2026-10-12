// "+ Transportation" and "+ Labor" for the quote and invoice forms (Sprint 5),
// and the technicians × days inputs under a labor line. The lines themselves
// are built by utils/fieldCharges.js.

import { Plus } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { colors } from "../../styles/theme";
import { laborLine, laborParts, transportLine } from "../../utils/fieldCharges";

export function ChargeButtons({ rates = {}, onAdd }) {
  return (
    <>
      <Button size="sm" onClick={() => onAdd(transportLine("", rates.transportRatePerKm ?? ""))}>
        <Plus size={14} /> Transportation
      </Button>
      <Button size="sm" onClick={() => onAdd(laborLine(1, 1, rates.laborDailyRate ?? ""))}>
        <Plus size={14} /> Labor
      </Button>
    </>
  );
}

/** Under a labor line: technicians × days, which set its quantity. */
export function LaborParts({ line, onChange, indent = "92px" }) {
  const parts = laborParts(line);
  return (
    <span style={{ marginLeft: `calc(${indent} + 0.5rem)`, display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: colors.muted, flexWrap: "wrap" }}>
      <Input aria-label="Technicians" type="number" min="1" step="1" value={parts.technicians} onChange={(event) => onChange({ technicians: event.target.value })} style={{ width: "4.5rem", padding: "4px 8px" }} />
      technicians ×
      <Input aria-label="Days" type="number" min="1" step="1" value={parts.days} onChange={(event) => onChange({ days: event.target.value })} style={{ width: "4.5rem", padding: "4px 8px" }} />
      days = {line.quantity || 0} technician-days × the daily rate
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
