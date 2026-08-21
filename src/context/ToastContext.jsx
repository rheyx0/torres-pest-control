// App-wide confirmation / error messages.
//
// Two sprint ACs ask for this explicitly:
//   - Create User Account: "Confirmation message is shown once account is
//     successfully created."
//   - Change / Reset Password: "Confirmation is shown once password is
//     successfully updated."
//
// Previously account creation just navigated away silently, so there was no
// mechanism for either. Toasts live above the router so a message survives
// the navigation that follows the action which triggered it.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Toast from "../components/common/Toast";

const ToastContext = createContext(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = "success") => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((previous) => [...previous, { id, message, tone }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toasts,
      dismiss,
      showSuccess: (message) => push(message, "success"),
      showError: (message) => push(message, "error"),
      showInfo: (message) => push(message, "info"),
    }),
    [toasts, dismiss, push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: "fixed",
          top: "1.25rem",
          right: "1.25rem",
          display: "grid",
          gap: "0.6rem",
          zIndex: 1000,
          maxWidth: "min(380px, calc(100vw - 2.5rem))",
        }}
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}

export default ToastContext;
