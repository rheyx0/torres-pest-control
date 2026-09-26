// Expiry is entered per delivery on Stock In (migration 049), not on Add item,
// and with the lot number each chemical line becomes a batch (055).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkStockInModal, expiryHint } from "../InventoryPage";
import { todayISO } from "../../utils/validators";

const inventory = [
  { id: "c1", name: "Termidor SC", type: "CHEMICAL", unit: "L", status: "ACTIVE", quantity: 10, cost: 100 },
  { id: "e1", name: "Sprayer", type: "EQUIPMENT", unit: "pc", status: "ACTIVE", quantity: 2, cost: 500 },
];

function renderModal(initialItemId, onSubmit = jest.fn(async () => {})) {
  render(<BulkStockInModal inventory={inventory} initialItemId={initialItemId} onClose={() => {}} onSubmit={onSubmit} />);
  return onSubmit;
}

function fillHeader() {
  fireEvent.change(screen.getByLabelText(/PO \/ Supplier/), { target: { value: "PO-9" } });
  fireEvent.change(screen.getByLabelText(/Intake Branch/), { target: { value: "Main" } });
  fireEvent.change(screen.getByLabelText("Stock In quantity"), { target: { value: "4" } });
}

const shiftDays = (days) => {
  const date = new Date(`${todayISO()}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

describe("Stock In expiry date", () => {
  it("asks for it on a chemical line", () => {
    renderModal("c1");
    expect(screen.getByLabelText("Expiry date")).toBeInTheDocument();
  });

  it("does not ask for it on equipment", () => {
    renderModal("e1");
    expect(screen.queryByLabelText("Expiry date")).not.toBeInTheDocument();
  });

  it("sends the date and the lot with the line", async () => {
    const onSubmit = renderModal("c1");
    fillHeader();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: shiftDays(200) } });
    fireEvent.change(screen.getByLabelText("Lot number"), { target: { value: " L24-0917 " } });
    fireEvent.submit(screen.getByLabelText("Expiry date").closest("form"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0][0]).toMatchObject({ expirationDate: shiftDays(200), lotNumber: "L24-0917", noLot: false });
  });

  it("will not receive a chemical without one", () => {
    const onSubmit = renderModal("c1");
    fillHeader();
    fireEvent.submit(screen.getByLabelText("Expiry date").closest("form"));
    expect(screen.getByText("Enter the expiry date printed on the Termidor SC delivery.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("receives equipment without one", async () => {
    const onSubmit = renderModal("e1");
    fillHeader();
    fireEvent.submit(screen.getByLabelText("Stock In quantity").closest("form"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it("refuses a delivery that has already expired", () => {
    const onSubmit = renderModal("c1");
    fillHeader();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: shiftDays(-3) } });
    fireEvent.submit(screen.getByLabelText("Expiry date").closest("form"));
    expect(screen.getByText(/Termidor SC has already expired/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// Migration 055: every chemical line becomes a batch, labelled with the lot
// printed on the container.
describe("Stock In lot number", () => {
  const fillChemical = () => {
    fillHeader();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: shiftDays(200) } });
  };

  it("is required for a chemical", () => {
    const onSubmit = renderModal("c1");
    fillChemical();
    fireEvent.submit(screen.getByLabelText("Expiry date").closest("form"));
    expect(screen.getByText('Enter the lot number printed on the Termidor SC container, or tick "No lot number printed".')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("can be skipped when none is printed", async () => {
    const onSubmit = renderModal("c1");
    fillChemical();
    fireEvent.click(screen.getByLabelText("No lot number printed"));
    expect(screen.getByLabelText("Lot number")).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Expiry date").closest("form"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0][0]).toMatchObject({ lotNumber: null, noLot: true });
  });

  it("is not asked for on equipment", () => {
    renderModal("e1");
    expect(screen.queryByLabelText("Lot number")).not.toBeInTheDocument();
  });
});

describe("expiryHint", () => {
  it("says a blank field is required, and shows the item's current date", () => {
    expect(expiryHint("", "2026-09-25", "2027-01-10")).toMatch(/Required — currently/);
    expect(expiryHint("", "2026-09-25")).toMatch(/Required for every chemical/);
  });
  it("warns when the delivery expires within 30 days", () => {
    expect(expiryHint("2026-10-05", "2026-09-25")).toBe("Expires 10 days after delivery.");
  });
  it("otherwise says the date stays with this batch", () => {
    expect(expiryHint("2027-09-25", "2026-09-25")).toBe("Kept with this batch. The soonest-expiring batch is used first.");
  });
});
