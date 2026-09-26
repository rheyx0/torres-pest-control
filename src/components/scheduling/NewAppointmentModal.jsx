// The New appointment form.
//
// Previously nine fields stacked in a 460px column with no grouping: Client,
// Date and time, Hours, Minutes, Technician, Service type, Service location,
// Pest concern, Notes. Same fields, now in four labelled sections across two
// columns, so the form reads as "who, when, what work, who does it" instead
// of as a list.
//
// Two behavioural additions, both using logic that already existed and was
// simply not wired to this form:
//
//   - describeSlotConflict runs as the user types, so a clash is reported
//     before submitting rather than after a failed round trip.
//   - busyTechnicianIds marks technicians already booked in the chosen
//     window. The detail panel's form already did this; this one did not.
//
// Plans (migration 052): a recurring frequency asks how many visits (or until
// when) and lists every date; a duration longer than one working day offers to
// split into a multi-day job. Either way the dates are worked out in
// utils/plans.js, shown with ✓ / ⚠ (PlanDates), fixed where flagged, and the
// exact list is booked through onBook in one transaction. A single visit with
// at most one service still goes through onCreate, as before.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, MapPin, Phone } from "lucide-react";
import { neutral, radius, status, surface, text, weight } from "../../styles/tokens";
import { LIMITS, PEST_CONCERN_SUGGESTIONS, SERVICE_FREQUENCIES } from "../../utils/constants";
import { defaultAppointmentDateTime, toDateTimeLocal } from "../../utils/calendarDates";
import { validateAppointmentStart, validateDuration, validateMoney } from "../../utils/validators";
import { appointmentsOverlap, busyTechnicianIds, describeSlotConflict, isAssignedTo } from "../../utils/scheduling";
import { describeOut, outDuring } from "../../utils/absences";
import {
  MAX_PLAN_VISITS,
  PLAN_KINDS,
  WORKDAY_MINUTES,
  atTime,
  checkVisits,
  commonFreeTime,
  freeTechnician,
  isRecurringFrequency,
  nextFreeStart,
  recurringDates,
  splitIntoDays,
} from "../../utils/plans";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import Textarea from "../ui/Textarea";
import ClientCombobox from "./ClientCombobox";
import PlanDates from "./PlanDates";
import TechnicianPicker from "./TechnicianPicker";

/** The durations the office actually books. Custom reveals the raw fields. */
const DURATION_PRESETS = [30, 60, 90, 120];

const CUSTOM = "custom";
// A single visit fits one working day (13 h); anything longer is offered as a
// multi-day job, so the custom hours reach far enough for a week of work.
const MAX_CUSTOM_HOURS = 72;
const DEFAULT_PLAN_VISITS = 6;

const clampWholeNumber = (value, maximum) => {
  if (value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.min(maximum, Math.max(0, Math.floor(number))));
};

function Section({ legend, span = 1, children }) {
  return (
    <fieldset
      style={{
        gridColumn: span === 2 ? "1 / -1" : "auto",
        border: "none",
        borderTop: `1px solid ${surface.sunken}`,
        margin: 0,
        padding: "12px 0 0",
        minWidth: 0,
        display: "grid",
        alignContent: "start",
        gap: "12px",
      }}
    >
      <legend
        style={{
          ...text.caption,
          textTransform: "uppercase",
          letterSpacing: "0.058em",
          color: neutral.bark,
          fontWeight: weight.medium,
          padding: "0 8px 0 0",
        }}
      >
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function NewAppointmentModal({
  clients,
  activeAccounts,
  appointments = [],
  services = [],
  initialClientId = "",
  initialScheduledAt = "",
  // Carried over from a client's last visit when booking a re-service or
  // renewing a plan: every service it had, not only the first.
  initialServiceIds = [],
  initialFrequency = "",
  initialPestConcern = "",
  // Booking from an approved quote (Sprint 3): the quoted price, kept as typed.
  initialPrice = "",
  // Booking a contract's visits (063): its length, as a number of visits or an end date.
  initialVisitCount = null,
  initialUntil = "",
  // Technicians who are out (migration 057): they cannot be booked.
  absences = [],
  // Billing (Sprint 3): the quotes and contracts this visit can be booked
  // under, { quotes: [{ id, clientId, label, bookable, reason }], contracts:
  // [{ id, clientId, label }] }. Null when billing isn't in use: no picker, no
  // warning. initialSource is "quote:<id>" or "contract:<id>".
  billingSources = null,
  initialSource = "",
  onClose,
  onCreate,
  onBook,
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [clientId, setClientId] = useState(initialClientId);
  const initialClient = clients.find((client) => client.id === initialClientId) || null;
  const [serviceLocation, setServiceLocation] = useState(initialClient?.address || "");

  const [scheduledAt, setScheduledAt] = useState(
    initialScheduledAt || defaultAppointmentDateTime()
  );
  const [durationChoice, setDurationChoice] = useState(60);
  const [customHours, setCustomHours] = useState(1);
  const [customMinutes, setCustomMinutes] = useState(0);
  const [technicianIds, setTechnicianIds] = useState([]);
  const [serviceIds, setServiceIds] = useState([]);
  const [price, setPrice] = useState(initialPrice === "" || initialPrice == null ? "" : String(initialPrice));
  // Once the office types a price it is theirs: ticking services no longer
  // replaces it with the services' defaults.
  const [priceTouched, setPriceTouched] = useState(initialPrice !== "" && initialPrice != null);

  // The plan. A recurring frequency makes it RECURRING; accepting the split
  // offered for an over-long job makes it MULTI_DAY; otherwise a single visit.
  const [frequency, setFrequency] = useState(initialFrequency);
  const [repeatBy, setRepeatBy] = useState(initialUntil && !initialVisitCount ? "until" : "count");
  const [visitCount, setVisitCount] = useState(initialVisitCount || DEFAULT_PLAN_VISITS);
  const [until, setUntil] = useState(initialUntil || "");
  const [skipSundays, setSkipSundays] = useState(true);
  const [multiDay, setMultiDay] = useState(false);
  // Dates the office changed by hand, and visits removed, by row key.
  const [overrides, setOverrides] = useState({});
  const [removed, setRemoved] = useState([]);

  const selectedClient = clients.find((client) => client.id === clientId) || null;
  const [source, setSource] = useState(initialSource);
  const sourceQuotes = (billingSources?.quotes || []).filter((quote) => quote.clientId === clientId);
  const sourceContracts = (billingSources?.contracts || []).filter((contract) => contract.clientId === clientId);

  const durationMinutes =
    durationChoice === CUSTOM
      ? (Number(customHours) || 0) * 60 + (Number(customMinutes) || 0)
      : durationChoice;

  const busyIds = useMemo(() => {
    if (!scheduledAt || !durationMinutes) return new Set();
    return busyTechnicianIds(appointments, { id: null, scheduledAt, durationMinutes });
  }, [appointments, scheduledAt, durationMinutes]);

  // The same check the server will run, reported while the user is still in
  // the form rather than after a rejected round trip.
  const conflict = useMemo(() => {
    if (!scheduledAt || !durationMinutes) return null;
    return describeSlotConflict(appointments, {
      id: null,
      scheduledAt,
      durationMinutes,
      technicianIds,
    });
  }, [appointments, scheduledAt, durationMinutes, technicianIds]);

  const selectedServices = serviceIds.map((id) => services.find((service) => service.id === id)).filter(Boolean);
  const materialCount = new Set(selectedServices.flatMap((service) => (service.materials || []).map((material) => material.itemId))).size;

  // Who is already out at the chosen time, and where — so a clash is visible
  // while picking the time, not only after ticking a busy technician.
  const clashes = useMemo(() => {
    if (!scheduledAt || !durationMinutes || busyIds.size === 0) return [];
    const slot = { id: null, scheduledAt, durationMinutes };
    return activeAccounts
      .filter((account) => busyIds.has(account.id))
      .map((account) => {
        const visit = appointments.find(
          (entry) => entry.status !== "Cancelled" && isAssignedTo(entry, account.id) && appointmentsOverlap(entry, slot)
        );
        const start = visit ? new Date(visit.scheduledAt) : null;
        const end = visit ? new Date(start.getTime() + (visit.durationMinutes || 60) * 60000) : null;
        const clock = (date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const where = visit ? clients.find((client) => client.id === visit.clientId)?.name : "";
        return `${(account.name || account.username).split(" ")[0]}${where ? ` is on ${where}` : " is booked"}${visit ? ` ${clock(start)}–${clock(end)}` : ""}`;
      });
  }, [activeAccounts, appointments, busyIds, clients, scheduledAt, durationMinutes]);

  // A service profile carries a default price and duration (migration 047).
  // Ticking services fills in their totals: the durations added up, and the
  // prices added up unless the office has typed its own figure.
  const applyServices = (ids) => {
    setServiceIds(ids);
    const chosen = ids.map((id) => services.find((entry) => entry.id === id)).filter(Boolean);
    const prices = chosen.map((service) => service.defaultPrice).filter((value) => value !== null && value !== undefined && value !== "");
    if (!priceTouched) setPrice(prices.length ? String(prices.reduce((sum, value) => sum + Number(value), 0)) : "");
    const minutes = chosen.reduce((sum, service) => sum + (Number(service.defaultDurationMinutes) || 0), 0);
    if (minutes > 0) {
      if (DURATION_PRESETS.includes(minutes)) {
        setDurationChoice(minutes);
      } else {
        setDurationChoice(CUSTOM);
        setCustomHours(Math.floor(minutes / 60));
        setCustomMinutes(minutes % 60);
      }
    }
  };
  const toggleService = (id) => applyServices(serviceIds.includes(id) ? serviceIds.filter((entry) => entry !== id) : [...serviceIds, id]);

  // Picking a quote or contract fills the form from it, as ticking the
  // services by hand would, then its agreed price: a quote's total, or a
  // contract's price per visit with its frequency and length. Everything stays
  // editable; choosing "None" leaves the form as it is.
  const chooseSource = (value) => {
    setSource(value);
    setFormError("");
    const [type, id] = value ? value.split(":") : ["", ""];
    const picked = type === "quote" ? sourceQuotes.find((entry) => entry.id === id) : type === "contract" ? sourceContracts.find((entry) => entry.id === id) : null;
    if (!picked) return;
    const known = (picked.serviceIds || []).filter((serviceId) => services.some((service) => service.id === serviceId));
    if (known.length) applyServices(known);
    if (picked.price !== undefined && picked.price !== null) {
      setPrice(String(picked.price));
      setPriceTouched(true);
    }
    if (type === "contract") {
      if (picked.frequency) setFrequency(picked.frequency);
      if (picked.visitCount) {
        setRepeatBy("count");
        setVisitCount(picked.visitCount);
      } else if (picked.until) {
        setRepeatBy("until");
        setUntil(picked.until);
      }
    }
  };

  // A re-service or renewal arrives with the last visit's services: apply
  // their defaults once, exactly as ticking them by hand would.
  useEffect(() => {
    const known = initialServiceIds.filter((id) => services.some((service) => service.id === id));
    if (known.length) applyServices(known);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- The plan ------------------------------------------------------------

  const overlong = durationMinutes > WORKDAY_MINUTES;
  // Shortened back under a day, the job is a single visit again.
  useEffect(() => {
    if (multiDay && !overlong) setMultiDay(false);
  }, [multiDay, overlong]);

  const kind = multiDay ? PLAN_KINDS.MULTI_DAY : isRecurringFrequency(frequency) ? PLAN_KINDS.RECURRING : null;

  // A new start, frequency, length or rule is a new list: hand edits made to
  // the old one no longer line up with it.
  useEffect(() => {
    setOverrides({});
    setRemoved([]);
  }, [kind, scheduledAt, frequency, repeatBy, visitCount, until, skipSundays, durationMinutes]);

  const baseVisits = useMemo(() => {
    if (!scheduledAt || !kind) return [];
    const rows = kind === PLAN_KINDS.MULTI_DAY
      ? splitIntoDays(scheduledAt, durationMinutes, { skipSundays })
      : recurringDates(scheduledAt, frequency, {
        count: repeatBy === "count" ? Math.max(2, Number(visitCount) || 0) : null,
        until: repeatBy === "until" ? until || null : null,
        skipSundays,
      }).map((date) => ({ scheduledAt: toDateTimeLocal(date), durationMinutes }));
    return rows.map((row, index) => ({ ...row, key: `v${index}` }));
  }, [kind, scheduledAt, durationMinutes, frequency, repeatBy, visitCount, until, skipSundays]);

  const nameOf = (id) => {
    const account = activeAccounts.find((entry) => entry.id === id);
    return account ? (account.name || account.username).split(" ")[0] : "";
  };
  const planContext = { appointments, technicianIds, kind, skipSundays, nameOf };
  const planVisits = checkVisits(
    baseVisits
      .filter((visit) => !removed.includes(visit.key))
      .map((visit) => (overrides[visit.key] ? { ...visit, scheduledAt: overrides[visit.key] } : visit)),
    planContext
  );
  const planProblems = planVisits.filter((visit) => visit.problem).length;
  // Whole-series fixes are only worth computing when every date is flagged.
  const everyDateFlagged = planVisits.length > 0 && planProblems === planVisits.length;
  const seriesTime = everyDateFlagged && kind === PLAN_KINDS.RECURRING ? commonFreeTime(planVisits, planContext) : null;
  // Everyone out on any of the dates being booked — the one visit, or every
  // date of a plan (migration 057). The server refuses them; this says so first.
  const outIds = scheduledAt
    ? outDuring(absences, kind ? planVisits : [{ scheduledAt, durationMinutes }])
    : new Map();
  const seriesAccount = everyDateFlagged
    ? freeTechnician(planVisits, planContext, activeAccounts.filter((account) => !outIds.has(account.id)))
    : null;
  const freeCount = activeAccounts.filter((account) => !busyIds.has(account.id) && !outIds.has(account.id)).length;

  const moveAllTo = (time) => setOverrides(Object.fromEntries(planVisits.map((visit) => [visit.key, atTime(visit, time).scheduledAt])));

  // Recomputed per render: the picker's lower bound moves with the clock.
  const earliest = toDateTimeLocal(new Date());

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!clientId) {
      setFormError("Select a client from the list.");
      return;
    }
    if (overlong && !multiDay) {
      setFormError("This won't fit in one working day. Split it into a multi-day job, or shorten it.");
      return;
    }
    const guard =
      validateAppointmentStart(scheduledAt) ||
      (kind === PLAN_KINDS.MULTI_DAY ? null : validateDuration(durationMinutes)) ||
      (kind ? null : describeSlotConflict([], { scheduledAt, durationMinutes })) ||
      validateMoney(price, { label: "Price" });
    if (guard) {
      setFormError(guard);
      return;
    }
    if (kind && planVisits.length < 2) {
      setFormError(kind === PLAN_KINDS.MULTI_DAY ? "A multi-day job needs at least two days." : "A plan needs at least two visits. Pick a later end date or more visits.");
      return;
    }
    if (kind && planProblems > 0) {
      setFormError(`Fix the ${planProblems} flagged ${planProblems === 1 ? "date" : "dates"} first.`);
      return;
    }
    const [sourceType, sourceId] = source ? source.split(":") : ["", ""];
    if (sourceType === "contract" && kind !== PLAN_KINDS.RECURRING) {
      setFormError("A contract's visits are booked as a recurring plan: choose how often, and the number of visits.");
      return;
    }
    const away = technicianIds.find((id) => outIds.has(id));
    if (away) {
      setFormError(`${nameOf(away)} is ${describeOut(outIds.get(away))}. Choose someone else.`);
      return;
    }

    setSaving(true);
    setFormError("");

    const values = new FormData(event.currentTarget);
    const booking = {
      clientId: values.get("clientId"),
      durationMinutes,
      pestConcern: values.get("pestConcern"),
      serviceIds,
      serviceLocation: values.get("serviceLocation") || "",
      technicianIds,
      serviceFrequency: kind === PLAN_KINDS.MULTI_DAY ? "One-time" : frequency,
      price,
      notes: values.get("notes"),
      // Linked once booked (SchedulingPage): quote_id, or the contract's plan.
      source: sourceId ? { type: sourceType, id: sourceId } : null,
    };
    // A plan, or one visit carrying several services, is booked in one go
    // (book_appointments, 052). A plain single visit keeps the older path,
    // which also works on a database without 052.
    const result = kind || serviceIds.length > 1
      ? await onBook({
        ...booking,
        kind,
        skipSundays,
        visits: kind ? planVisits.map(({ scheduledAt: at, durationMinutes: minutes }) => ({ scheduledAt: at, durationMinutes: minutes })) : [{ scheduledAt, durationMinutes }],
      })
      : await onCreate({
        ...booking,
        scheduledAt: values.get("scheduledAt"),
        serviceId: serviceIds[0] || "",
        serviceType: selectedServices[0]?.name || "",
      });

    // The context mutators report failure by returning the message.
    if (typeof result === "string") setFormError(result);
    setSaving(false);
  };

  const submitLabel = saving
    ? "Booking..."
    : kind === PLAN_KINDS.MULTI_DAY
      ? `Book ${planVisits.length}-day job`
      : kind === PLAN_KINDS.RECURRING
        ? `Book ${planVisits.length} visits`
        : "Create appointment";

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Scheduling"
      title="New appointment"
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="new-appointment-form"
            variant="primary"
            loading={saving}
            disabled={clients.length === 0 || (Boolean(kind) && planProblems > 0)}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id="new-appointment-form"
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "12px 20px",
        }}
      >
        <Section legend="Client" span={2}>
          <Field label="Client" required>
            <ClientCombobox
              clients={clients}
              value={clientId}
              initialSearch={initialClient?.name || ""}
              onChange={(id, client) => {
                setClientId(id);
                setServiceLocation(client?.address || "");
                // A quote or contract belongs to one client.
                if (id !== clientId) setSource("");
              }}
            />
          </Field>

          {selectedClient && (
            <div
              style={{
                display: "flex",
                gap: "15px",
                flexWrap: "wrap",
                padding: "9px 12px",
                background: surface.sunken,
                borderRadius: radius.control,
                ...text.caption,
                color: neutral.saddle,
              }}
            >
              {selectedClient.address && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <MapPin size={12} aria-hidden="true" />
                  {selectedClient.address}
                </span>
              )}
              {selectedClient.phone && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <Phone size={12} aria-hidden="true" />
                  {selectedClient.phone}
                </span>
              )}
            </div>
          )}

          {/* The service comes first: it sets the duration and the price, so
              picking it before the time means both are right when the time
              is chosen. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", alignItems: "start" }}>
            {/* Not a Field: a checkbox group, labelled through role="group"
                (a <label> would name only its first checkbox). */}
            <div role="group" aria-label="Services" style={{ display: "grid", gap: "6px" }}>
              <span style={{ color: neutral.ink, fontWeight: weight.medium, fontSize: text.small.fontSize }}>Services</span>
              <div style={{ display: "grid", gap: "4px", maxHeight: "140px", overflowY: "auto", padding: "6px 8px", border: `1px solid ${surface.sunken}`, borderRadius: radius.control }}>
                {services.map((service) => (
                  <label key={service.id} style={{ display: "flex", alignItems: "center", gap: "8px", ...text.small, color: neutral.ink, cursor: "pointer" }}>
                    <input type="checkbox" checked={serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />
                    {service.name}
                  </label>
                ))}
                {services.length === 0 && <span style={{ color: neutral.bark, ...text.small }}>No services set up yet.</span>}
              </div>
              {materialCount > 0 && (
                <span style={{ color: neutral.bark, fontSize: text.caption.fontSize }}>
                  Prefills {materialCount} material{materialCount === 1 ? "" : "s"} on the Stock-Out tab.
                </span>
              )}
            </div>
            <Field label="Service location">
              <Input
                name="serviceLocation"
                value={serviceLocation}
                onChange={(event) => setServiceLocation(event.target.value)}
                placeholder="Defaults to the client's address"
                maxLength={LIMITS.NOTES_MAX}
              />
            </Field>
          </div>

          {billingSources && clientId && (
            <Field label="Quote or contract" hint="Booked under it, the visit is linked for billing.">
              <Select aria-label="Quote or contract" value={source} onChange={(event) => chooseSource(event.target.value)}>
                <option value="">None</option>
                {sourceQuotes.length > 0 && (
                  <optgroup label="Approved quotes">
                    {sourceQuotes.map((quote) => (
                      <option key={quote.id} value={`quote:${quote.id}`} disabled={!quote.bookable}>
                        {quote.label}{quote.bookable ? "" : ` — ${quote.reason}`}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sourceContracts.length > 0 && (
                  <optgroup label="Active contracts">
                    {sourceContracts.map((contract) => <option key={contract.id} value={`contract:${contract.id}`}>{contract.label}</option>)}
                  </optgroup>
                )}
              </Select>
            </Field>
          )}
        </Section>

        <Section legend="When">
          <Field label="Date and time" required>
            <Input
              name="scheduledAt"
              type="datetime-local"
              value={scheduledAt}
              min={earliest}
              onChange={(event) => setScheduledAt(event.target.value)}
              required
            />
          </Field>
          {clashes.length > 0 && (
            <p data-testid="clash-hint" style={{ margin: "-4px 0 0", color: status.warning, fontSize: "12.5px", lineHeight: 1.45 }}>
              Booked then: {clashes.join("; ")}.
            </p>
          )}

          {/* A radiogroup of toggle buttons, NOT a labelled control. Wrapping
              these in Field's <label> made the first button inherit the
              label's whole text as its accessible name, because a <label>
              implicitly labels its first labelable descendant and a button
              is labelable. */}
          <div role="group" aria-label="Duration" style={{ display: "grid", gap: "6px" }}>
            <span style={{ color: neutral.ink, fontWeight: weight.medium, fontSize: text.small.fontSize }}>
              Duration
            </span>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {DURATION_PRESETS.map((minutes) => (
                <Button
                  key={minutes}
                  size="sm"
                  onClick={() => setDurationChoice(minutes)}
                  aria-pressed={durationChoice === minutes}
                  style={
                    durationChoice === minutes
                      ? { border: "1px solid #7f1111", color: "#8b1e1e", background: "rgba(127, 17, 17, 0.06)" }
                      : undefined
                  }
                >
                  {minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}
                </Button>
              ))}
              <Button
                size="sm"
                onClick={() => setDurationChoice(CUSTOM)}
                aria-pressed={durationChoice === CUSTOM}
                style={
                  durationChoice === CUSTOM
                    ? { border: "1px solid #7f1111", color: "#8b1e1e", background: "rgba(127, 17, 17, 0.06)" }
                    : undefined
                }
              >
                Custom
              </Button>
            </div>
          </div>

          {durationChoice === CUSTOM && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Field label="Hours">
                <Input
                  type="number"
                  min="0"
                  max={MAX_CUSTOM_HOURS}
                  step="1"
                  value={customHours}
                  onChange={(event) => setCustomHours(clampWholeNumber(event.target.value, MAX_CUSTOM_HOURS))}
                />
              </Field>
              <Field label="Minutes">
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={customMinutes}
                  onChange={(event) => setCustomMinutes(clampWholeNumber(event.target.value, 59))}
                />
              </Field>
            </div>
          )}

          {/* Longer than one working day: offer the split instead of refusing. */}
          {overlong && (
            <div role="status" style={{ display: "grid", gap: "8px", padding: "9px 12px", borderRadius: radius.control, background: multiDay ? status.successSurface : status.warningSurface, color: multiDay ? status.success : status.warning, ...text.small }}>
              {multiDay
                ? `Booked as a multi-day job: ${planVisits.length} days, one report at the end.`
                : "This won't fit in one working day (6 AM – 7 PM)."}
              <span>
                <Button size="sm" onClick={() => setMultiDay(!multiDay)}>
                  {multiDay ? "Undo split" : "Split into a multi-day job"}
                </Button>
              </span>
            </div>
          )}
        </Section>

        <Section legend="Assignment">
          {/* Not a Field: the picker is a checkbox group, and a <label> around
              it would name only its first checkbox. TechnicianPicker labels
              itself through role="group". */}
          <div style={{ display: "grid", gap: "6px" }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: "8px", color: neutral.ink, fontWeight: weight.medium, fontSize: text.small.fontSize }}>
              Technicians
              {activeAccounts.length > 0 && scheduledAt && (
                <span style={{ color: neutral.bark, fontWeight: weight.regular, fontSize: "12px" }}>
                  {freeCount === activeAccounts.length ? "All free at this time" : `${freeCount} of ${activeAccounts.length} free at this time`}
                </span>
              )}
            </span>
            <TechnicianPicker
              accounts={activeAccounts}
              value={technicianIds}
              busyIds={busyIds}
              outIds={outIds}
              onChange={setTechnicianIds}
            />
          </div>
        </Section>

        <Section legend="Details" span={2}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "start" }}>
            <Field label="Pest concern">
              <Select name="pestConcern" defaultValue={initialPestConcern}>
                <option value="">Select a pest concern</option>
                {PEST_CONCERN_SUGGESTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </Field>

            {/* Both belong to the visit, not to the client: the same client can
                hold a quarterly contract and a one-off fumigation, and the
                price has to stay whatever was agreed on the day. */}
            <Field label="Frequency" hint={multiDay ? "A multi-day job is booked once." : undefined}>
              <Select name="serviceFrequency" value={multiDay ? "One-time" : frequency} disabled={multiDay} onChange={(event) => setFrequency(event.target.value)}>
                <option value="">Not set</option>
                {SERVICE_FREQUENCIES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </Field>

            <Field label={multiDay ? "Price for the whole job (₱)" : kind === PLAN_KINDS.RECURRING ? "Price per visit (₱)" : "Price (₱)"}>
              <Input
                name="price"
                type="number"
                min="0"
                max={LIMITS.MAX_PRICE}
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                  setPriceTouched(true);
                }}
              />
            </Field>
          </div>

          {kind === PLAN_KINDS.RECURRING && (
            <div style={{ display: "flex", gap: "12px", alignItems: "end", flexWrap: "wrap" }}>
              <div role="group" aria-label="Plan length" style={{ display: "flex", gap: "5px" }}>
                <Button size="sm" aria-pressed={repeatBy === "count"} onClick={() => setRepeatBy("count")}>Number of visits</Button>
                <Button size="sm" aria-pressed={repeatBy === "until"} onClick={() => setRepeatBy("until")}>Until a date</Button>
              </div>
              {repeatBy === "count" ? (
                <Field label="Visits">
                  <Input type="number" min="2" max={MAX_PLAN_VISITS} step="1" value={visitCount} onChange={(event) => setVisitCount(clampWholeNumber(event.target.value, MAX_PLAN_VISITS))} style={{ width: "90px" }} />
                </Field>
              ) : (
                <Field label="Until">
                  <Input type="date" value={until} min={scheduledAt.slice(0, 10)} onChange={(event) => setUntil(event.target.value)} />
                </Field>
              )}
            </div>
          )}

          {kind && (
            <label style={{ display: "flex", alignItems: "center", gap: "8px", ...text.small, color: neutral.ink }}>
              <input type="checkbox" checked={skipSundays} onChange={(event) => setSkipSundays(event.target.checked)} />
              Skip Sundays
            </label>
          )}

          <Field label="Notes">
            <Textarea name="notes" rows={2} maxLength={LIMITS.NOTES_MAX} />
          </Field>
        </Section>

        {kind && (
          <Section legend={kind === PLAN_KINDS.MULTI_DAY ? "Days of the job" : "Dates"} span={2}>
            {planVisits.length === 0 ? (
              <p style={{ margin: 0, color: neutral.bark, ...text.small }}>
                {repeatBy === "until" && !until ? "Pick an end date to see the visits." : "No dates yet — check the start date."}
              </p>
            ) : (
              <PlanDates
                kind={kind}
                visits={planVisits}
                commonTime={seriesTime}
                freeAccount={seriesAccount}
                suggestionFor={(visit) => nextFreeStart(visit, planVisits, planContext)}
                onChange={(key, value) => setOverrides((current) => ({ ...current, [key]: value }))}
                onRemove={(key) => setRemoved((current) => [...current, key])}
                onMoveAll={moveAllTo}
                onUseAccount={(account) => setTechnicianIds([account.id])}
              />
            )}
          </Section>
        )}

        {/* Skipping billing is allowed (an inspection, a follow-up), but it
            should be a choice, not an accident. */}
        {billingSources && clientId && !source && (
          <p
            role="status"
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              gap: "7px",
              margin: 0,
              padding: "9px 12px",
              background: status.warningSurface,
              color: status.warning,
              borderRadius: radius.control,
              ...text.small,
            }}
          >
            <AlertTriangle size={14} aria-hidden="true" />
            No quote or contract linked. No down payment is collected; the visit is billed later from its price.
          </p>
        )}

        {/* Advisory, not blocking: the server is still the authority, and a
            stale appointments list should never stop someone booking. A plan
            shows its clashes per date above instead. */}
        {conflict && !kind && !overlong && !formError && (
          <p
            role="status"
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              gap: "7px",
              margin: 0,
              padding: "9px 12px",
              background: status.warningSurface,
              color: status.warning,
              borderRadius: radius.control,
              ...text.small,
            }}
          >
            <AlertTriangle size={14} aria-hidden="true" />
            {conflict}
          </p>
        )}

        {formError && (
          <p
            role="alert"
            style={{
              gridColumn: "1 / -1",
              margin: 0,
              padding: "9px 12px",
              background: status.dangerSurface,
              color: status.danger,
              borderRadius: radius.control,
              ...text.small,
            }}
          >
            {formError}
          </p>
        )}
      </form>
    </Modal>
  );
}

export default NewAppointmentModal;
