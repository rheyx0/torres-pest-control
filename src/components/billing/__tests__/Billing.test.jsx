import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { validateQuote } from "../QuoteEditor";
import { validatePayment } from "../PaymentForm";
import PaymentList, { paymentState } from "../PaymentList";
import QuoteDetail from "../QuoteDetail";

const line = (fields) => ({ kind: "EXTRA", description: "Termite treatment", quantity: "1", unitPrice: "2500", ...fields });
const form = (fields) => ({ clientId: "c1", validUntil: "2026-10-26", discountType: "AMOUNT", discountValue: 0, depositType: "NONE", depositValue: 0, ...fields });

describe("validateQuote", () => {
  const today = "2026-09-26";

  test("a complete quote passes", () => {
    expect(validateQuote(form(), [line()], today)).toBeNull();
  });

  test("needs a client, a future validity date and a line", () => {
    expect(validateQuote(form({ clientId: "" }), [line()], today)).toMatch(/client/);
    expect(validateQuote(form({ validUntil: "2026-09-25" }), [line()], today)).toMatch(/already passed/);
    expect(validateQuote(form(), [], today)).toMatch(/at least one/);
  });

  test("every line needs a description, a quantity and a price", () => {
    expect(validateQuote(form(), [line({ description: " " })], today)).toMatch(/description/);
    expect(validateQuote(form(), [line({ quantity: "0" })], today)).toMatch(/above zero/);
    expect(validateQuote(form(), [line({ unitPrice: "" })], today)).toMatch(/Enter a price/);
  });

  test("percentages stop at 100 and a chosen down payment needs a value", () => {
    expect(validateQuote(form({ discountType: "PERCENT", discountValue: 120 }), [line()], today)).toMatch(/100%/);
    expect(validateQuote(form({ depositType: "PERCENT", depositValue: 150 }), [line()], today)).toMatch(/100%/);
    expect(validateQuote(form({ depositType: "AMOUNT", depositValue: 0 }), [line()], today)).toMatch(/down payment/);
  });
});

describe("validatePayment", () => {
  const ok = { amount: "1000", paidOn: "2020-01-01", method: "CASH" };

  test("cash with an amount and a date passes", () => {
    expect(validatePayment(ok)).toBeNull();
  });

  test("refuses nothing, too much, and a future date", () => {
    expect(validatePayment({ ...ok, amount: "0" })).toMatch(/amount/);
    expect(validatePayment({ ...ok, amount: "1500" }, { max: 1000 })).toMatch(/still due/);
    expect(validatePayment({ ...ok, paidOn: "2999-01-01" })).toMatch(/future/);
  });

  test("a check needs its number, bank and date", () => {
    expect(validatePayment({ ...ok, method: "CHECK" })).toMatch(/check number/);
    expect(validatePayment({ ...ok, method: "CHECK", checkNumber: "001234" })).toMatch(/bank/);
    expect(validatePayment({ ...ok, method: "CHECK", checkNumber: "001234", checkBank: "BDO", checkDate: "2020-01-01" })).toBeNull();
  });
});

const payment = (fields) => ({ id: "p1", reference: "TPC-R-00001", quoteId: "q1", kind: "DEPOSIT", amount: 1000, paidOn: "2026-09-20", method: "CASH", ...fields });

test("paymentState names each state", () => {
  expect(paymentState(payment())).toBe("Received");
  expect(paymentState(payment({ method: "CHECK", checkStatus: "PENDING" }))).toBe("Pending check");
  expect(paymentState(payment({ method: "CHECK", checkStatus: "BOUNCED" }))).toBe("Bounced");
  expect(paymentState(payment({ reversedAt: "2026-09-21" }))).toBe("Reversed");
});

describe("PaymentList", () => {
  test("a pending check can be cleared, or bounced with a reason", async () => {
    const onCheck = jest.fn().mockResolvedValue(true);
    render(<PaymentList payments={[payment({ method: "CHECK", checkStatus: "PENDING", checkNumber: "001234", checkBank: "BDO" })]} onCheck={onCheck} onReverse={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Bounced" }));
    const confirm = screen.getByRole("button", { name: "Mark bounced" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why the check bounced"), "Insufficient funds");
    await userEvent.click(confirm);
    expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), "BOUNCED", "Insufficient funds");
  });

  test("only an admin sees Reverse", () => {
    const { rerender } = render(<PaymentList payments={[payment()]} canReverse={false} />);
    expect(screen.queryByRole("button", { name: "Reverse" })).not.toBeInTheDocument();
    rerender(<PaymentList payments={[payment()]} canReverse />);
    expect(screen.getByRole("button", { name: "Reverse" })).toBeInTheDocument();
  });
});

describe("QuoteDetail", () => {
  const quote = (fields) => ({
    id: "q1",
    reference: "TPC-Q-00001",
    clientId: "c1",
    status: "APPROVED",
    validUntil: "2099-01-01",
    paymentTerms: "NET_15",
    vatMode: "ADDED",
    vatRate: 12,
    subtotal: 2500,
    discountAmount: 0,
    vatAmount: 300,
    total: 2800,
    depositAmount: 1400,
    lines: [{ id: "l1", kind: "EXTRA", description: "Termite treatment", quantity: 1, unit: "", unitPrice: 2500, amount: 2500 }],
    ...fields,
  });
  const renderDetail = (props) => render(<QuoteDetail client={{ name: "Ana Cruz" }} onClose={jest.fn()} {...props} />);

  test("an approved quote waits for its down payment before it can be booked", () => {
    renderDetail({ quote: quote() });
    expect(screen.getByRole("button", { name: "Book visit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record down payment" })).toBeInTheDocument();
    expect(screen.getByText("The down payment has not been received yet.")).toBeInTheDocument();
  });

  test("once it is paid, Book visit opens", async () => {
    const onBook = jest.fn();
    renderDetail({ quote: quote(), payments: [payment({ amount: 1400 })], onBook });
    expect(screen.queryByRole("button", { name: "Record down payment" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book visit" }));
    expect(onBook).toHaveBeenCalled();
  });

  test("shows the totals", () => {
    renderDetail({ quote: quote() });
    const totals = screen.getByLabelText("Quote totals");
    expect(within(totals).getByText("Total")).toBeInTheDocument();
    expect(within(totals).getByText("VAT (12%)")).toBeInTheDocument();
  });

  test("a sent quote is rejected only with a reason", async () => {
    const onDecide = jest.fn().mockResolvedValue(true);
    renderDetail({ quote: quote({ status: "SENT" }), onDecide });
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    const reject = screen.getByRole("button", { name: "Reject quote" });
    expect(reject).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why it was rejected"), "Too expensive");
    await userEvent.click(reject);
    expect(onDecide).toHaveBeenCalledWith(false, "Too expensive");
  });

  test("a sent quote past its date shows as expired and can only be revised", () => {
    renderDetail({ quote: quote({ status: "SENT", validUntil: "2020-01-01" }) });
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revise" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  test("a draft asks before it is deleted", async () => {
    const onDelete = jest.fn().mockResolvedValue(true);
    renderDetail({ quote: quote({ status: "DRAFT" }), onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(onDelete).toHaveBeenCalled();
  });

  test("a server refusal is shown", async () => {
    renderDetail({ quote: quote({ status: "DRAFT" }), onSend: jest.fn().mockResolvedValue("Only a draft quote can be sent.") });
    await userEvent.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a draft quote can be sent.");
  });
});
