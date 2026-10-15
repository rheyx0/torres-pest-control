// The fields for booking a warranty's checkups or a warranty re-treatment
// (Sprint 5, migration 078), as a form of its own: inside WarrantyBookingModal
// (the warranty's own buttons) and inside New appointment ("What kind of
// visit?"). Checkups come in with their dates already worked out
// (utils/warranty.js), one per checkup period (086): each date can be moved
// inside its period or dropped, and no more can be added. A
// re-treatment is one date, covers the warranty's own services and needs a
// reason. Both are ₱0, and the server refuses any date outside the warranty
// and any technician who is busy or out.

import { useState } from "react";
import { Button, Field, Input, Textarea } from "../ui";
import { colors } from "../../styles/theme";
import { formatDate } from "../../utils/formatters";
import { checkupPeriodOf, checkupProblem } from "../../utils/warranty";

const at = (day, time) => `${day}T${time || "09:00"}`;
const untilText = (day) => formatDate(`${day}T00:00:00`);

function WarrantyBookingForm({ formId, kind, warranty, dates = [], appointments = [], technicians = [], serviceNames = [], onBook, onSavingChange }) {
  const checkup = kind === "CHECKUP";
  // A checkup row keeps its period: its date can move only inside it.
  const [rows, setRows] = useState(() => (checkup ? dates : [dates[0] || ""]).map((day, index) => ({ key: `${index}-${day}`, day, period: checkup ? checkupPeriodOf(warranty, day) : null })));
  const [time, setTime] = useState("09:00");
  const [crew, setCrew] = useState([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const chosen = rows.map((row) => row.day).filter(Boolean);
    if (!chosen.length) { setError(checkup ? "Keep at least one checkup date." : "Choose the date."); return; }
    const outside = chosen.find((day) => day < warranty.start || day > warranty.end);
    if (outside) { setError(`${untilText(outside)} is outside the warranty (${untilText(warranty.start)} to ${untilText(warranty.end)}).`); return; }
    if (!checkup && !reason.trim()) { setError("Write what came back."); return; }
    if (checkup) {
      const problem = checkupProblem(warranty, appointments, chosen);
      if (problem) { setError(problem); return; }
    }
    onSavingChange?.(true);
    const result = await onBook({
      kind,
      source: { type: warranty.type, id: warranty.id },
      visits: chosen.map((day) => ({ scheduledAt: at(day, time), durationMinutes: 60 })),
      technicianIds: crew,
      reason: reason.trim(),
    });
    onSavingChange?.(false);
    if (result !== true) setError(typeof result === "string" ? result : "Nothing was booked.");
  };

  return (
    <form id={formId} onSubmit={submit} noValidate style={{ display: "grid", gap: "0.9rem" }}>
      {error && <p role="alert" style={{ margin: 0, color: colors.danger, fontSize: "0.85rem" }}>{error}</p>}
      {!checkup && serviceNames.length > 0 && (
        <p style={{ margin: 0, color: colors.body, fontSize: "0.85rem" }}>
          <strong style={{ fontWeight: 500, color: colors.ink }}>Services:</strong> {serviceNames.join(", ")} <span style={{ color: colors.muted }}>(what the warranty covers)</span>
        </p>
      )}
      <div role="group" aria-label={checkup ? "Checkup dates" : "Date"} style={{ display: "grid", gap: "0.4rem" }}>
        <span style={{ color: colors.body, fontWeight: 500, fontSize: "0.82rem" }}>{checkup ? "Checkup dates" : "Date"}</span>
        {rows.map((row, index) => (
          <div key={row.key} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <Input aria-label={checkup ? `Checkup ${index + 1} date` : "Re-treatment date"} type="date" value={row.day} min={row.period ? row.period.from : warranty.start} max={row.period ? row.period.to : warranty.end} style={{ width: "11rem" }}
              onChange={(event) => setRows((current) => current.map((entry) => (entry.key === row.key ? { ...entry, day: event.target.value } : entry)))} />
            {row.period && <span style={{ color: colors.muted, fontSize: "0.78rem" }}>any day {untilText(row.period.from)} – {untilText(row.period.to)}</span>}
            {checkup && rows.length > 1 && (
              <Button size="sm" variant="ghost" aria-label={`Remove checkup ${index + 1}`} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>Remove</Button>
            )}
          </div>
        ))}
        {checkup && rows.length === 0 && <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>Every checkup this warranty includes is already booked. An extra visit is booked as a paid visit.</p>}
        {checkup && rows.length > 0 && <span style={{ color: colors.muted, fontSize: "0.75rem" }}>One checkup per period. An extra visit is booked as a paid visit.</span>}
      </div>
      <Field label="Time" hint={checkup ? "The same time on every date. Each can be moved later on the Schedule." : "It can be moved later on the Schedule."}>
        <Input aria-label="Time" type="time" value={time} onChange={(event) => setTime(event.target.value)} style={{ width: "9rem" }} />
      </Field>
      <div role="group" aria-label="Technicians" style={{ display: "grid", gap: "0.3rem" }}>
        <span style={{ color: colors.body, fontWeight: 500, fontSize: "0.82rem" }}>Technicians</span>
        {technicians.map((technician) => (
          <label key={technician.id} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.85rem", color: colors.ink }}>
            <input type="checkbox" checked={crew.includes(technician.id)} onChange={() => setCrew((current) => (current.includes(technician.id) ? current.filter((id) => id !== technician.id) : [...current, technician.id]))} />
            {technician.name || technician.username}
          </label>
        ))}
        <span style={{ color: colors.muted, fontSize: "0.75rem" }}>Leave empty to assign later.</span>
      </div>
      {!checkup && (
        <Field label="What came back?" required>
          <Textarea aria-label="What came back" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Termites back in the kitchen cabinets." />
        </Field>
      )}
      <p style={{ margin: 0, color: colors.muted, fontSize: "0.8rem" }}>No charge · never invoiced</p>
    </form>
  );
}

export default WarrantyBookingForm;
