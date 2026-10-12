// Stock out to a technician: choosing the visit fills in its services' materials.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InventoryPage from "../InventoryPage";

jest.mock("../../hooks/useInventory", () => ({
  __esModule: true,
  default: () => ({
    inventory: [
      { id: "i1", name: "Demand CS Residual Spray", type: "MATERIAL", unit: "L", quantity: 10, status: "ACTIVE", cost: 100 },
      { id: "i2", name: "Nitrile Gloves", type: "MATERIAL", unit: "box", quantity: 12, status: "ACTIVE", cost: 50 },
    ],
    movements: [],
    movementsLoading: false,
    movementsError: "",
    refreshMovements: jest.fn(),
  }),
}));
jest.mock("../../hooks/useAuth", () => ({ __esModule: true, default: () => ({ can: () => true }) }));
jest.mock("../../hooks/useUsers", () => ({
  __esModule: true,
  default: () => ({ technicians: [{ id: "t1", name: "pestTech", status: "ACTIVE" }] }),
}));
jest.mock("../../hooks/useServices", () => ({
  __esModule: true,
  default: () => ({}),
  useOptionalServiceList: () => [
    { id: "s1", name: "General Pest Control", materials: [{ itemId: "i1", defaultAmount: 1 }, { itemId: "i2", defaultAmount: 1 }] },
  ],
}));
jest.mock("../../context/SchedulingContext", () => ({
  useScheduling: () => ({
    appointments: [{ id: "v1", reference: "TPC-V-00040", technicianId: "t1", technicianIds: ["t1"], status: "Confirmed", serviceIds: ["s1"], serviceType: "General Pest Control", scheduledAt: "2099-01-05T09:00:00" }],
  }),
}));
jest.mock("../../context/ToastContext", () => ({ useToast: () => ({ showSuccess: jest.fn(), showError: jest.fn() }) }));

test("choosing the visit fills in its materials at the included amounts", async () => {
  render(<MemoryRouter><InventoryPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Stock out" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.selectOptions(within(dialog).getByLabelText("Technician"), "t1");
  await userEvent.selectOptions(within(dialog).getByLabelText("For visit"), "v1");

  const items = within(dialog).getAllByLabelText("Stock out item").map((select) => select.value);
  expect(items).toEqual(["i1", "i2"]);
  expect(within(dialog).getAllByLabelText("Stock out quantity").map((input) => input.value)).toEqual(["1", "1"]);
  expect(within(dialog).getByText(/Items filled in from TPC-V-00040/)).toBeInTheDocument();
});

test("stock out to a technician needs both signatures", async () => {
  render(<MemoryRouter><InventoryPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Stock out" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.selectOptions(within(dialog).getByLabelText("Technician"), "t1");
  await userEvent.selectOptions(within(dialog).getByLabelText("For visit"), "v1");
  expect(within(dialog).getByText("Staff signs here")).toBeInTheDocument();
  expect(within(dialog).getByText("Technician signs here")).toBeInTheDocument();
  expect(within(dialog).getByText("Received by: pestTech (Technician)")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: /Record stock out|Stock out|Save/ }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(/must sign/);
});
