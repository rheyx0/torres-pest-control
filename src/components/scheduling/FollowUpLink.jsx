// A visit's follow-ups (migration 068), in its Overview: the visit it checks
// on ("Follow-up of TPC-V-00022"), the follow-ups booked after it ("Followed
// up by TPC-V-00031"), and, once it is completed, "Book follow-up" for the
// office. A follow-up is charged at the follow-up price of the services the
// client had, and is booked under the same quotation (SchedulingPage).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, CornerDownRight } from "lucide-react";
import Button from "../ui/Button";
import Select from "../ui/Select";
import StatusPill from "../ui/StatusPill";
import { colors } from "../../styles/theme";
import { useScheduling } from "../../context/SchedulingContext";
import useAuth from "../../hooks/useAuth";
import { SUBSYSTEMS } from "../../utils/permissions";
import { appointmentReference } from "../../utils/scheduling";

const day = (value) => new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

function FollowUpLink({ appointment }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canBook = can(SUBSYSTEMS.SCHEDULING, "create");
  const { appointments, linkFollowUp } = useScheduling();
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const original = appointment.followUpOf ? appointments.find((entry) => entry.id === appointment.followUpOf) : null;
  const followUps = appointments
    .filter((entry) => entry.followUpOf === appointment.id)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const offerBooking = canBook && appointment.status === "Completed";
  // A follow-up booked before 068, or without "Book follow-up", can be tied to
  // its visit afterwards: the client's earlier visits, newest first.
  const earlier = canBook && !appointment.followUpOf && followUps.length === 0 && /follow[\s-]?up/i.test(appointment.serviceType || "")
    ? appointments
      .filter((entry) => entry.clientId === appointment.clientId && entry.id !== appointment.id && entry.status !== "Cancelled" && new Date(entry.scheduledAt) < new Date(appointment.scheduledAt))
      .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
    : [];

  if (!original && followUps.length === 0 && !offerBooking && earlier.length === 0) return null;

  const markAsFollowUp = async (originalId) => {
    if (!originalId) return;
    setLinking(true);
    setLinkError("");
    const result = await linkFollowUp(appointment.id, originalId);
    setLinking(false);
    if (result !== true) setLinkError(result);
  };

  const open = (visit) => navigate(`/scheduling?appointment=${encodeURIComponent(visit.id)}`);
  const bookFollowUp = () => {
    const date = String(appointment.followUpDate || "").slice(0, 10);
    navigate(`/scheduling?new=1&client=${encodeURIComponent(appointment.clientId)}&followup=${encodeURIComponent(appointment.id)}${date ? `&date=${date}` : ""}`);
  };
  const row = (label, visit) => (
    <li key={visit.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.35rem 0", borderTop: `1px solid ${colors.line}`, fontSize: "0.84rem" }}>
      <span style={{ color: colors.muted }}>{label}</span>
      <button type="button" onClick={() => open(visit)} style={{ border: 0, background: "none", padding: 0, color: colors.brandInk, fontWeight: 500, cursor: "pointer", font: "inherit" }}>
        {appointmentReference(visit)}
      </button>
      <span style={{ color: colors.body }}>{day(visit.scheduledAt)} · {visit.serviceType || "Visit"}</span>
      <span style={{ marginLeft: "auto" }}><StatusPill status={visit.status} /></span>
    </li>
  );

  return (
    <section aria-label="Follow-up" style={{ display: "grid", gap: "0.4rem" }}>
      <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.95rem", color: colors.ink }}>
        <CornerDownRight size={15} aria-hidden="true" style={{ color: colors.brand }} /> Follow-up
      </h3>
      {(original || followUps.length > 0) && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {original && row("Follow-up of", original)}
          {followUps.map((visit) => row("Followed up by", visit))}
        </ul>
      )}
      {earlier.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.84rem", color: colors.body }}>
          This is a follow-up of
          <Select aria-label="Follow-up of" value="" disabled={linking} onChange={(event) => markAsFollowUp(event.target.value)} style={{ width: "auto", minWidth: "240px" }}>
            <option value="">Choose the visit it follows…</option>
            {earlier.map((visit) => (
              <option key={visit.id} value={visit.id}>{appointmentReference(visit)} · {day(visit.scheduledAt)} · {visit.serviceType || "Visit"}</option>
            ))}
          </Select>
        </label>
      )}
      {linkError && <p role="alert" style={{ margin: 0, color: colors.danger, fontSize: "0.84rem" }}>{linkError}</p>}
      {appointment.followUpOf && !original && (
        <p style={{ margin: 0, color: colors.muted, fontSize: "0.84rem" }}>A follow-up of a visit that is no longer on the schedule.</p>
      )}
      {offerBooking && (
        <div>
          <Button size="sm" icon={<CalendarPlus size={14} />} onClick={bookFollowUp}>Book follow-up</Button>
          {appointment.followUpDate && (
            <span style={{ marginLeft: "0.6rem", color: colors.muted, fontSize: "0.8rem" }}>
              The technician asked for one on {day(`${String(appointment.followUpDate).slice(0, 10)}T00:00:00`)}.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

export default FollowUpLink;
