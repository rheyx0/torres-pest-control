// The batch picker and the batch list (migration 055).

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BatchList from "../BatchList";
import BatchSelect from "../BatchSelect";

const termidor = { id: "t", name: "Termidor SC", type: "CHEMICAL", unit: "L", quantity: 10 };
const batch = (id, lotNumber, quantity, expirationDate, extra = {}) => ({
  id, reference: `TPC-B-000${id}`, itemId: "t", lotNumber, quantity, quantityReceived: quantity,
  expirationDate, receivedDate: "2026-01-01", ...extra,
});
const batches = [
  batch("2", "L25-0142", 5, "2027-12-01"),
  batch("1", "L24-0917", 3, "2027-03-05"),
  batch("3", "L23-0001", 2, "2026-08-01"),
];
const TODAY = "2026-09-26";

describe("BatchSelect", () => {
  it("starts on the soonest usable expiry and shows what a line will use", () => {
    render(<BatchSelect item={termidor} batches={batches} date={TODAY} value="" onChange={() => {}} amount="4" />);
    const select = screen.getByLabelText("Batch");
    expect(select).toHaveValue("");
    expect(within(select).getByRole("option", { name: "Soonest expiry first — L24-0917" })).toBeInTheDocument();
    expect(screen.getByText("Uses 3 L from L24-0917, 1 L from L25-0142.")).toBeInTheDocument();
  });

  it("never offers an expired batch", () => {
    render(<BatchSelect item={termidor} batches={batches} date={TODAY} value="" onChange={() => {}} />);
    expect(screen.queryByRole("option", { name: /L23-0001/ })).not.toBeInTheDocument();
  });

  it("offers expired batches for a stock count", () => {
    render(<BatchSelect item={termidor} batches={batches} date={TODAY} value="" onChange={() => {}} includeExpired showPlan={false} />);
    expect(screen.getByRole("option", { name: /L23-0001 · exp Aug 1, 2026 · EXPIRED/ })).toBeInTheDocument();
  });

  it("puts a chosen batch first", async () => {
    const onChange = jest.fn();
    const { rerender } = render(<BatchSelect item={termidor} batches={batches} date={TODAY} value="" onChange={onChange} amount="4" />);
    await userEvent.selectOptions(screen.getByLabelText("Batch"), "2");
    expect(onChange).toHaveBeenCalledWith("2");
    rerender(<BatchSelect item={termidor} batches={batches} date={TODAY} value="2" onChange={onChange} amount="6" />);
    expect(screen.getByText("Uses 5 L from L25-0142, 1 L from L24-0917.")).toBeInTheDocument();
  });

  it("is not shown for equipment, or before batches exist", () => {
    const { container, rerender } = render(<BatchSelect item={{ ...termidor, type: "EQUIPMENT" }} batches={batches} date={TODAY} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BatchSelect item={termidor} batches={[]} date={TODAY} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("BatchList", () => {
  const actions = () => ({
    onWriteOff: jest.fn(async () => true),
    onUpdate: jest.fn(async () => true),
    onSplit: jest.fn(async () => true),
  });

  it("lists the shelf soonest expiry first and flags the expired batch", () => {
    render(<BatchList item={termidor} batches={batches} today={TODAY} canManage {...actions()} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["L23-0001", "L24-0917", "L25-0142"]);
    expect(within(rows[0]).getByText(/EXPIRED/)).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "Write off" })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("button", { name: "Write off" })).not.toBeInTheDocument();
  });

  it("writes an expired batch off after asking", async () => {
    const handlers = actions();
    render(<BatchList item={termidor} batches={batches} today={TODAY} canManage {...handlers} />);
    await userEvent.click(screen.getByRole("button", { name: "Write off" }));
    expect(screen.getByText(/Write off the 2 L left in L23-0001\?/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Write off" }).at(-1));
    expect(handlers.onWriteOff).toHaveBeenCalledWith(expect.objectContaining({ id: "3" }), "");
  });

  it("splits part of a batch into a new lot, and checks the amount first", async () => {
    const handlers = actions();
    render(<BatchList item={termidor} batches={batches} today={TODAY} canManage {...handlers} />);
    const row = screen.getAllByRole("row").find((entry) => within(entry).queryByText("L25-0142"));
    await userEvent.click(within(row).getByRole("button", { name: "Split" }));

    await userEvent.type(screen.getByLabelText("Quantity to split off"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Split batch" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Split off more than 0 and less than the 5 L in this batch.");

    await userEvent.clear(screen.getByLabelText("Quantity to split off"));
    await userEvent.type(screen.getByLabelText("Quantity to split off"), "2");
    await userEvent.type(screen.getByLabelText("Lot number"), "L25-0200");
    await userEvent.type(screen.getByLabelText("Batch expiry"), "2027-11-01");
    await userEvent.click(screen.getByRole("button", { name: "Split batch" }));
    expect(handlers.onSplit).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }), { amount: 2, lotNumber: "L25-0200", expirationDate: "2027-11-01" });
  });

  it("shows no actions to someone who cannot manage stock", () => {
    render(<BatchList item={termidor} batches={batches} today={TODAY} canManage={false} {...actions()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
