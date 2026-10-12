// Chemical / Non-chemical (Sprint 5), one small pill wherever a service, a
// visit or a client shows it. Chemical is amber (keep away, protective gear),
// Non-chemical green.

import { categoryLabel } from "../../utils/categories";

const TONES = {
  CHEMICAL: { background: "#fdf1dc", color: "#8a5a12", border: "#f1d8a8" },
  NON_CHEMICAL: { background: "#e8f4ec", color: "#2f6b3f", border: "#c7e3d0" },
};

function CategoryBadge({ category, style }) {
  if (!category || !TONES[category]) return null;
  const tone = TONES[category];
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", fontSize: "0.68rem", fontWeight: 500, lineHeight: 1.4, padding: "0.1rem 0.5rem", borderRadius: "999px", whiteSpace: "nowrap", background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, ...style }}
    >
      {categoryLabel(category)}
    </span>
  );
}

export default CategoryBadge;
