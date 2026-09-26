// The "With technicians" tab and returning checked-out stock (migration 054).

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InventoryPage from "../InventoryPage";

const mockReturnCheckout = jest.fn();

const mockMovements = [
  {
    id: "co1", itemId: "i1", amount: 2, movementType: "OUT", stockOutReason: "TECHNICIAN_CHECKOUT",
    technicianId: "t1", forAppointmentId: "v1", movementDate: "2026-09-20", itemName: "Termidor SC", itemUnit: "L",
  },
  { id: "u1", itemId: "i1", amount: 0.5, movementType: "OUT", stockOutReason: "APPOINTMENT", appointmentId: "v2", checkoutId: "co1", movementDate: "2026-09-21", itemName: "Termidor SC", itemUnit: "L" },
];

jest.mock("../../hooks/useInventory", () => ({
  __esModule: true,
  default: () => ({
    inventory: [{ id: "i1", name: "Termidor SC", type: "CHEMICAL", unit: "L", quantity: 8, status: "ACTIVE", cost: 100 }],
    movements: mockMovements,
    movementsLoading: false,
    movementsError: "",
    refreshMovements: jest.fn(),
    returnCheckout: mockReturnCheckout,
  }),
}));

jest.mock("../../hooks/useAuth", () => ({ __esModule: true, default: () => ({ can: () => true }) }));
jest.mock("../../hooks/useUsers", () => ({
  __esModule: true,
  default: () => ({ technicians: [{ id: "t1", name: "Juan Dela Cruz", status: "ACTIVE" }] }),
}));
jest.mock("../../context/SchedulingContext", () => ({
  useScheduling: () => ({
    appointments: [
      { id: "v1", reference: "TPC-V-00012", technicianId: "t1", status: "Cancelled", scheduledAt: "2026-09-22T09:00:00" },
      { id: "v2", reference: "TPC-V-00013", technicianId: "t1", status: "Completed", scheduledAt: "2026-09-21T09:00:00" },
    ],
  }),
}));
jest.mock("../../context/ToastContext", () => ({ useToast: () => ({ showSuccess: jest.fn(), showError: jest.fn() }) }));

async function openReturn() {
  render(<MemoryRouter><InventoryPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: /With technicians/ }));
  await userEvent.click(screen.getByRole("button", { name: "Return" }));
  return screen.getByRole("dialog");
}

describe("stock with technicians", () => {
  // CRA resets mock implementations before each test.
  beforeEach(() => mockReturnCheckout.mockImplementation(async () => true));

  it("lists what is still out after the visit drew on it", async () => {
    render(<MemoryRouter><InventoryPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "With technicians (1)" }));

    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("1.5 L")).toBeInTheDocument();
    expect(screen.getByText("of 2 · 0.5 used · 0 returned")).toBeInTheDocument();
    expect(screen.getByText("TPC-V-00012")).toBeInTheDocument();
  });

  it("returns stock for the cancelled visit it was taken for", async () => {
    const dialog = await openReturn();

    // The checkout was for a visit since cancelled, so that is the default.
    expect(within(dialog).getByLabelText("Return reason")).toHaveValue("VISIT_CANCELLED");
    expect(within(dialog).getByLabelText("Cancelled visit")).toHaveValue("v1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Return to stock" }));

    expect(mockReturnCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ id: "co1" }),
      expect.objectContaining({ amount: 1.5, reason: "VISIT_CANCELLED", appointmentId: "v1" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("will not return more than is still out", async () => {
    const dialog = await openReturn();
    const amount = within(dialog).getByLabelText(/Quantity returned/);
    await userEvent.clear(amount);
    await userEvent.type(amount, "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Return to stock" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Only 1.5 L is still out on this checkout.");
    expect(mockReturnCheckout).not.toHaveBeenCalled();
  });

  it("needs a note when the reason is Other", async () => {
    const dialog = await openReturn();
    await userEvent.selectOptions(within(dialog).getByLabelText("Return reason"), "OTHER");
    await userEvent.click(within(dialog).getByRole("button", { name: "Return to stock" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Write a note saying why the stock is coming back.");
    expect(mockReturnCheckout).not.toHaveBeenCalled();
  });
});
