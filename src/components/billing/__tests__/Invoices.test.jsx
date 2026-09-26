import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoiceDetail from "../InvoiceDetail";
import InvoiceEditor, { validateInvoice } from "../InvoiceEditor";
import { validateExtra } from "../VisitExtras";

describe("validateInvoice", () => {
  const form = { clientId: "c1", issuedOn: "2026-09-26", discountType: "AMOUNT", discountValue: 0 };
  const line = { description: "Termite treatment", quantity: "1", unitPrice: "4000" };

  test("a complete invoice passes", () => {
    expect(validateInvoice(form, [line], "2026-09-26")).toBeNull();
  });

  test("refuses no client, a future date, no lines, a line without a price", () => {
    expect(validateInvoice({ ...form, clientId: "" }, [line], "2026-09-26")).toMatch(/client/);
    expect(validateInvoice({ ...form, issuedOn: "2026-09-27" }, [line], "2026-09-26")).toMatch(/future/);
    expect(validateInvoice(form, [], "2026-09-26")).toMatch(/at least one line/);
    expect(validateInvoice(form, [{ ...line, unitPrice: "" }], "2026-09-26")).toMatch(/Enter a price/);
  });
});

test("validateExtra needs a description, a quantity and a price", () => {
  const extra = { description: "Storage room", quantity: "1", unitPrice: "800" };
  expect(validateExtra(extra)).toBeNull();
  expect(validateExtra({ ...extra, description: " " })).toMatch(/Describe/);
  expect(validateExtra({ ...extra, quantity: "0" })).toMatch(/quantity/);
  expect(validateExtra({ ...extra, unitPrice: "" })).toMatch(/price/);
});

const invoice = (fields) => ({
  id: "inv1",
  reference: "TPC-INV-00001",
  clientId: "c1",
  quoteId: "",
  status: "ISSUED",
  issuedOn: "2026-09-26",
  dueOn: "2099-01-01",
  paymentTerms: "NET_15",
  vatMode: "ADDED",
  vatRate: 12,
  subtotal: 2500,
  discountAmount: 0,
  vatAmount: 300,
  total: 2800,
  depositApplied: 1400,
  amountDue: 1400,
  lines: [{ id: "l1", description: "Termite treatment", quantity: 1, unit: "job", unitPrice: 2500, amount: 2500 }],
  ...fields,
});
const payment = (fields) => ({ id: "p1", reference: "TPC-R-00002", invoiceId: "inv1", kind: "PAYMENT", amount: 400, paidOn: "2026-09-26", method: "CASH", ...fields });

describe("InvoiceDetail", () => {
  const renderDetail = (props) => render(<InvoiceDetail client={{ name: "Ana Cruz" }} onClose={jest.fn()} onVoid={jest.fn()} {...props} />);

  test("the down payment is deducted and the balance shown", () => {
    renderDetail({ invoice: invoice(), payments: [payment()] });
    const totals = within(screen.getByLabelText("Invoice totals"));
    expect(totals.getByText("Less down payment").nextElementSibling).toHaveTextContent("−₱1,400.00");
    expect(totals.getByText("Amount due").nextElementSibling).toHaveTextContent("₱1,400.00");
    expect(totals.getByText("Balance").nextElementSibling).toHaveTextContent("₱1,000.00");
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
  });

  test("Record payment until nothing is left", () => {
    const { unmount } = renderDetail({ invoice: invoice(), payments: [] });
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
    unmount();
    renderDetail({ invoice: invoice(), payments: [payment({ amount: 1400 })] });
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    expect(screen.getByText("Paid", { selector: "span" })).toBeInTheDocument();
  });

  test("only an admin can void, only with a reason, and not while payments stand", async () => {
    const onVoid = jest.fn().mockResolvedValue(true);
    const { unmount } = renderDetail({ invoice: invoice(), payments: [payment()], canVoid: true, onVoid });
    expect(screen.getByRole("button", { name: "Void" })).toBeDisabled();
    unmount();

    renderDetail({ invoice: invoice(), payments: [payment({ reversedAt: "2026-09-26" })], canVoid: true, onVoid });
    await userEvent.click(screen.getByRole("button", { name: "Void" }));
    const confirm = screen.getByRole("button", { name: "Void invoice" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why it is being voided"), "Wrong client");
    await userEvent.click(confirm);
    expect(onVoid).toHaveBeenCalledWith("Wrong client");
  });

  test("staff don't see Void; a void invoice shows its reason", () => {
    const { unmount } = renderDetail({ invoice: invoice(), canVoid: false });
    expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    unmount();
    renderDetail({ invoice: invoice({ status: "VOID", voidedAt: "2026-09-26", voidReason: "Wrong client" }) });
    expect(screen.getByText(/Wrong client/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });
});

describe("InvoiceEditor", () => {
  const clients = [{ id: "c1", name: "Ana Cruz", status: "ACTIVE" }];
  const quote = {
    id: "q1", reference: "TPC-Q-00001", clientId: "c1", status: "APPROVED", total: 2800, depositAmount: 1400,
    paymentTerms: "NET_15", discountType: "AMOUNT", discountValue: 0, vatMode: "ADDED",
    lines: [{ kind: "SERVICE", serviceId: "s1", description: "Termite treatment", quantity: 1, unit: "job", unitPrice: 2500 }],
  };
  const visit = { id: "a1", reference: "TPC-V-00007", clientId: "c1", status: "Completed", quoteId: "q1", scheduledAt: "2026-09-20T09:00:00", serviceType: "Termite treatment", stockUsed: [] };
  const deposit = { id: "p0", kind: "DEPOSIT", quoteId: "q1", method: "CASH", amount: 1400 };
  const extra = { id: "e1", appointmentId: "a1", status: "APPROVED", description: "Storage room", quantity: 1, unit: "room", unitPrice: 500 };

  test("from a quote: its lines, its visits, approved extras, less the down payment", async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    render(<InvoiceEditor clients={clients} quotes={[quote]} payments={[deposit]} appointments={[visit]} extras={[extra]} initialQuoteId="q1" onSave={onSave} onClose={jest.fn()} />);
    expect(screen.getByRole("checkbox", { name: /TPC-V-00007/ })).toBeChecked();
    expect(screen.getAllByLabelText("Line description").map((input) => input.value)).toEqual(["Termite treatment", "Storage room"]);
    const totals = within(screen.getByLabelText("Invoice totals"));
    // (2500 + 500) + 12% VAT = 3360, less the 1400 down payment.
    expect(totals.getByText("Less down payment").nextElementSibling).toHaveTextContent("−₱1,400.00");
    expect(totals.getByText("Amount due").nextElementSibling).toHaveTextContent("₱1,960.00");

    await userEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", quoteId: "q1", appointmentIds: ["a1"], paymentTerms: "NET_15" }),
      [expect.objectContaining({ description: "Termite treatment", unitPrice: 2500 }), expect.objectContaining({ extraId: "e1", unitPrice: 500 })]
    );
  });

  test("unticking a visit drops its extras", async () => {
    render(<InvoiceEditor clients={clients} quotes={[quote]} payments={[deposit]} appointments={[visit]} extras={[extra]} initialQuoteId="q1" onSave={jest.fn()} onClose={jest.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /TPC-V-00007/ }));
    expect(screen.getAllByLabelText("Line description").map((input) => input.value)).toEqual(["Termite treatment"]);
  });
});
