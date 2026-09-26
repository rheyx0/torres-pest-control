import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContractDetail from "../ContractDetail";
import ContractEditor, { validateContract } from "../ContractEditor";

describe("validateContract", () => {
  const values = { clientId: "c1", title: "Quarterly termite", serviceIds: ["s1"], frequency: "Quarterly", startsOn: "2026-10-01", lengthBy: "count", visitCount: "4", endsOn: "", pricePerVisit: "2500" };

  test("a complete contract passes", () => {
    expect(validateContract(values)).toBeNull();
  });

  test("needs a client, title, services and a price", () => {
    expect(validateContract({ ...values, clientId: "" })).toMatch(/client/);
    expect(validateContract({ ...values, title: " " })).toMatch(/title/);
    expect(validateContract({ ...values, serviceIds: [] })).toMatch(/services/);
    expect(validateContract({ ...values, pricePerVisit: "" })).toMatch(/price/);
  });

  test("a length: 2 or more visits, or an end date after the start", () => {
    expect(validateContract({ ...values, visitCount: "1" })).toMatch(/between 2 and/);
    expect(validateContract({ ...values, lengthBy: "until", endsOn: "" })).toMatch(/end date/);
    expect(validateContract({ ...values, lengthBy: "until", endsOn: "2026-09-01" })).toMatch(/after the start/);
    expect(validateContract({ ...values, lengthBy: "until", endsOn: "2027-10-01" })).toBeNull();
  });
});

test("ContractEditor: ticking services fills the title and the price per visit", async () => {
  const services = [
    { id: "s1", name: "Termite treatment", defaultPrice: 2500, isActive: true },
    { id: "s2", name: "General pest control", defaultPrice: 1500, isActive: true },
  ];
  const onSave = jest.fn().mockResolvedValue(true);
  render(<ContractEditor clients={[{ id: "c1", name: "Ana Cruz", status: "ACTIVE" }]} services={services} initialClientId="c1" onSave={onSave} onClose={jest.fn()} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Termite treatment" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "General pest control" }));
  expect(screen.getByLabelText("Contract title")).toHaveValue("Termite treatment contract");
  expect(screen.getByLabelText("Price per visit")).toHaveValue(4000);
  expect(screen.getByText("₱16,000.00")).toBeInTheDocument(); // 4 visits × ₱4,000
  await userEvent.click(screen.getByRole("button", { name: "Save as draft" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ serviceIds: ["s1", "s2"], visitCount: 4, endsOn: "", frequency: "Quarterly" }));
});

describe("ContractDetail", () => {
  const contract = (fields) => ({
    id: "k1", reference: "TPC-K-00001", clientId: "c1", title: "Quarterly termite", status: "DRAFT", serviceNames: "Termite treatment",
    frequency: "Quarterly", visitCount: 4, startsOn: "2026-10-01", endsOn: "", pricePerVisit: 2500, billingSchedule: "PER_VISIT",
    paymentTerms: "NET_15", inclusions: "", cancellationTerms: "30 days' notice", signedDocumentId: "", planId: "", ...fields,
  });
  const renderDetail = (props) => render(<ContractDetail client={{ name: "Ana Cruz" }} onClose={jest.fn()} {...props} />);

  test("a draft can't be activated until the signed copy is attached", () => {
    const { unmount } = renderDetail({ contract: contract() });
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
    expect(screen.getByText(/No signed copy yet/)).toBeInTheDocument();
    unmount();
    renderDetail({ contract: contract({ signedDocumentId: "d1" }), signedDocument: { id: "d1", name: "signed.pdf" } });
    expect(screen.getByRole("button", { name: "Activate" })).toBeEnabled();
    expect(screen.getByText("signed.pdf")).toBeInTheDocument();
  });

  test("an active contract is booked, ended, or cancelled with a reason", async () => {
    const onCancel = jest.fn().mockResolvedValue({});
    const onBook = jest.fn();
    renderDetail({ contract: contract({ status: "ACTIVE", signedDocumentId: "d1" }), onCancel, onBook });
    await userEvent.click(screen.getByRole("button", { name: "Book visits" }));
    expect(onBook).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel contract" }));
    const confirm = screen.getByRole("button", { name: "Cancel contract" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why the contract is cancelled"), "Client moved out");
    await userEvent.click(confirm);
    expect(onCancel).toHaveBeenCalledWith("Client moved out");
  });

  test("once visits are booked it shows their progress instead of Book visits", () => {
    const visits = [
      { id: "a1", reference: "TPC-V-00001", status: "Completed", scheduledAt: "2026-10-01T09:00:00" },
      { id: "a2", reference: "TPC-V-00002", status: "Confirmed", scheduledAt: "2027-01-01T09:00:00" },
    ];
    renderDetail({ contract: contract({ status: "ACTIVE", planId: "p1", signedDocumentId: "d1" }), visits });
    expect(screen.queryByRole("button", { name: "Book visits" })).not.toBeInTheDocument();
    expect(screen.getByText("Visits · 1 of 2 done")).toBeInTheDocument();
  });

  test("a cancelled contract shows why and offers nothing", () => {
    renderDetail({ contract: contract({ status: "CANCELLED", cancelledAt: "2026-10-05T00:00:00Z", cancellationReason: "Client moved out (3 visits cancelled)" }) });
    expect(screen.getByText(/Client moved out \(3 visits cancelled\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Activate|Book visits|Cancel contract/ })).not.toBeInTheDocument();
  });
});
