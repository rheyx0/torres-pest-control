import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VisitPage from "../VisitPage";

const mockNavigate = jest.fn();
const mockSubmitReport = jest.fn();
const mockStockOutMany = jest.fn();
const mockAddStockUsed = jest.fn();
const mockShowError = jest.fn();
const mockShowSuccess = jest.fn();
const mockFinishJobDay = jest.fn();
const mockFinishJobHere = jest.fn();
const mockState = { appointment: null, others: [], role: "TECHNICIAN" };

jest.mock("react-router-dom", () => ({ ...jest.requireActual("react-router-dom"), useNavigate: () => mockNavigate }));
jest.mock("../../hooks/useAuth", () => ({ __esModule: true, default: () => ({ currentUser: { id: "jun", role: mockState.role } }) }));
jest.mock("../../hooks/useClients", () => ({ __esModule: true, default: () => ({ clients: [{ id: "c1", name: "Manila Port Terminal 3" }] }) }));
jest.mock("../../hooks/useNow", () => ({ __esModule: true, default: () => new Date() }));
jest.mock("../../hooks/useInventory", () => ({
  __esModule: true,
  default: () => ({
    inventory: [
      { id: "blox", name: "Contrac Blox", unit: "kg", quantity: 12, status: "ACTIVE" },
      { id: "station", name: "Bait Station", unit: "pc", quantity: 140, status: "ACTIVE" },
    ],
    stockOutMany: mockStockOutMany,
  }),
}));
jest.mock("../../hooks/useServices", () => {
  const services = [
    { id: "s1", name: "Rodent Control", isActive: true, materials: [{ itemId: "blox", defaultAmount: 0.5 }, { itemId: "station", defaultAmount: 6 }] },
    { id: "s2", name: "Termite Treatment", isActive: true, materials: [{ itemId: "station", defaultAmount: 2 }] },
  ];
  return {
    __esModule: true,
    default: () => ({
      activeServices: services,
      serviceById: (id) => services.find((service) => service.id === id) || null,
      serviceByName: () => null,
    }),
  };
});
jest.mock("../../context/SchedulingContext", () => ({
  useScheduling: () => ({
    appointments: mockState.appointment ? [mockState.appointment, ...mockState.others] : [],
    planActions: { finishJobDay: mockFinishJobDay, finishJobHere: mockFinishJobHere },
    loading: false,
    startVisit: jest.fn(),
    submitReport: mockSubmitReport,
    uploadSignature: jest.fn(),
    addAttachment: jest.fn(),
    removeAttachment: jest.fn(async () => true),
    addStockUsed: mockAddStockUsed,
  }),
}));
jest.mock("../../context/ToastContext", () => ({ useToast: () => ({ showError: mockShowError, showSuccess: mockShowSuccess }) }));

const visit = {
  id: "a1",
  clientId: "c1",
  scheduledAt: new Date().toISOString(),
  durationMinutes: 60,
  status: "In progress",
  startedAt: new Date(Date.now() - 37 * 60000).toISOString(),
  technicianId: "jun",
  technicianIds: ["jun"],
  serviceId: "s1",
  reportSubmitted: false,
  attachments: [],
  stockUsed: [],
};

function renderVisit(appointment = visit, entry = "/visit/a1", others = []) {
  mockState.appointment = appointment;
  mockState.others = others;
  [mockNavigate, mockSubmitReport, mockStockOutMany, mockAddStockUsed, mockShowError, mockShowSuccess, mockFinishJobDay, mockFinishJobHere].forEach((fn) => fn.mockReset());
  localStorage.clear();
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/visit/:id" element={<VisitPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("VisitPage", () => {
  it("shows the client and how long the visit has been going", () => {
    renderVisit();
    expect(screen.getByRole("heading", { name: "Manila Port Terminal 3" })).toBeInTheDocument();
    expect(screen.getByText(/Visit started .* · 37 min/)).toBeInTheDocument();
  });

  it("walks the four steps and won't leave Findings empty", async () => {
    renderVisit();
    expect(screen.getByRole("button", { name: "Findings", current: "step" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Next: Treatment/ }));
    expect(mockShowError).toHaveBeenCalledWith("Write what you found before moving on.");

    await userEvent.type(screen.getByLabelText("Findings"), "Burrows along the seawall fence line");
    await userEvent.click(screen.getByRole("button", { name: /Next: Treatment/ }));
    expect(screen.getByRole("button", { name: "Rodent Control", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Termite Treatment", pressed: false })).toBeInTheDocument();
    expect(screen.queryByLabelText("Treatment notes")).not.toBeInTheDocument();
  });

  it("prefills materials from the service and steps them by the unit", async () => {
    renderVisit(visit, "/visit/a1?step=Treatment");
    expect(screen.getByText("0.5 kg")).toBeInTheDocument();
    expect(screen.getByText("6 pc")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "More Contrac Blox" }));
    await userEvent.click(screen.getByRole("button", { name: "Less Bait Station" }));
    expect(screen.getByText("0.6 kg")).toBeInTheDocument();
    expect(screen.getByText("5 pc")).toBeInTheDocument();
  });

  it("keeps what was typed on the phone", async () => {
    renderVisit();
    await userEvent.type(screen.getByLabelText("Findings"), "Gnaw marks");
    expect(screen.getByText("Saved on this phone")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("torres_visit_draft_a1")).findings).toBe("Gnaw marks");
  });

  it("sends the report, then records the materials, then goes back to the day", async () => {
    renderVisit(visit, "/visit/a1?step=Treatment");
    mockSubmitReport.mockResolvedValue({});
    mockStockOutMany.mockResolvedValue([]);

    await userEvent.click(screen.getByRole("button", { name: /^Findings/ }));
    await userEvent.type(screen.getByLabelText("Findings"), "Droppings by the loading bay");
    await userEvent.click(screen.getByRole("button", { name: /^Sign/ }));
    await userEvent.click(screen.getByRole("button", { name: /Send report/ }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
    expect(mockSubmitReport).toHaveBeenCalledWith("a1", expect.objectContaining({ findings: "Droppings by the loading bay" }));
    // The services were left as booked, so they are not re-sent.
    expect(mockSubmitReport.mock.calls[0][1]).not.toHaveProperty("serviceIds");
    expect(mockStockOutMany).toHaveBeenCalledWith("a1", [{ itemId: "blox", amount: 0.5, batchId: "" }, { itemId: "station", amount: 6, batchId: "" }], expect.any(String));
    expect(mockShowSuccess).toHaveBeenCalledWith("Report sent. The visit stays open until the customer signs.");
    expect(localStorage.getItem("torres_visit_draft_a1")).toBeNull();
  });

  it("ticks several services, merges their materials, and files them all", async () => {
    renderVisit(visit, "/visit/a1?step=Findings");
    mockSubmitReport.mockResolvedValue({});
    mockStockOutMany.mockResolvedValue([]);

    await userEvent.type(screen.getByLabelText("Findings"), "Mud tubes on the east wall");
    await userEvent.click(screen.getByRole("button", { name: /^Treatment/ }));
    await userEvent.click(screen.getByRole("button", { name: "Termite Treatment" }));
    // Both services' materials; the bait stations both use are summed (6 + 2).
    expect(screen.getByText("0.5 kg")).toBeInTheDocument();
    expect(screen.getByText("8 pc")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Sign/ }));
    await userEvent.click(screen.getByRole("button", { name: /Send report/ }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
    expect(mockSubmitReport).toHaveBeenCalledWith("a1", expect.objectContaining({ serviceIds: ["s1", "s2"], serviceType: "Rodent Control, Termite Treatment" }));
  });

  it("unticking a service drops its materials", async () => {
    renderVisit(visit, "/visit/a1?step=Treatment");
    await userEvent.click(screen.getByRole("button", { name: "Termite Treatment" }));
    await userEvent.click(screen.getByRole("button", { name: "Rodent Control" }));
    expect(screen.getByText("2 pc")).toBeInTheDocument();
    expect(screen.queryByText("0.5 kg")).not.toBeInTheDocument();
  });

  it("asks for a service when none is ticked", async () => {
    renderVisit({ ...visit, serviceId: "" }, "/visit/a1?step=Findings");
    await userEvent.type(screen.getByLabelText("Findings"), "Droppings");
    await userEvent.click(screen.getByRole("button", { name: /Next: Treatment/ }));
    await userEvent.click(screen.getByRole("button", { name: /Next: Photos/ }));
    expect(mockShowError).toHaveBeenCalledWith("Tick the services you performed.");
  });

  it("offers every upload category but signed forms, and lists what is in each", async () => {
    renderVisit({
      ...visit,
      attachments: [
        { id: "f1", name: "bait-map.pdf", category: "TREATMENT_PROOF" },
        { id: "f2", name: "front-door.jpg", category: "BEFORE" },
      ],
    }, "/visit/a1?step=Photos");
    const group = screen.getByRole("group", { name: "Photo type" });
    ["Before", "After", "Inspection", "Treatment proof", "Other"].forEach((name) => {
      expect(within(group).getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    });
    expect(within(group).queryByRole("button", { name: /Signed/ })).not.toBeInTheDocument();

    expect(screen.getByText("front-door.jpg")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: /^Treatment proof/ }));
    expect(screen.getByText("bait-map.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Add photo")).toHaveAttribute("accept", "image/*,application/pdf");
  });

  it("keeps the report when recording materials fails, and says so", async () => {
    renderVisit(visit, "/visit/a1?step=Findings");
    mockSubmitReport.mockResolvedValue({});
    mockStockOutMany.mockResolvedValue("Requested quantity for Contrac Blox exceeds available stock.");

    await userEvent.type(screen.getByLabelText("Findings"), "Droppings");
    await userEvent.click(screen.getByRole("button", { name: /^Sign/ }));
    await userEvent.click(screen.getByRole("button", { name: /Send report/ }));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith(expect.stringMatching(/^Report sent, but the materials weren't recorded/)));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  describe("a multi-day job (migration 052)", () => {
    const day1 = { ...visit, planId: "job", planKind: "MULTI_DAY" };
    const day2 = { ...visit, id: "a2", planId: "job", planKind: "MULTI_DAY", status: "Confirmed", scheduledAt: new Date(Date.now() + 86400000).toISOString() };

    it("closes an earlier day with Day done: materials recorded, no report", async () => {
      renderVisit(day1, "/visit/a1", [day2]);
      mockStockOutMany.mockResolvedValue([]);
      mockFinishJobDay.mockResolvedValue(true);

      expect(screen.getByText(/Day 1\/2 of a multi-day job/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Findings/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Services performed" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /Next: Photos/ }));
      await userEvent.click(screen.getByRole("button", { name: /Day done/ }));

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
      expect(mockStockOutMany).toHaveBeenCalled();
      expect(mockFinishJobDay).toHaveBeenCalledWith("a1");
      expect(mockSubmitReport).not.toHaveBeenCalled();
    });

    it("finishes the job early from an earlier day", async () => {
      renderVisit(day1, "/visit/a1", [day2]);
      mockFinishJobHere.mockResolvedValue(true);
      await userEvent.click(screen.getByRole("button", { name: "This was the last day" }));
      expect(mockFinishJobHere).toHaveBeenCalledWith("a1");
    });

    it("files the report on the last day", () => {
      renderVisit({ ...day2, id: "a1" }, "/visit/a1", [{ ...day1, id: "a0", scheduledAt: new Date(Date.now() - 86400000).toISOString() }]);
      expect(screen.getByText(/Last day: file the report for the whole job/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Findings/ })).toBeInTheDocument();
    });
  });

  it("refuses a visit that isn't the technician's", () => {
    renderVisit({ ...visit, technicianId: "ramon", technicianIds: ["ramon"] });
    expect(screen.getByText(/not assigned to you/)).toBeInTheDocument();
  });
});
