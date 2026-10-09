// "Are you sure?" for every important action, in one place.
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: "Void invoice?", message: "…", confirmLabel: "Void", tone: "danger" }))) return;
//
// One dialog for the whole app, drawn above every other window (it is put
// straight on <body> with its own layer, so it shows over a detail window
// that asked for it). Outside the provider (unit tests that render one
// component) confirm() answers yes at once, so a component works the same
// with or without it.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import { neutral, status, text } from "../styles/tokens";

const ConfirmContext = createContext(null);
const ALWAYS_YES = async () => true;

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    // A second request while one is open answers the first "no".
    if (resolver.current) resolver.current(false);
    resolver.current = resolve;
    setRequest(options);
  }), []);

  const answer = (value) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    if (resolve) resolve(value);
  };

  const value = useMemo(() => confirm, [confirm]);
  const danger = request?.tone === "danger";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && createPortal(
        <div style={{ position: "relative", zIndex: 2000 }}>
          <Modal
            open
            title={request.title || "Are you sure?"}
            size="sm"
            onClose={() => answer(false)}
            footer={(
              <>
                <Button onClick={() => answer(false)}>{request.cancelLabel || "Cancel"}</Button>
                <Button variant={danger ? "danger" : "primary"} onClick={() => answer(true)} autoFocus>
                  {request.confirmLabel || "Confirm"}
                </Button>
              </>
            )}
          >
            {(request.message || request.details?.length || danger) ? (
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              {danger && <AlertTriangle size={18} aria-hidden="true" style={{ color: status.danger, flex: "none", marginTop: "2px" }} />}
              <div style={{ display: "grid", gap: "8px", color: neutral.saddle, ...text.body }}>
                {request.message && <p style={{ margin: 0 }}>{request.message}</p>}
                {request.details && (
                  <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", ...text.small }}>
                    {request.details.filter(Boolean).map(([label, detail]) => (
                      <div key={label} style={{ display: "contents" }}>
                        <dt style={{ color: neutral.bark }}>{label}</dt>
                        <dd style={{ margin: 0, color: neutral.ink }}>{detail}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
            ) : null}
          </Modal>
        </div>,
        document.body
      )}
    </ConfirmContext.Provider>
  );
}

/** confirm(options) → Promise<boolean>. Yes at once outside the provider. */
export function useConfirm() {
  return useContext(ConfirmContext) || ALWAYS_YES;
}
