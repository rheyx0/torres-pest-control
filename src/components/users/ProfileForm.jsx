import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Field from "../common/Field";
import { validateEmailFormat, validatePhilippinePhone } from "../../utils/validators";
import { buttonWhen, colors, inputStyle, invalidInputStyle } from "../../styles/theme";

function ProfileForm({ user, onSubmit, onAvatarChange, activeTab, onTabChange }) {
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setForm({
      name: user?.name || "",
      username: user?.username || "",
      email: user?.email || "",
      phone: user?.phone || "",
    });
    setCurrentPassword("");
  }, [user]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    const nextValue = name === "phone" ? value.replace(/\D/g, "") : value;
    setForm((previous) => ({ ...previous, [name]: nextValue }));
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

    const emailChanged = form.email.trim().toLowerCase() !== (user?.email || "").trim().toLowerCase();
    if (emailChanged && !currentPassword) nextErrors.currentPassword = "Enter your current password to change your email.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    await onSubmit?.({
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      currentPassword,
    });
    setSubmitting(false);
  };

  const [userAvatar, setUserAvatar] = useState(user?.avatarUrl || null);

  useEffect(() => {
    setUserAvatar(user?.avatarUrl || null);
  }, [user?.avatarUrl, user?.id]);

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id) return;

    setSubmitting(true);
    await onAvatarChange?.(file);
    setSubmitting(false);
    event.target.value = "";
  };

  const profileInitials = (user?.name || user?.username || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const readOnlyStyle = {
    ...inputStyle,
    background: "#f8fafc",
    color: "#475569",
    borderColor: "#e2e8f0",
    cursor: "not-allowed",
  };
  const styleFor = (field) => (errors[field] ? invalidInputStyle : inputStyle);

  return (
    <div style={{ maxWidth: "42rem", width: "100%", margin: "0 auto" }}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid rgba(148, 163, 184, 0.24)",
          borderRadius: "1.5rem",
          boxShadow: "0 10px 28px rgba(15, 23, 42, 0.04)",
          padding: "2rem",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ position: "relative", width: "6rem", height: "6rem", margin: "0 auto" }}>
            <img
              src={userAvatar || undefined}
              alt={user?.name || "User profile"}
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "999px",
                objectFit: "cover",
                border: "4px solid #fff",
                boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
                display: userAvatar ? "block" : "none",
              }}
            />
            {!userAvatar && (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "999px",
                  background: "linear-gradient(135deg, #f1f5f9 0%, #dbeafe 100%)",
                  border: "4px solid #fff",
                  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.8rem",
                  fontWeight: 800,
                  color: "#334155",
                }}
              >
                {profileInitials || "U"}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              style={{ display: "none" }}
            />
            <button
              type="button"
              aria-label="Edit photo"
              onClick={() => fileInputRef.current?.click()}
              style={{
                position: "absolute",
                right: "-0.2rem",
                bottom: "0.1rem",
                width: "2.2rem",
                height: "2.2rem",
                borderRadius: "999px",
                background: "#b91c1c",
                border: "2px solid #fff",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 8px 16px rgba(185, 28, 28, 0.22)",
                cursor: "pointer",
              }}
            >
              <Camera size={16} />
            </button>
          </div>

          <div style={{ marginTop: "0.9rem", fontSize: "1.25rem", fontWeight: 800, color: "#0f172a" }}>
            {user?.name || "User"}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.35rem",
              marginTop: "0.5rem",
              padding: "0.3rem 0.8rem",
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#6d28d9",
              background: "#f5f3ff",
              border: "1px solid rgba(167, 139, 250, 0.55)",
              borderRadius: "999px",
            }}
          >
            {user?.role === "ADMIN" ? "ADMIN" : user?.role || "USER"}
          </div>
          {user?.reference && <div
            title="Your employee number"
            style={{
              marginTop: "0.45rem",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "#475569",
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "0.2rem 0.5rem",
            }}
          >{user.reference}</div>}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.5rem",
            marginTop: "1.75rem",
            padding: "0.35rem",
            borderRadius: "999px",
            background: "#f8fafc",
            border: "1px solid rgba(148, 163, 184, 0.18)",
          }}
        >
          <button
            type="button"
            onClick={() => onTabChange?.("profile")}
            style={{
              padding: "0.55rem 1.25rem",
              borderRadius: "999px",
              border: "none",
              background: activeTab === "profile" ? "#fef2f2" : "transparent",
              color: activeTab === "profile" ? "#7f1d1d" : "#64748b",
              fontWeight: activeTab === "profile" ? 700 : 500,
              fontSize: "0.84rem",
              cursor: "pointer",
            }}
          >
            Profile Information
          </button>
          <button
            type="button"
            onClick={() => onTabChange?.("security")}
            style={{
              padding: "0.55rem 1.25rem",
              borderRadius: "999px",
              border: "none",
              background: activeTab === "security" ? "#fef2f2" : "transparent",
              color: activeTab === "security" ? "#7f1d1d" : "#64748b",
              fontWeight: activeTab === "security" ? 700 : 500,
              fontSize: "0.84rem",
              cursor: "pointer",
            }}
          >
            Security & Password
          </button>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          {activeTab === "profile" ? (
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem", textAlign: "left" }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label="Full Name" error={errors.name}>
                    <input name="name" value={form.name} onChange={handleChange} style={styleFor("name")} />
                  </Field>
                </div>

                <Field label="Username" error={errors.username}>
                  <input name="username" value={form.username} onChange={handleChange} style={styleFor("username")} />
                </Field>

                <Field label="Email Address" error={errors.email}>
                  <input name="email" type="email" value={form.email} onChange={handleChange} style={styleFor("email")} />
                </Field>

                {form.email.trim().toLowerCase() !== (user?.email || "").trim().toLowerCase() && (
                  <Field label="Current Password" error={errors.currentPassword} hint="Required to change your email address.">
                    <input
                      name="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => {
                        setCurrentPassword(event.target.value);
                        setErrors((previous) => ({ ...previous, currentPassword: undefined }));
                      }}
                      style={styleFor("currentPassword")}
                      autoComplete="current-password"
                    />
                  </Field>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem", gridColumn: "1 / -1", alignItems: "start" }}>
                  <div>
                    <Field label="Phone Number" error={errors.phone} hint="Philippine standard (11 digits, starts with 09)">
                      <input name="phone" type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={11} value={form.phone} onChange={handleChange} style={{ ...styleFor("phone"), width: "100%", boxSizing: "border-box" }} />
                    </Field>
                  </div>

                  <div>
                    <Field label="Account Status">
                      <input value={user?.status || ""} readOnly style={{ ...readOnlyStyle, width: "100%", boxSizing: "border-box" }} />
                    </Field>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", paddingTop: "1.5rem", marginTop: "1.5rem", borderTop: "1px solid #f1f5f9" }}>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    ...buttonWhen(submitting),
                    background: "#b91c1c",
                    border: "1px solid rgba(185, 28, 28, 0.3)",
                    padding: "0.7rem 1.4rem",
                    borderRadius: "0.9rem",
                    boxShadow: "0 8px 18px rgba(185, 28, 28, 0.18)",
                  }}
                >
                  {submitting ? "Saving Profile..." : "Save Changes"}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div style={{ display: "grid", gap: "1rem" }}>
                <Field label="Current Password" error={errors.currentPassword}>
                  <input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={form.currentPassword}
                    onChange={handleChange}
                    style={styleFor("currentPassword")}
                  />
                </Field>

                <Field
                  label="New Password"
                  error={errors.newPassword}
                  hint="At least 6 characters, including a letter and a number."
                >
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={form.newPassword}
                    onChange={handleChange}
                    style={styleFor("newPassword")}
                  />
                </Field>

                <Field label="Confirm New Password" error={errors.confirmPassword}>
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    style={styleFor("confirmPassword")}
                  />
                </Field>
              </div>

              {errors.form && (
                <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 700, fontSize: "0.9rem" }}>
                  {errors.form}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "1.25rem", marginTop: "1.25rem", borderTop: "1px solid #f1f5f9" }}>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{
                    ...buttonWhen(submitting),
                    background: "#b91c1c",
                    border: "1px solid rgba(185, 28, 28, 0.2)",
                    borderRadius: "0.75rem",
                    padding: "0.7rem 1.5rem",
                    fontSize: "0.88rem",
                    fontWeight: 500,
                    color: "#fff",
                    boxShadow: "0 8px 18px rgba(185, 28, 28, 0.14)",
                  }}
                >
                  {submitting ? "Updating…" : "Update Password"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileForm;