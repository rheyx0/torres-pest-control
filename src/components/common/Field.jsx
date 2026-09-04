// Labelled form field with optional inline validation message.
//
// A near-identical local `Field` helper was redefined at the bottom of five
// separate page files. This is that component, plus error display, which none
// of the copies had.

import { colors } from "../../styles/theme";

function Field({ label, error, hint, children }) {
  return (
    <label style={{ display: "grid", gap: "0.45rem", color: "#374151", fontWeight: 700 }}>
      <span>{label}</span>
      {children}
      {hint && !error && (
        <span style={{ color: colors.muted, fontWeight: 500, fontSize: "0.82rem" }}>{hint}</span>
      )}
      {error && (
        <span role="alert" style={{ color: colors.danger, fontWeight: 600, fontSize: "0.84rem" }}>
          {error}
        </span>
      )}
    </label>
  );
}

export default Field;
