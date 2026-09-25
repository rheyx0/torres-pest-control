import { fetchAppointments, startVisit, submitReport } from "../appointmentService";
import { supabase } from "../supabaseClient";

jest.mock("../supabaseClient", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

// A chainable stand-in for the PostgREST query builder that resolves to `result`.
function query(result) {
  const chain = {};
  ["select", "order", "eq", "not"].forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });
  chain.then = (resolve) => resolve(result);
  return chain;
}

describe("fetchAppointments", () => {
  it("still loads the schedule before migration 048 adds started_at", async () => {
    const row = { id: "a1", client_id: "c1", scheduled_at: "2026-09-25T09:00:00Z", status: "Confirmed", technician_id: null };
    const selects = [];
    supabase.from.mockImplementation((table) => {
      if (table === "appointments") {
        const attempt = selects.length;
        const chain = query(
          attempt === 0
            ? { data: null, error: { message: 'column appointments.started_at does not exist', code: "42703" } }
            : { data: [row], error: null }
        );
        chain.select = jest.fn((columns) => {
          selects.push(columns);
          return chain;
        });
        return chain;
      }
      return query({ data: [], error: null });
    });

    const result = await fetchAppointments();

    expect(result.error).toBeNull();
    expect(result.appointments.map((entry) => entry.id)).toEqual(["a1"]);
    expect(selects[0]).toMatch(/started_at/);
    expect(selects[1]).not.toMatch(/started_at/);
  });

  it("drops each missing column in turn on a database older than 048 and 050", async () => {
    const row = { id: "a1", client_id: "c1", scheduled_at: "2026-09-25T09:00:00Z", status: "Confirmed", technician_id: null };
    const missing = ["reference", "started_at"];
    const selects = [];
    supabase.from.mockImplementation((table) => {
      if (table === "appointments") {
        const chain = query(null);
        chain.select = jest.fn((columns) => {
          selects.push(columns);
          const absent = missing.find((column) => columns.includes(column));
          chain.then = (resolve) => resolve(absent
            ? { data: null, error: { message: `column appointments.${absent} does not exist`, code: "42703" } }
            : { data: [row], error: null });
          return chain;
        });
        return chain;
      }
      return query({ data: [], error: null });
    });

    const result = await fetchAppointments();

    expect(result.error).toBeNull();
    expect(result.appointments[0]).toMatchObject({ id: "a1", reference: "" });
    expect(selects).toHaveLength(3);
    expect(selects[2]).not.toMatch(/reference|started_at/);
  });
});

describe("submitReport", () => {
  it("sends the services only when some are ticked", async () => {
    supabase.rpc.mockResolvedValue({ data: { appointment_id: "a1" }, error: null });

    await submitReport("a1", { findings: "Droppings", treatmentPerformed: "" });
    expect(supabase.rpc.mock.calls.at(-1)[1]).not.toHaveProperty("p_service_ids");

    await submitReport("a1", { findings: "Droppings", treatmentPerformed: "", serviceIds: ["s2", "s1"] });
    expect(supabase.rpc.mock.calls.at(-1)[1]).toMatchObject({ p_service_ids: ["s2", "s1"] });
  });
});

describe("fetchAppointments services (migration 051)", () => {
  const row = { id: "a1", client_id: "c1", scheduled_at: "2026-09-25T09:00:00Z", status: "Confirmed", technician_id: null, service_id: "s1" };
  const mockTables = (servicesResult) => supabase.from.mockImplementation((table) => {
    if (table === "appointments") return query({ data: [row], error: null });
    if (table === "appointment_services") return query(servicesResult);
    return query({ data: [], error: null });
  });

  it("reads every service on a visit, in order", async () => {
    mockTables({ data: [{ appointment_id: "a1", position: 1, service_id: "s1" }, { appointment_id: "a1", position: 0, service_id: "s3" }], error: null });
    expect((await fetchAppointments()).appointments[0].serviceIds).toEqual(["s3", "s1"]);
  });

  it("falls back to the single service before 051 creates the table", async () => {
    mockTables({ data: null, error: { message: 'relation "public.appointment_services" does not exist', code: "42P01" } });
    const result = await fetchAppointments();
    expect(result.error).toBeNull();
    expect(result.appointments[0].serviceIds).toEqual(["s1"]);
  });
});

describe("startVisit", () => {
  it("returns the new status and start time", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "In progress", started_at: "2026-09-25T02:04:00Z" }, error: null });

    expect(await startVisit("a1")).toEqual({ status: "In progress", startedAt: "2026-09-25T02:04:00Z" });
    expect(supabase.rpc).toHaveBeenCalledWith("start_visit", { p_appointment_id: "a1" });
  });

  it("passes the server's refusal through", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "A visit can only be started on its scheduled day." } });

    expect((await startVisit("a1")).error).toMatch(/scheduled day/);
  });
});
