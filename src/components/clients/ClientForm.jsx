// Create / edit client profile form.
//
// Sprint AC: "System validates required fields before saving." The old create
// form had no validation at all — submitting a completely blank form saved a
// client with an empty name, which then rendered as an empty row in the list.
//
// Used by both CreateClientPage (blank) and ClientDetails (populated).

import { useEffect, useState } from "react";
import Field from "../common/Field";
import {
  CLIENT_SOURCES,
  LIMITS,
  clientClassificationOptions,
} from "../../utils/constants";
import { humanizeEnum } from "../../utils/formatters";
import { clientWithEmail, emailTakenMessage, validateClient } from "../../utils/validators";
import { buttonWhen, inputStyle, invalidInputStyle } from "../../styles/theme";

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  address: "",
  source: "Walk-in",
  classification: "RESIDENTIAL",
  classificationOther: "",
  serviceNotes: "",
};

/**
 * Classifications that mean "a company, not a household".
 *
 * Standing service instructions — which gate, who signs, what hours the site
 * can be treated in — are a company-account problem: a household is one door
 * and one person. So the field is offered for these, and stays visible for
 * anyone who already has notes, because a classification correction must never
 * hide text somebody wrote on purpose.
 */
const COMPANY_CLASSIFICATIONS = new Set([
  "COMMERCIAL",
  "HOSPITALITY",
  "WAREHOUSE_STORAGE",
  "INDUSTRIAL",
  "AGRICULTURAL",
  "EDUCATIONAL",
  "MEDICAL_FACILITY",
  "GOVERNMENT_OFFICE",
  "RELIGIOUS_INSTITUTION",
  "MILITARY_FACILITY",
  "SCIENCE_LABORATORY",
  "DOCK_PORT_FACILITY",
  "BOAT_SHIP_VESSEL",
]);

/**
 * @param clients  every client (archived too), to refuse an email another
 *                 client already has (migration 067); the one being edited is
 *                 initialValues.id and is skipped.
 */
function ClientForm({ initialValues, onSubmit, submitLabel = "Save Client", footer, clients = [] }) {
  const [form, setForm] = useState(initialValues ? { ...EMPTY_FORM, ...initialValues } : EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialValues) setForm({ ...EMPTY_FORM, ...initialValues });
  }, [initialValues]);

  const requiresOtherClassification = form.classification === "OTHER";
  const showsServiceNotes = COMPANY_CLASSIFICATIONS.has(form.classification) || Boolean(form.serviceNotes);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    const nextValue = name === "phone" ? value.replace(/\D/g, "") : value;
    setForm((previous) => ({ ...previous, [name]: nextValue }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = validateClient(form);
    const taken = !nextErrors.email && clientWithEmail(form.email, clients, initialValues?.id || null);
    if (taken) nextErrors.email = emailTakenMessage(taken);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    await onSubmit?.({
      ...form,
      name: form.name.trim(),
      classificationOther: requiresOtherClassification ? form.classificationOther.trim() : "",
    });
    setSubmitting(false);
  };

  const styleFor = (field) => (errors[field] ? invalidInputStyle : inputStyle);
  const phoneTyped = String(form.phone || "").trim();
  const sharedPhone = phoneTyped.length === 11
    ? clients.filter((client) => client.id !== initialValues?.id && String(client.phone || "").trim() === phoneTyped)
    : [];

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <Field label="Client Name" error={errors.name}>
          <input
            aria-label="Client Name"
            name="name"
            maxLength={LIMITS.SHORT_TEXT_MAX}
            value={form.name}
            onChange={handleFieldChange}
            style={styleFor("name")}
          />
        </Field>

        <Field label="Email" error={errors.email}>
          <input
            aria-label="Email"
            name="email"
            maxLength={LIMITS.SHORT_TEXT_MAX}
            type="email"
            value={form.email}
            onChange={handleFieldChange}
            style={styleFor("email")}
          />
        </Field>

        <Field label="Phone" error={errors.phone} hint="Philippine standard format (11 digits, starts with 09)">
          <input
            aria-label="Phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={11}
            placeholder="09XXXXXXXXX"
            value={form.phone}
            onChange={handleFieldChange}
            style={styleFor("phone")}
          />
          {/* Allowed (a household, a company's branches), but worth knowing. */}
          {sharedPhone.length > 0 && !errors.phone && (
            <span role="status" style={{ color: "#9a5b0b", fontSize: "0.8rem", fontWeight: 400 }}>
              Also the phone number of {sharedPhone.map((client) => `${client.name}${client.reference ? ` (${client.reference})` : ""}`).join(", ")}.
            </span>
          )}
        </Field>

        <Field label="Address" error={errors.address}>
          <textarea
            aria-label="Address"
            name="address"
            maxLength={LIMITS.NOTES_MAX}
            value={form.address}
            onChange={handleFieldChange}
            rows={3}
            style={{ ...styleFor("address"), resize: "vertical" }}
          />
        </Field>

        <Field label="Source">
          <select
            aria-label="Source"
            name="source"
            value={form.source}
            onChange={handleFieldChange}
            style={inputStyle}
          >
            {CLIENT_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Classification">
          <select
            aria-label="Classification"
            name="classification"
            value={form.classification}
            onChange={handleFieldChange}
            style={inputStyle}
          >
            {clientClassificationOptions.map((option) => (
              <option key={option} value={option}>
                {humanizeEnum(option)}
              </option>
            ))}
          </select>
        </Field>

        {requiresOtherClassification && (
          <Field label="Please specify" error={errors.classificationOther}>
            <input
              aria-label="Please specify"
              name="classificationOther"
            maxLength={LIMITS.SHORT_TEXT_MAX}
              value={form.classificationOther}
              onChange={handleFieldChange}
              style={styleFor("classificationOther")}
              placeholder="Please specify"
            />
          </Field>
        )}

        {showsServiceNotes && (
          <Field
            label="Service Notes"
            hint="Standing instructions for this account — access, contacts, restricted areas, treatment hours. Shown on every booking."
          >
            <textarea
              aria-label="Service Notes"
              name="serviceNotes"
            maxLength={LIMITS.NOTES_MAX}
              value={form.serviceNotes}
              onChange={handleFieldChange}
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
              placeholder="e.g. Deliveries via the rear gate. Ask for the duty manager. No spraying in the cold store."
            />
          </Field>
        )}

      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          marginTop: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <button type="submit" disabled={submitting} style={buttonWhen(submitting)}>
          {submitting ? "Saving…" : submitLabel}
        </button>
        {footer}
      </div>
    </form>
  );
}

export default ClientForm;
