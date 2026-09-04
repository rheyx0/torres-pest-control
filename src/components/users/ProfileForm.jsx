import { useEffect, useState } from "react";
import Field from "../common/Field";
import { validateEmailFormat, validatePhilippinePhone } from "../../utils/validators";
import { buttonWhen, card, colors, inputStyle, invalidInputStyle } from "../../styles/theme";

function ProfileForm({ user, onSubmit }) {
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm({
      name: user?.name || "",
      username: user?.username || "",
      email: user?.email || "",
      phone: user?.phone || "",
    });
  }, [user]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Full name is required.";
    if (!form.username.trim()) nextErrors.username = "Username is required.";

    const emailError = validateEmailFormat(form.email);
    if (emailError) nextErrors.email = emailError;
    const phoneError = validatePhilippinePhone(form.phone);
    if (phoneError) nextErrors.phone = phoneError;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    await onSubmit?.({
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
    });
    setSubmitting(false);
  };

  const readOnlyStyle = { ...inputStyle, background: "#f9fafb", color: colors.muted };
  const styleFor = (field) => (errors[field] ? invalidInputStyle : inputStyle);

  return (
    <form onSubmit={handleSubmit} style={card}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", color: colors.ink }}>
        Account Information
      </h2>
      <p style={{ margin: "0 0 1.25rem", color: colors.muted, fontSize: "0.88rem" }}>
        View and update your personal and contact details.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", alignItems: "start" }}>
        <Field label="Full Name" error={errors.name}>
          <input name="name" value={form.name} onChange={handleChange} style={styleFor("name")} />
        </Field>
        <Field label="Username" error={errors.username}>
          <input name="username" value={form.username} onChange={handleChange} style={styleFor("username")} />
        </Field>
        <Field label="Email Address" error={errors.email}>
          <input name="email" type="email" value={form.email} onChange={handleChange} style={styleFor("email")} />
        </Field>
        <Field label="Phone Number" error={errors.phone} hint="Philippine standard (11 digits, starts with 09)">
          <input name="phone" type="tel" maxLength={11} value={form.phone} onChange={handleChange} style={{ ...styleFor("phone"), width: "100%", boxSizing: "border-box" }} />
        </Field>
        <Field label="Assigned Role">
          <input value={user?.role || ""} readOnly style={readOnlyStyle} />
        </Field>
        <Field label="Account Status">
          <input value={user?.status || ""} readOnly style={readOnlyStyle} />
        </Field>
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <button type="submit" disabled={submitting} style={buttonWhen(submitting)}>
          {submitting ? "Saving Profile..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

export default ProfileForm;