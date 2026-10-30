// A section the user can fold away: a header row (chevron, title, and a
// one-line summary while it is closed) over content that shows only when it
// is open. Used where a page shows more than most visits need, so the parts
// read less often start closed and the page stays scannable.
//
// With `storageKey` each viewer's choice is remembered in this browser
// (localStorage, best effort: it works without it). The header is a real
// button with aria-expanded / aria-controls, so it works from the keyboard
// and is announced as expandable.

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { neutral, radius, surface, weight } from "../../styles/tokens";
import { colors } from "../../styles/theme";

const PREFIX = "torres_collapse:";

function readStored(key, fallback) {
  if (!key) return fallback;
  try {
    const value = window.localStorage.getItem(PREFIX + key);
    return value === null ? fallback : value === "open";
  } catch {
    return fallback;
  }
}

function writeStored(key, open) {
  if (!key) return;
  try {
    window.localStorage.setItem(PREFIX + key, open ? "open" : "closed");
  } catch {
    // Private window or blocked storage: the choice just isn't remembered.
  }
}

/** Open/closed state for a collapsible part, remembered under `storageKey`. */
export function useCollapsible(storageKey, defaultOpen = false) {
  const [open, setOpen] = useState(() => readStored(storageKey, defaultOpen));
  const toggle = () => setOpen((current) => {
    writeStored(storageKey, !current);
    return !current;
  });
  return [open, toggle];
}

/**
 * @param title        what the section holds ("This week and billing")
 * @param summary      one line shown while closed ("₱12,000 to collect · 2 overdue")
 * @param storageKey   remembers the choice per browser; omit to forget on reload
 * @param defaultOpen  open the first time (default: closed)
 * @param variant      "card" (its own bordered box) or "plain" (a header line only)
 */
function Collapsible({ title, summary = "", storageKey, defaultOpen = false, variant = "card", children, style }) {
  const [open, toggle] = useCollapsible(storageKey, defaultOpen);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  const boxed = variant === "card";

  return (
    <section
      style={{
        ...(boxed ? { border: `1px solid ${colors.line}`, borderRadius: "7.5px", background: surface.panel } : null),
        minWidth: 0,
        ...style,
      }}
    >
      <button
        type="button"
        className="ui-interactive"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: boxed ? "11px 16px" : "6px 0",
          border: 0,
          borderRadius: radius.control,
          background: "transparent",
          font: "inherit",
          textAlign: "left",
          color: neutral.ink,
          cursor: "pointer",
        }}
      >
        <Chevron size={16} aria-hidden="true" style={{ color: neutral.saddle, flexShrink: 0 }} />
        <span style={{ fontWeight: weight.medium }}>{title}</span>
        {!open && summary && (
          <span style={{ color: neutral.bark, fontSize: "12.5px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {summary}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: neutral.saddle, fontSize: "12.5px", flexShrink: 0 }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div id={bodyId} style={boxed ? { padding: "0 16px 16px" } : { paddingTop: "6px" }}>
          {children}
        </div>
      )}
    </section>
  );
}

export default Collapsible;
