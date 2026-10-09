// The app's only modal shell.
//
// There were five hand-rolled versions of this — four in SchedulingPage and
// one inside ConfirmDialog — each re-deciding its own overlay colour, width,
// z-index and close button, and none of them trapping focus, closing on
// Escape, or locking the page behind them. One of them (the follow-up form)
// even sat at a lower z-index than the panel that opened it, so it rendered
// behind and was unreachable.
//
// Sizes are named rather than passed as widths so a 460px form and an 880px
// form cannot drift apart again.

import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { neutral, radius, shadow, surface, weight } from "../../styles/tokens";
import { card, eyebrow as eyebrowStyle, subheading } from "../../styles/theme";
import Button from "./Button";

const SIZES = {
  sm: "min(100%, 420px)",
  md: "min(100%, 560px)",
  lg: "min(100%, 720px)",
  xl: "min(100%, 880px)",
};

/** Everything focusable inside the dialog, in document order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({
  open = true,
  onClose,
  title,
  eyebrow,
  size = "md",
  footer = null,
  closeLabel = "Close dialog",
  initialFocusRef = null,
  children,
  ...rest
}) {
  const panelRef = useRef(null);
  // The body, queried separately for initial focus: the close button comes
  // first in document order, so focusing the panel's first focusable would
  // land the user on the X instead of on the first real field.
  const bodyRef = useRef(null);
  // Where focus was before the dialog opened, so it can be handed back.
  const restoreFocusRef = useRef(null);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      // Keep Tab inside the dialog. Without this, tabbing walks out into the
      // page behind the overlay, where nothing is visible to click.
      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusRef.current = document.activeElement;

    // Stop the page scrolling behind the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const target =
      initialFocusRef?.current ||
      bodyRef.current?.querySelector(FOCUSABLE) ||
      panelRef.current?.querySelector(FOCUSABLE) ||
      panelRef.current;
    target?.focus?.();

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop closes the
        // dialog — otherwise releasing a text selection outside the panel
        // would discard a half-filled form.
        if (event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "rgba(33, 27, 21, 0.45)",
        overflowY: "auto",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          ...card,
          width: SIZES[size] || SIZES.md,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          // The one place a shadow is allowed: a dialog genuinely floats.
          boxShadow: shadow.overlay,
          outline: "none",
        }}
        {...rest}
      >
        {(title || onClose) && (
          <header
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "15px",
              padding: "20px 24px 15px",
              borderBottom: `1px solid ${surface.sunken}`,
            }}
          >
            <div>
              {eyebrow && <p style={eyebrowStyle}>{eyebrow}</p>}
              {title && <h2 style={{ ...subheading, marginTop: eyebrow ? "2px" : 0 }}>{title}</h2>}
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label={closeLabel}
                style={{ color: neutral.bark, marginTop: "-2px" }}
              >
                <X size={18} />
              </Button>
            )}
          </header>
        )}

        {children != null && children !== false && (
          <div ref={bodyRef} style={{ padding: "20px 24px", overflowY: "auto", flex: "1 1 auto" }}>
            {children}
          </div>
        )}

        {footer && (
          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
              padding: "15px 24px",
              borderTop: `1px solid ${surface.sunken}`,
              background: surface.panel,
              borderRadius: `0 0 ${radius.card} ${radius.card}`,
              fontWeight: weight.regular,
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export default Modal;
