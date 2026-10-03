// Labelled form field with optional inline validation message.
//
// A near-identical local `Field` helper was redefined at the bottom of five
// separate page files. This is that component, plus error display, which none
// of the copies had. Help text (`hint`) is a tooltip: an ⓘ in the label, the
// text outside it so it doesn't become part of the field's name.

import { colors } from "../../styles/theme";
import { InfoTipIcon, TipText } from "../ui/InfoTip";

function Field({ label, error, hint: helpText, children, style }) {
  // An error takes the place of the help text, as it always has. The layout
  // stays the same either way, so the input never remounts and loses focus.
  const wrapped = Boolean(helpText);
  const hint = error ? null : helpText;
  const field = (
    <label style={{ display: "grid", gap: "0.45rem", color: "#50463c", fontWeight: 500, ...(wrapped ? {} : style) }}>
      <span>
        {label}
        {hint && <InfoTipIcon />}
      </span>
      {children}
      {error && (
        <span role="alert" style={{ color: colors.danger, fontWeight: 500, fontSize: "0.84rem" }}>
          {error}
        </span>
      )}
    </label>
  );

  if (!wrapped) return field;
  return (
    <div className="field-with-tip" style={{ display: "grid", ...style }}>
      {field}
      {hint && <TipText>{hint}</TipText>}
    </div>
  );
}

export default Field;
