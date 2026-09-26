import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TechnicianDashboard from "../TechnicianDashboard";

const mockNavigate = jest.fn();
const mockStartVisit = jest.fn();
const mockShowError = jest.fn();
const mockState = { appointments: [] };

jest.mock("react-router-dom", () => ({ ...jest.requireActual("react-router-dom"), useNavigate: () => mockNavigate }));
jest.mock("../../../hooks/useAuth", () => ({ __esModule: true, default: () => ({ currentUser: { id: "jun", name: "Jun Dela Cruz", role: "TECHNICIAN" } }) }));
jest.mock("../../../hooks/useClients", () => ({
  __esModule: true,
  default: () => ({
    clients: [
      { id: "c1", name: "Manila Port Terminal 3", address: "Gate 4, Pier 3 Rd, Tondo", phone: "0917 800 1000", serviceNotes: "Sign in at guard house; hard hat required." },
      { id: "c2", name: "Mendoza Poultry Farm", address: "Bulacan" },
      { id: "c3", name: "Jollibee Katipunan", address: "QC" },
    ],
  }),
}));
jest.mock("../../../hooks/useUsers", () => ({ __esModule: true, default: () => ({ users: [{ id: "jun", name: "Jun Dela Cruz" }, { id: "paolo", name: "Paolo Garcia" }] }) }));
jest.mock("../../../hooks/useNow", () => ({ __esModule: true, default: () => new Date() }));
jest.mock("../../../hooks/useInventory", () => ({
  __esModule: true,
  default: () => ({
    movements: [{ id: "co", itemId: "i1", amount: 2, movementType: "OUT", stockOutReason: "TECHNICIAN_CHECKOUT", technicianId: "jun", movementDate: "2026-01-01", itemName: "Termidor SC", itemUnit: "L" }],
  }),
}));
jest.mock("../../../context/SchedulingContext", () => ({
  useScheduling: () => ({ appointments: mockState.appointments, loading: false, error: "", startVisit: mockStartVisit }),
}));
jest.mock("../../../context/ToastContext", () => ({ useToast: () => ({ showError: mockShowError, showSuccess: jest.fn() }) }));

const today = (hour, minute = 0) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const visit = (id, clientId, scheduledAt, extra = {}) => ({
  id,
  clientId,
  scheduledAt,
  durationMinutes: 60,
  status: "Confirmed",
  technicianId: "jun",
  technicianIds: ["jun"],
  reportSubmitted: false,
  pestConcern: "Rodents",
  serviceType: "General Pest Control",
  ...extra,
});

function renderDay(appointments) {
  mockState.appointments = appointments;
  mockNavigate.mockClear();
  mockStartVisit.mockReset();
  return render(
    <MemoryRouter>
      <TechnicianDashboard />
    </MemoryRouter>
  );
}

describe("TechnicianDashboard — Your day", () => {
  // Late in the day, so every fixture visit is "today" whatever time the suite runs.
  const appointments = [
    visit("done", "c3", today(0, 5), { status: "Completed", reportSubmitted: true }),
    visit("port", "c1", today(23, 0)),
    visit("farm", "c2", today(23, 30), { technicianIds: ["jun", "paolo"] }),
  ];

  it("greets by first name and counts the day", () => {
    renderDay(appointments);
    expect(screen.getByRole("heading", { level: 1, name: "Your day, Jun" })).toBeInTheDocument();
    expect(screen.getByText(/1 done · 2 to go · about 2 h of work/)).toBeInTheDocument();
  });

  it("shows the next visit with its site note, Directions and Call site", () => {
    renderDay(appointments);
    const card = screen.getByRole("region", { name: "Up next" });
    expect(within(card).getByRole("heading", { name: "Manila Port Terminal 3" })).toBeInTheDocument();
    expect(within(card).getByText(/hard hat required/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Directions/ }).getAttribute("href")).toMatch(/google\.com\/maps/);
    expect(within(card).getByRole("link", { name: /Call site/ })).toHaveAttribute("href", "tel:09178001000");
  });

  it("starts the visit and opens it", async () => {
    renderDay(appointments);
    mockStartVisit.mockResolvedValue(true);

    await userEvent.click(screen.getByRole("button", { name: /Start visit/ }));

    expect(mockStartVisit).toHaveBeenCalledWith("port");
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/visit/port"));
  });

  it("says why a visit could not be started", async () => {
    renderDay(appointments);
    mockStartVisit.mockResolvedValue("A visit can only be started on its scheduled day.");

    await userEvent.click(screen.getByRole("button", { name: /Start visit/ }));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith("A visit can only be started on its scheduled day."));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("offers Continue for a visit already under way", () => {
    renderDay([visit("port", "c1", today(23, 0), { status: "In progress", startedAt: today(22) })]);
    expect(screen.getByRole("button", { name: /Continue visit/ })).toBeInTheDocument();
  });

  it("lists later visits with the crew, and marks where Jun leads", () => {
    renderDay(appointments);
    const farm = screen.getByText("Mendoza Poultry Farm").closest("a");
    expect(farm).toHaveTextContent("with Paolo Garcia");
    expect(within(farm).getByText("Lead")).toBeInTheDocument();
  });

  it("shows the day as points: one done, the next one current", () => {
    renderDay(appointments);
    const timeline = screen.getByRole("list", { name: "1 of 3 visits done" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(3);
  });

  it("adds the week, the stock they carry, and their time off", () => {
    renderDay(appointments);
    expect(screen.getByRole("region", { name: "This week" })).toHaveTextContent("No more visits booked this week.");
    expect(screen.getByRole("region", { name: "Stock you're carrying" })).toHaveTextContent("Termidor SC2 L");
    expect(screen.getByRole("region", { name: "Time off" })).toHaveTextContent("None coming up.");
  });

  it("nudges for a signature on a finished visit that has none", () => {
    renderDay(appointments);
    const done = screen.getByText("Jollibee Katipunan").closest("a");
    expect(within(done).getByText("Sign")).toBeInTheDocument();
    expect(done).toHaveAttribute("href", "/visit/done?step=Sign");
  });
});
