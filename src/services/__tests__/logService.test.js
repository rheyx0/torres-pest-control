// The system activity log in the database (migration 059).

import { addLog, fetchLogs, LOG_TYPES, subscribe } from "../logService";

const mockRpc = jest.fn();
const mockSelect = jest.fn();

jest.mock("../supabaseClient", () => ({
  get supabase() {
    return {
      rpc: (...args) => mockRpc(...args),
      from: () => ({ select: () => ({ order: () => ({ limit: () => mockSelect() }) }) }),
    };
  },
}));

beforeEach(() => {
  localStorage.clear();
  mockRpc.mockReset();
  mockSelect.mockReset();
});

describe("addLog", () => {
  it("records through the server, which decides who the actor is", async () => {
    mockRpc.mockResolvedValue({ data: "id", error: null });
    await expect(addLog("Anyone At All", "Updated account for Juan.", LOG_TYPES.ADMIN)).resolves.toBe(true);
    // The display name is not sent: the server takes the actor from the session.
    expect(mockRpc).toHaveBeenCalledWith("add_system_log", { p_type: "admin", p_message: "Updated account for Juan.", p_session_token: null });
  });

  it("passes the session token for the login entry", async () => {
    mockRpc.mockResolvedValue({ data: "id", error: null });
    await addLog("Juan", "Logged in.", LOG_TYPES.AUTH, { token: "tok-1" });
    expect(mockRpc).toHaveBeenCalledWith("add_system_log", expect.objectContaining({ p_session_token: "tok-1" }));
  });

  it("tells subscribers so an open log reloads", async () => {
    mockRpc.mockResolvedValue({ data: "id", error: null });
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);
    await addLog("Juan", "Logged in.", LOG_TYPES.AUTH);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("falls back to this browser before migration 059", async () => {
    mockRpc.mockResolvedValue({ error: { message: "Could not find the function public.add_system_log in the schema cache" } });
    await addLog("Juan", "Logged in.", LOG_TYPES.AUTH);
    expect(JSON.parse(localStorage.getItem("torres_logs"))[0]).toMatchObject({ actor: "Juan", message: "Logged in." });
  });

  it("never throws, even when the request fails outright", async () => {
    mockRpc.mockRejectedValue(new Error("network down"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(addLog("Juan", "Logged in.", LOG_TYPES.AUTH)).resolves.toBe(false);
    warn.mockRestore();
  });
});

describe("fetchLogs", () => {
  it("reads the shared log, newest first as the server returns it", async () => {
    mockSelect.mockResolvedValue({
      data: [{ id: "1", actor_name: "Ana Cruz", actor_role: "ADMIN", type: "admin", message: "Deactivated Juan.", created_at: "2026-09-26T08:00:00Z" }],
      error: null,
    });
    await expect(fetchLogs()).resolves.toEqual({
      logs: [{ id: "1", actor: "Ana Cruz", actorRole: "ADMIN", message: "Deactivated Juan.", timestamp: "2026-09-26T08:00:00Z", type: "admin" }],
      error: null,
      shared: true,
    });
  });

  it("reads this browser's entries before migration 059", async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'relation "public.system_logs" does not exist' } });
    const result = await fetchLogs();
    expect(result).toMatchObject({ shared: false, error: null });
  });
});
