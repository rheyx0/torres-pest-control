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
  PEST_CONCERN_SUGGESTIONS,
  clientClassificationOptions,
} from "../../utils/constants";
import { humanizeEnum } from "../../utils/formatters";
import { validateClient } from "../../utils/validators";
import { buttonWhen, inputStyle, invalidInputStyle } from "../../styles/theme";

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  address: "",
  source: "Walk-in",
  classification: "RESIDENTIAL",
  classificationOther: "",
  pestConcern: "",
};

function ClientForm({ initialValues, onSubmit, submitLabel = "Save Client", footer }) {
  const [form, setForm] = useState(initialValues ? { ...EMPTY_FORM, ...initialValues } : EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialValues) setForm({ ...EMPTY_FORM, ...initialValues });
  }, [initialValues]);

  const requiresOtherClassification = form.classification === "OTHER";

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = validateClient(form);
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

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <Field label="Client Name" error={errors.name}>
          <input
            aria-label="Client Name"
            name="name"
            value={form.name}
            onChange={handleFieldChange}
            style={styleFor("name")}
          />
        </Field>

        <Field label="Email" error={errors.email}>
          <input
            aria-label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleFieldChange}
            style={styleFor("email")}
          />
        </Field>

        <Field label="Phone" error={errors.phone}>
          <input
            aria-label="Phone"
            name="phone"
            value={form.phone}
            onChange={handleFieldChange}
            style={styleFor("phone")}
          />
        </Field>

        <Field label="Address" error={errors.address}>
          <textarea
            aria-label="Address"
            name="address"
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
              value={form.classificationOther}
              onChange={handleFieldChange}
              style={styleFor("classificationOther")}
              placeholder="Please specify"
            />
          </Field>
        )}

        <Field label="Pest Concern" hint="Optional. Select the main concern.">
          <select
            aria-label="Pest Concern"
            name="pestConcern"
            value={form.pestConcern}
            onChange={handleFieldChange}
            style={inputStyle}
          >
            <option value="">Select a pest concern</option>
            {PEST_CONCERN_SUGGESTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
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
