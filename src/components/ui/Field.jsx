// Labelled form field with optional hint and inline validation message.
//
// Supersedes components/common/Field.jsx and the local copies that
// InventoryPage, SchedulingPage and UserAccountsPage each redefined with
// their own paddings and label weights. `required` renders the marker the
// old copies left every form to draw by hand.
//
// It renders a <label> wrapping its control, so clicking the text focuses
// the input without needing a matching id. A `hint` is a tooltip: an ⓘ in
// the label, with the text kept outside the label so it doesn't become part
// of the field's name.

import { neutral, status, text, weight } from "../../styles/tokens";
import { InfoTipIcon, TipText } from "./InfoTip";

function Field({ label, error, hint: helpText, required = false, children, style, ...rest }) {
  // An error takes the place of the help text, as it always has. The layout
  // stays the same either way, so the input never remounts and loses focus.
  const wrapped = Boolean(helpText);
  const hint = error ? null : helpText;
  const field = (
    <label style={{ display: "grid", gap: "6px", ...(wrapped ? {} : style) }} {...rest}>
      <span
        style={{
          color: neutral.ink,
          fontWeight: weight.medium,
          fontSize: text.small.fontSize,
        }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: status.danger, marginLeft: "3px" }}>
            *
          </span>
        )}
        {hint && <InfoTipIcon />}
      </span>

      {children}

      {error && (
        <span
          role="alert"
          style={{
            color: status.danger,
            fontWeight: weight.medium,
            fontSize: text.caption.fontSize,
          }}
        >
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
