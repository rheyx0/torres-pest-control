// The plan a visit belongs to, at the top of the appointment detail
// (migration 052): every date in it, and the changes that apply to many
// visits at once.
//
//   Recurring   Change future visits (time, crew, services) · Cancel remaining ·
//               Don't renew (silences the renewal reminder; undoable)
//   Multi-day   Add a day · Change the crew or services for the days left ·
//               Finish here (cancels the days after this one)
//
// The office manages a plan. "Finish here" is also open to the crew on the
// job, since they are the ones who know it ended early. Destructive actions
// confirm inline rather than stacking a second dialog over this one.

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { neutral, radius, status as semantic, surface, text, weight } from "../../styles/tokens";
import { PLAN_KINDS } from "../../utils/plans";
import { outDuring } from "../../utils/absences";
import { toDateTimeLocal } from "../../utils/calendarDates";
import Button from "../ui/Button";
import Input from "../ui/Input";
import StatusPill from "../ui/StatusPill";
import TechnicianPicker from "./TechnicianPicker";

const when = (value) => new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const isOpen = (visit) => !["Completed", "Cancelled", "In progress"].includes(visit.status);

/** The next working morning after `visit` ends (6 AM, stepping over Sunday). */
function nextMorning(visit) {
  const date = new Date(new Date(visit.scheduledAt).getTime() + (visit.durationMinutes || 60) * 60000);
  date.setDate(date.getDate() + 1);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  date.setHours(6, 0, 0, 0);
  return toDateTimeLocal(date);
}

function PlanPanel({ appointment, visits, canManage, canFinish, accounts = [], absences = [], services = [], onOpen, onAction }) {
  const [mode, setMode] = useState(null); // "change" | "add" | "cancel" | "finish"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const multiDay = appointment.planKind === PLAN_KINDS.MULTI_DAY;
  // "Don't renew" (migration 053): the plan's renewal reminder is silenced.
  const declined = !multiDay && Boolean(appointment.planRenewalDeclinedAt);
  const index = visits.findIndex((visit) => visit.id === appointment.id);
  const last = visits[visits.length - 1];
  const later = visits.filter((visit) => new Date(visit.scheduledAt) > new Date(appointment.scheduledAt));
  const upcoming = visits.filter((visit) => isOpen(visit) && new Date(visit.scheduledAt) > new Date());
  // Out on any date the change would reach (migration 057): not offered.
  const outIds = outDuring(absences, upcoming.filter((visit) => new Date(visit.scheduledAt) >= new Date(appointment.scheduledAt)));

  // The "change" form: blank means "leave as it is".
  const [startTime, setStartTime] = useState("");
  const [crew, setCrew] = useState(null);
  const [serviceIds, setServiceIds] = useState(null);
  const [addAt, setAddAt] = useState(() => (last ? nextMorning(last) : ""));
  const [addHours, setAddHours] = useState(() => String(Math.round(((last?.durationMinutes || 60) / 60) * 10) / 10));

  const run = async (call, after) => {
    setBusy(true);
    setError("");
    const result = await call();
    setBusy(false);
    if (result !== true) {
      setError(result);
      return;
    }
    setMode(null);
    after?.();
  };

  const toggleService = (id) => setServiceIds((current) => {
    const list = current || [];
    return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  });

  const title = multiDay
    ? `Multi-day job · Day ${index + 1} of ${visits.length}`
    : `Recurring plan · ${appointment.planFrequency || appointment.serviceFrequency || ""} · ${index + 1} of ${visits.length}`;

  return (
    <section aria-label="Plan" style={{ border: `1px solid ${surface.sunken}`, borderRadius: radius.card, padding: "12px 14px", display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: neutral.ink, fontWeight: weight.medium, ...text.small }}>
        <CalendarRange size={15} aria-hidden="true" /> {title}
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "4px", maxHeight: "180px", overflowY: "auto" }}>
        {visits.map((visit, position) => (
          <li key={visit.id}>
            <button
              type="button"
              onClick={() => onOpen(visit.id)}
              aria-current={visit.id === appointment.id ? "true" : undefined}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "10px", textAlign: "left", cursor: "pointer",
                padding: "5px 8px", borderRadius: radius.control, border: 0,
                background: visit.id === appointment.id ? surface.sunken : "transparent", ...text.small, color: neutral.ink,
              }}
            >
              <span style={{ minWidth: "46px", color: neutral.bark }}>{multiDay ? `Day ${position + 1}` : `${position + 1}.`}</span>
              <span style={{ flex: 1 }}>{when(visit.scheduledAt)}</span>
              {visit.dayDoneAt && visit.status !== "Completed" && <span style={{ color: semantic.success, ...text.caption }}>Day done</span>}
              <StatusPill status={visit.status} />
            </button>
          </li>
        ))}
      </ol>

      {declined && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", color: neutral.bark, ...text.small }}>
          Not renewing — no reminder when this plan ends. The visits still booked go ahead.
          {canManage && (
            <Button size="sm" variant="quiet" loading={busy} onClick={() => run(() => onAction("setPlanRenewal", appointment.planId, true))}>Remind me again</Button>
          )}
        </div>
      )}

      {error && <p role="alert" style={{ margin: 0, color: semantic.danger, ...text.small }}>{error}</p>}

      {!mode && (canManage || canFinish) && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {canManage && upcoming.length > 0 && <Button size="sm" onClick={() => setMode("change")}>{multiDay ? "Change crew or services" : "Change future visits"}</Button>}
          {canManage && multiDay && last?.status !== "Completed" && <Button size="sm" onClick={() => setMode("add")}>Add a day</Button>}
          {canManage && !multiDay && upcoming.length > 0 && <Button size="sm" variant="quiet" onClick={() => setMode("cancel")}>Cancel remaining</Button>}
          {canManage && !multiDay && !declined && (
            <Button size="sm" variant="quiet" loading={busy} onClick={() => run(() => onAction("setPlanRenewal", appointment.planId, false))}>Don't renew</Button>
          )}
          {canFinish && multiDay && later.some(isOpen) && appointment.status !== "Cancelled" && (
            <Button size="sm" variant="quiet" onClick={() => setMode("finish")}>Finish here</Button>
          )}
        </div>
      )}

      {mode === "change" && (
        <div style={{ display: "grid", gap: "10px", padding: "10px", background: surface.sunken, borderRadius: radius.control }}>
          <span style={{ ...text.caption, color: neutral.saddle }}>
            Applies to this visit and every later one not yet started. Leave a part untouched to keep it.
          </span>
          {!multiDay && (
            <label style={{ display: "grid", gap: "4px", ...text.small, color: neutral.ink }}>
              New start time
              <Input type="time" min="06:00" max="19:00" step="900" value={startTime} onChange={(event) => setStartTime(event.target.value)} style={{ width: "140px" }} />
            </label>
          )}
          <div style={{ display: "grid", gap: "4px", ...text.small, color: neutral.ink }}>
            Technicians {crew === null && <span style={{ color: neutral.bark }}>(unchanged)</span>}
            <TechnicianPicker accounts={accounts} value={crew || []} outIds={outIds} onChange={setCrew} />
          </div>
          <div role="group" aria-label="Services for the rest of the plan" style={{ display: "grid", gap: "4px", ...text.small, color: neutral.ink }}>
            Services {serviceIds === null && <span style={{ color: neutral.bark }}>(unchanged)</span>}
            {services.map((service) => (
              <label key={service.id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input type="checkbox" checked={(serviceIds || []).includes(service.id)} onChange={() => toggleService(service.id)} />
                {service.name}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!startTime && crew === null && !serviceIds?.length}
              onClick={() => run(() => onAction("updatePlanFuture", appointment.planId, appointment.id, {
                startTime: startTime || null,
                technicianIds: crew,
                serviceIds: serviceIds?.length ? serviceIds : null,
              }))}
            >
              Apply to {upcoming.filter((visit) => new Date(visit.scheduledAt) >= new Date(appointment.scheduledAt)).length || "the"} visits
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setMode(null)}>Close</Button>
          </div>
        </div>
      )}

      {mode === "add" && (
        <div style={{ display: "flex", gap: "8px", alignItems: "end", flexWrap: "wrap", padding: "10px", background: surface.sunken, borderRadius: radius.control }}>
          <label style={{ display: "grid", gap: "4px", ...text.small, color: neutral.ink }}>
            Day {visits.length + 1} starts
            <Input type="datetime-local" value={addAt} onChange={(event) => setAddAt(event.target.value)} />
          </label>
          <label style={{ display: "grid", gap: "4px", ...text.small, color: neutral.ink }}>
            Hours
            <Input type="number" min="0.5" max="13" step="0.5" value={addHours} onChange={(event) => setAddHours(event.target.value)} style={{ width: "90px" }} />
          </label>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!addAt || !(Number(addHours) > 0)}
            onClick={() => run(() => onAction("addPlanVisit", appointment.planId, { scheduledAt: addAt, durationMinutes: Math.round(Number(addHours) * 60) }))}
          >
            Add day {visits.length + 1}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setMode(null)}>Close</Button>
        </div>
      )}

      {(mode === "cancel" || mode === "finish") && (
        <div role="alert" style={{ display: "grid", gap: "8px", padding: "10px", background: semantic.dangerSurface, color: semantic.danger, borderRadius: radius.control, ...text.small }}>
          {mode === "cancel"
            ? `Cancel the ${upcoming.length} visit${upcoming.length === 1 ? "" : "s"} still to come? Visits already done stay as history.`
            : `Finish the job on this day? The ${later.filter(isOpen).length} day${later.filter(isOpen).length === 1 ? "" : "s"} after it will be cancelled, and this day takes the report.`}
          <div style={{ display: "flex", gap: "6px" }}>
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              onClick={() => run(() => (mode === "cancel"
                ? onAction("cancelPlanRemaining", appointment.planId)
                : onAction("finishJobHere", appointment.id)))}
            >
              {mode === "cancel" ? "Yes, cancel them" : "Yes, finish here"}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setMode(null)}>Keep</Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default PlanPanel;
