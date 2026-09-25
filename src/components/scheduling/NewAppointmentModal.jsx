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
// The submit path is deliberately unchanged: still uncontrolled fields read
// through FormData, still returning the caller's error string on failure.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, MapPin, Phone } from "lucide-react";
import { neutral, radius, status, surface, text, weight } from "../../styles/tokens";
import { LIMITS, PEST_CONCERN_SUGGESTIONS, SERVICE_FREQUENCIES } from "../../utils/constants";
import { defaultAppointmentDateTime, toDateTimeLocal } from "../../utils/calendarDates";
import { validateAppointmentStart, validateDuration, validateMoney } from "../../utils/validators";
import { appointmentsOverlap, busyTechnicianIds, describeSlotConflict, isAssignedTo } from "../../utils/scheduling";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import Textarea from "../ui/Textarea";
import ClientCombobox from "./ClientCombobox";
import TechnicianPicker from "./TechnicianPicker";

/** The durations the office actually books. Custom reveals the raw fields. */
const DURATION_PRESETS = [30, 60, 90, 120];

const CUSTOM = "custom";
const MAX_CUSTOM_HOURS = 24;

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
  // Carried over from a client's last visit when booking a re-service.
  initialServiceId = "",
  initialFrequency = "",
  initialPestConcern = "",
  onClose,
  onCreate,
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
  const [serviceId, setServiceId] = useState("");
  const [price, setPrice] = useState("");

  const selectedClient = clients.find((client) => client.id === clientId) || null;

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

  const selectedService = services.find((service) => service.id === serviceId) || null;

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
  const freeCount = activeAccounts.filter((account) => !busyIds.has(account.id)).length;

  // A service profile carries a default price and duration (migration 047).
  // Choosing one fills them in; the price only when it is still blank, so a
  // figure already agreed with the client is never overwritten.
  const chooseService = (id) => {
    setServiceId(id);
    const service = services.find((entry) => entry.id === id);
    if (!service) return;
    if (price === "" && service.defaultPrice !== null && service.defaultPrice !== undefined) {
      setPrice(String(service.defaultPrice));
    }
    const minutes = Number(service.defaultDurationMinutes);
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

  // A re-service booking arrives with the last visit's service: apply its
  // default duration and price once, exactly as picking it by hand would.
  useEffect(() => {
    if (initialServiceId) chooseService(initialServiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recomputed per render: the picker's lower bound moves with the clock.
  const earliest = toDateTimeLocal(new Date());

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!clientId) {
      setFormError("Select a client from the list.");
      return;
    }
    const guard =
      validateAppointmentStart(scheduledAt) ||
      validateDuration(durationMinutes) ||
      describeSlotConflict([], { scheduledAt, durationMinutes }) ||
      validateMoney(price, { label: "Price" });
    if (guard) {
      setFormError(guard);
      return;
    }

    setSaving(true);
    setFormError("");

    const values = new FormData(event.currentTarget);
    const result = await onCreate({
      clientId: values.get("clientId"),
      scheduledAt: values.get("scheduledAt"),
      durationMinutes,
      pestConcern: values.get("pestConcern"),
      serviceId,
      serviceType: selectedService?.name || "",
      serviceLocation: values.get("serviceLocation") || "",
      technicianIds,
      serviceFrequency: values.get("serviceFrequency") || "",
      price,
      notes: values.get("notes"),
    });

    // The context mutators report failure by returning the message.
    if (typeof result === "string") setFormError(result);
    setSaving(false);
  };

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
            disabled={clients.length === 0}
          >
            {saving ? "Creating..." : "Create appointment"}
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
            <Field
              label="Service type"
              hint={
                selectedService?.materials?.length
                  ? `Prefills ${selectedService.materials.length} material${selectedService.materials.length === 1 ? "" : "s"} on the Stock-Out tab.`
                  : undefined
              }
            >
              <Select name="serviceType" value={serviceId} onChange={(event) => chooseService(event.target.value)}>
                <option value="">Select a service type</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </Select>
            </Field>
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
            <Field label="Frequency">
              <Select name="serviceFrequency" defaultValue={initialFrequency}>
                <option value="">Not set</option>
                {SERVICE_FREQUENCIES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </Field>

            <Field label="Price (₱)">
              <Input
                name="price"
                type="number"
                min="0"
                max={LIMITS.MAX_PRICE}
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea name="notes" rows={2} maxLength={LIMITS.NOTES_MAX} />
          </Field>
        </Section>

        {/* Advisory, not blocking: the server is still the authority, and a
            stale appointments list should never stop someone booking. */}
        {conflict && !formError && (
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
