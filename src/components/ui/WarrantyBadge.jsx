// The shield on a warranty visit (checkup or re-treatment), or on a job that
// carries a running warranty. One look tells the office and the technician
// the visit is free and belongs to a warranty.

import { ShieldCheck } from "lucide-react";

function WarrantyBadge({ label, title, style }) {
  if (!label) return null;
  return (
    <span
      title={title || undefined}
      style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.7rem", fontWeight: 600, lineHeight: 1.4, padding: "0.12rem 0.55rem", borderRadius: "999px", whiteSpace: "nowrap", background: "#e8f1fb", color: "#1d4f8a", border: "1px solid #bcd4ef", ...style }}
    >
      <ShieldCheck size={12} aria-hidden="true" /> {label}
    </span>
  );
}

export default WarrantyBadge;
