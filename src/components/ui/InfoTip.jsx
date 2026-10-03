// Help text as a tooltip: an ⓘ beside a label that shows the text on hover
// or keyboard focus, in place of a line of grey text under every field.
//
//   <InfoTip text="…" />            standalone (beside a heading, a checkbox)
//   <InfoTipIcon /> + <TipText>     inside a Field: the icon sits in the label,
//                                   the text outside it, so the label still
//                                   names its field ("Phone", not "Phone 11
//                                   digits…"). globals.css shows it on hover.

import { useId } from "react";
import { Info } from "lucide-react";

export function InfoTipIcon() {
  return (
    <span className="info-tip" aria-hidden="true">
      <Info size={13} />
    </span>
  );
}

export function TipText({ children }) {
  return <span role="tooltip" className="info-tip-text field-tip">{children}</span>;
}

function InfoTip({ text, label = "More information" }) {
  const id = useId();
  if (!text) return null;
  return (
    <span className="info-tip" tabIndex={0} role="img" aria-label={label} aria-describedby={id}>
      <Info size={13} aria-hidden="true" />
      <span role="tooltip" id={id} className="info-tip-text">{text}</span>
    </span>
  );
}

export default InfoTip;
