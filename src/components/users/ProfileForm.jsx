// The signed-in user's own profile.
//
// The username field is gone: there is no username column, so the old form
// let people edit a value that was silently dropped on save and reverted on
// refresh. Username is shown read-only (it mirrors the email) until the
// schema gains a real column.

import { useEffect, useState } from "react";
import Field from "../common/Field";
import { validateEmailFormat } from "../../utils/validators";
import { buttonWhen, card, colors, inputStyle, invalidInputStyle } from "../../styles/theme";

function ProfileForm({ user, onSubmit }) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm({ name: user?.name || "", email: user?.email || "" });
  }, [user]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Name is required.";
    const emailError = validateEmailFormat(form.email);
    if (emailError) nextErrors.email = emailError;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    await onSubmit?.({ name: form.name.trim(), email: form.email.trim() });
    setSubmitting(false);
  };

  const readOnlyStyle = { ...inputStyle, background: "#f9fafb", color: colors.muted };

  return (
    <form onSubmit={handleSubmit} style={card}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <Field label="Full Name" error={errors.name}>
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            style={errors.name ? invalidInputStyle : inputStyle}
          />
        </Field>

        <Field label="Email Address" error={errors.email} hint="This is also your sign-in username.">
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            style={errors.email ? invalidInputStyle : inputStyle}
          />
        </Field>

        <Field label="Role">
          <input value={user?.role || ""} readOnly style={readOnlyStyle} />
        </Field>

        <Field label="Status">
          <input value={user?.status || ""} readOnly style={readOnlyStyle} />
        </Field>
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <button type="submit" disabled={submitting} style={buttonWhen(submitting)}>
          {submitting ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

export default ProfileForm;
