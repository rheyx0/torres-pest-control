// A button that opens a short list of less-used actions.
//
// Two looks: the "…" icon (the client profile header), or a labelled
// "More ▾" button (billing windows, where the footer would otherwise hold
// seven buttons). `placement="up"` opens above, for footers at the bottom of
// a window. Closes on Escape, on a click outside, and after a choice.
//
// items: [{ label, onClick, icon?, danger?, separated?, disabled? }]

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import Button from "./Button";
import { neutral, radius, status as semantic, surface } from "../../styles/tokens";
import { colors } from "../../styles/theme";

function MoreMenu({ items, label = null, placement = "down", ariaLabel = "More actions" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const shown = (items || []).filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {label ? (
        <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {label} <ChevronDown size={14} aria-hidden="true" style={{ marginLeft: "2px" }} />
        </Button>
      ) : (
        <Button variant="quiet" size="icon" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <MoreHorizontal size={16} />
        </Button>
      )}
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            ...(placement === "up" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
            zIndex: 30,
            minWidth: "200px",
            background: surface.panel,
            border: `1px solid ${neutral.loam}`,
            borderRadius: radius.card,
            boxShadow: "0 8px 24px rgba(40, 24, 10, 0.12)",
            padding: "4px",
          }}
        >
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="ui-interactive"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                textAlign: "left",
                border: 0,
                background: "transparent",
                borderRadius: radius.control,
                padding: "8px 10px",
                fontSize: "13px",
                whiteSpace: "nowrap",
                cursor: item.disabled ? "default" : "pointer",
                opacity: item.disabled ? 0.5 : 1,
                color: item.danger ? semantic.danger : neutral.ink,
                borderTop: item.separated ? `1px solid ${colors.line}` : undefined,
                marginTop: item.separated ? "4px" : 0,
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MoreMenu;
