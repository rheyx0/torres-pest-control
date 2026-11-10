// A button that opens a short list of less-used actions.
//
// Two looks: the "…" icon (row actions, the client profile header), or a
// labelled "More ▾" button (billing windows, where the footer would otherwise
// hold seven buttons). The list floats above the whole page (rendered into
// document.body at the button's screen position), so a table or window that
// scrolls or clips its contents never cuts it off. It opens below the button,
// or above when there is no room below (`placement="up"` always opens above).
// Closes on Escape, on a click outside, on scrolling the page, and after a
// choice.
//
// items: [{ label, onClick, icon?, danger?, color?, separated?, disabled? }]

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import Button from "./Button";
import { neutral, radius, status as semantic, surface } from "../../styles/tokens";
import { colors } from "../../styles/theme";

const GAP = 6;
const EDGE = 8;

function MoreMenu({ items, label = null, placement = "down", ariaLabel = "More actions" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // A page scroll's target is the window, which is not a node.
    const inside = (target) =>
      target instanceof Node && ((ref.current && ref.current.contains(target)) || (menuRef.current && menuRef.current.contains(target)));
    const onPointer = (event) => {
      if (!inside(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = (event) => {
      if (!inside(event.target)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Place the list next to the button once it is drawn and its height is known.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const button = ref.current.getBoundingClientRect();
    const height = menuRef.current ? menuRef.current.offsetHeight : 0;
    const viewport = window.innerHeight;
    const roomBelow = viewport - button.bottom - GAP - EDGE;
    const roomAbove = button.top - GAP - EDGE;
    const up = placement === "up" ? roomAbove >= height || roomAbove > roomBelow : roomBelow < height && roomAbove > roomBelow;
    const right = Math.max(EDGE, window.innerWidth - button.right);
    setPosition(up ? { bottom: viewport - button.top + GAP, right } : { top: button.bottom + GAP, right });
  }, [open, placement]);

  const toggle = () => {
    setPosition(null);
    setOpen((value) => !value);
  };

  const shown = (items || []).filter(Boolean);
  if (shown.length === 0) return null;

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            ...(position || { top: 0, right: 0 }),
            visibility: position ? "visible" : "hidden",
            maxHeight: `calc(100vh - ${EDGE * 2}px)`,
            overflowY: "auto",
            zIndex: 10000,
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
              onClick={(event) => {
                event.stopPropagation();
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
                color: item.color || (item.danger ? semantic.danger : neutral.ink),
                borderTop: item.separated ? `1px solid ${colors.line}` : undefined,
                marginTop: item.separated ? "4px" : 0,
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }} onClick={(event) => event.stopPropagation()}>
      {label ? (
        <Button aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          {label} <ChevronDown size={14} aria-hidden="true" style={{ marginLeft: "2px" }} />
        </Button>
      ) : (
        <Button variant="quiet" size="icon" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <MoreHorizontal size={16} />
        </Button>
      )}
      {menu}
    </div>
  );
}

export default MoreMenu;
