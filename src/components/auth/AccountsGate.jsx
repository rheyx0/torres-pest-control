// Holds a route until the account tables have loaded.
//
// currentUser is resolved by matching the stored session id against the
// fetched accounts, so pages must not render before that fetch settles —
// otherwise every page briefly sees currentUser === null.
//
// This was the accountsLoading / accountsError ternary in the old App.js.

import useAuth from "../../hooks/useAuth";
import { colors } from "../../styles/theme";

function CenteredMessage({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
        color: "#374151",
      }}
    >
      {children}
    </div>
  );
}

function AccountsGate({ children }) {
  const { loading, error, currentUser, logout } = useAuth();

  if (error) {
    return (
      <CenteredMessage>
        <div style={{ fontWeight: 700 }}>Could not load accounts.</div>
        <div
          style={{
            fontSize: "0.85rem",
            color: colors.danger,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            padding: "0.75rem 1rem",
            maxWidth: "560px",
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={logout}
          style={{
            border: "none",
            borderRadius: "12px",
            background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandLight} 100%)`,
            color: "#fff",
            padding: "0.75rem 1.2rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Log Out
        </button>
      </CenteredMessage>
    );
  }

  if (loading || !currentUser) {
    return (
      <CenteredMessage>
        <div style={{ color: colors.muted, fontWeight: 600 }}>Loading your account…</div>
      </CenteredMessage>
    );
  }

  return children;
}

export default AccountsGate;
