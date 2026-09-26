import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuthContext } from "../AuthContext";
import { BillingProvider, useBillingContext } from "../BillingContext";

jest.mock("../../services/authService", () => ({
  loadSession: () => ({ token: "t", id: "u1", role: "ADMIN" }),
  saveSession: () => {},
  validateSession: () => Promise.resolve({ profile: { id: "u1", role: "ADMIN", name: "Admin" } }),
}));
jest.mock("../../services/userService", () => ({
  fetchAllAccounts: () => Promise.resolve({ admins: [{ id: "u1", role: "ADMIN", name: "Admin" }], staff: [], technicians: [] }),
}));
jest.mock("../../services/logService", () => ({ addLog: jest.fn(), LOG_TYPES: {} }));

const empty = () => {
  const chain = { select: () => chain, order: () => Promise.resolve({ data: [], error: null }) };
  return chain;
};
jest.mock("../../services/supabaseClient", () => ({ supabase: { from: () => empty(), rpc: jest.fn() }, setSupabaseSessionToken: () => {} }));

function Probe() {
  const { sessionVerified, currentUser } = useAuthContext();
  const { loading } = useBillingContext();
  return <p>{`verified=${sessionVerified} user=${currentUser?.role} loading=${loading}`}</p>;
}

// Regression: verifying the session merges the profile into it, which used to
// reset sessionVerified to false for good and left billing on "Loading…".
test("billing finishes loading after the real session sequence", async () => {
  render(<AuthProvider><BillingProvider><Probe /></BillingProvider></AuthProvider>);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(screen.getByText(/verified/).textContent).toBe("verified=true user=ADMIN loading=false");
});
