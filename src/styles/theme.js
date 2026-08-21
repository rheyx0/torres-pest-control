// Shared inline-style objects.
//
// The app styles everything with inline `style={{...}}` props. These objects
// were copy-pasted into nearly every page (inputStyle alone appeared five
// times, with three slightly different paddings). Centralising them keeps the
// look consistent and gives a single place to change when/if the app moves to
// real CSS classes in globals.css.

export const colors = {
  brand: "#7f1111",
  brandLight: "#bf3e3e",
  brandInk: "#8b1e1e",
  ink: "#0f172a",
  body: "#111827",
  muted: "#6b7280",
  line: "#dfe4ea",
  softLine: "rgba(148, 163, 184, 0.18)",
  success: "#1f7a5f",
  danger: "#b91c1c",
};

export const pageShell = {
  maxWidth: "1200px",
  margin: "0 auto",
};

export const card = {
  background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)",
  border: `1px solid ${colors.softLine}`,
  borderRadius: "20px",
  padding: "1.5rem",
  boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)",
};

export const inputStyle = {
  width: "100%",
  border: `1px solid ${colors.line}`,
  borderRadius: "12px",
  padding: "0.8rem 0.9rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: colors.body,
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

export const invalidInputStyle = {
  ...inputStyle,
  borderColor: colors.danger,
  background: "#fffafa",
};

export const primaryButton = {
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "12px",
  background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandLight} 100%)`,
  color: "#fff",
  padding: "0.9rem 1.2rem",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)",
};

export const secondaryButton = {
  border: `1px solid ${colors.line}`,
  background: "#fff",
  color: colors.body,
  borderRadius: "12px",
  padding: "0.75rem 1rem",
  fontWeight: 700,
  cursor: "pointer",
};

export const dangerButton = {
  border: "1px solid rgba(255,255,255,0.18)",
  background: "linear-gradient(135deg, #475569 0%, #64748b 100%)",
  color: "#fff",
  borderRadius: "12px",
  padding: "0.7rem 0.9rem",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 18px rgba(15, 23, 42, 0.12)",
};

export const successButton = {
  ...dangerButton,
  background: "linear-gradient(135deg, #0f766e 0%, #34d399 100%)",
};

export const badge = {
  background: "#fef2f2",
  color: colors.brandInk,
  borderRadius: "999px",
  padding: "0.35rem 0.7rem",
  fontWeight: 700,
  fontSize: "0.8rem",
};

export const appBackground =
  "radial-gradient(circle at top left, #fff3f3 0%, #f7f7f8 36%, #f1f5f9 100%)";

export const fieldGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "1rem",
};

export function buttonWhen(disabled, base = primaryButton) {
  return { ...base, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.7 : 1 };
}
