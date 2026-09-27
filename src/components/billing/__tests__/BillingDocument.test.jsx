import { render, screen } from "@testing-library/react";
import BillingDocument from "../BillingDocument";
import { billingFileName } from "../BillingPrinter";

const client = { id: "c1", reference: "TPC-C-0002", name: "Ana Cruz", address: "12 Mabini St", phone: "0917 000 0000" };
const lines = [{ id: "l1", description: "Termite treatment", quantity: 1, unit: "job", unitPrice: 2500, amount: 2500 }];
const totals = { subtotal: 2500, discountAmount: 0, vatMode: "ADDED", vatRate: 12, vatAmount: 300, total: 2800 };
const quote = { id: "q1", reference: "TPC-Q-00001", clientId: "c1", status: "APPROVED", validUntil: "2026-10-26", createdAt: "2026-09-26T08:00:00Z", paymentTerms: "NET_15", depositAmount: 1400, lines, ...totals };
const invoice = { id: "inv1", reference: "TPC-INV-00001", clientId: "c1", quoteId: "q1", status: "ISSUED", issuedOn: "2026-09-26", dueOn: "2026-10-11", paymentTerms: "NET_15", depositApplied: 1400, amountDue: 1400, lines, ...totals };
const payment = (fields) => ({ id: "p1", reference: "TPC-R-00002", clientId: "c1", invoiceId: "inv1", kind: "PAYMENT", amount: 1000, paidOn: "2026-09-27", method: "CASH", receivedByName: "Maria Santos", createdAt: "2026-09-27T01:00:00Z", ...fields });

test("the quote shows its lines, VAT, total and the down payment to book", () => {
  render(<BillingDocument kind="QUOTE" quote={quote} client={client} />);
  expect(screen.getByText("Quotation")).toBeInTheDocument();
  expect(screen.getByText("Termite treatment")).toBeInTheDocument();
  expect(screen.getByText("VAT (12%)")).toBeInTheDocument();
  expect(screen.getByText("Down payment to book").nextElementSibling).toHaveTextContent("₱1,400.00");
  expect(screen.getByText("Acceptance")).toBeInTheDocument();
});

test("the invoice deducts the down payment and shows the balance after payments", () => {
  render(<BillingDocument kind="INVOICE" invoice={invoice} quote={quote} client={client} payments={[payment()]} visits={[]} />);
  expect(screen.getByText("Less down payment received").nextElementSibling).toHaveTextContent("−₱1,400.00");
  expect(screen.getByText("Amount due").nextElementSibling).toHaveTextContent("₱1,400.00");
  expect(screen.getByText("Balance").nextElementSibling).toHaveTextContent("₱400.00");
  expect(screen.getByText(/Please quote TPC-INV-00001/)).toBeInTheDocument();
});

test("a void invoice says so", () => {
  render(<BillingDocument kind="INVOICE" invoice={{ ...invoice, status: "VOID", voidReason: "Wrong client" }} client={client} />);
  expect(screen.getByText("VOID — Wrong client")).toBeInTheDocument();
});

test("the receipt shows the amount, what it was for and the balance as it stood then", () => {
  const later = payment({ id: "p2", reference: "TPC-R-00003", amount: 400, createdAt: "2026-09-30T01:00:00Z" });
  render(<BillingDocument kind="RECEIPT" payment={payment()} invoice={invoice} client={client} payments={[payment(), later]} />);
  expect(screen.getByText("Acknowledgement Receipt")).toBeInTheDocument();
  expect(screen.getByText("₱1,000.00")).toBeInTheDocument();
  expect(screen.getByText("Payment on invoice TPC-INV-00001")).toBeInTheDocument();
  // 1,400 due − this 1,000 = 400; the later payment isn't counted.
  expect(screen.getByText("Balance after this payment").nextElementSibling).toHaveTextContent("₱400.00");
  expect(screen.getByText(/not a BIR official receipt/)).toBeInTheDocument();
});

test("a check receipt is subject to clearing", () => {
  render(<BillingDocument kind="RECEIPT" payment={payment({ kind: "DEPOSIT", quoteId: "q1", invoiceId: "", method: "CHECK", checkNumber: "001234", checkBank: "BDO", checkStatus: "PENDING" })} quote={quote} client={client} />);
  expect(screen.getByText("Down payment on quotation TPC-Q-00001")).toBeInTheDocument();
  expect(screen.getByText(/check no. 001234, BDO/)).toBeInTheDocument();
  expect(screen.getByText(/subject to clearing/)).toBeInTheDocument();
});

test("the PDF is named by client reference, name and document", () => {
  expect(billingFileName({ kind: "INVOICE", invoice, client })).toBe("TPC-C-0002_Ana-Cruz_TPC-INV-00001");
  expect(billingFileName({ kind: "RECEIPT", payment: payment(), client: { name: "Ñoño's Bakery" } })).toBe("Nonos-Bakery_TPC-R-00002");
});

describe("the service contract", () => {
  const contract = {
    id: "k1", reference: "TPC-K-00001", clientId: "c1", title: "Quarterly termite protection", status: "DRAFT",
    serviceNames: "Termite Control", frequency: "Quarterly", visitCount: 4, startsOn: "2026-10-01", endsOn: "",
    pricePerVisit: 2500, billingSchedule: "PER_VISIT", paymentTerms: "NET_15",
    inclusions: "Materials included.", cancellationTerms: "30 days' notice.", notes: "",
  };

  test("prints the terms, the price and two signature lines", () => {
    render(<BillingDocument kind="CONTRACT" contract={contract} client={client} />);
    expect(screen.getByText("Service Contract")).toBeInTheDocument();
    expect(screen.getByText("TPC-K-00001")).toBeInTheDocument();
    expect(screen.getByText("Termite Control")).toBeInTheDocument();
    expect(screen.getByText("4 visits")).toBeInTheDocument();
    expect(screen.getByText("Contract value").nextElementSibling).toHaveTextContent("₱10,000.00");
    expect(screen.getByText("Per visit")).toBeInTheDocument();
    expect(screen.getByText("Materials included.")).toBeInTheDocument();
    expect(screen.getByText("30 days' notice.")).toBeInTheDocument();
    expect(screen.getByText(/Client signature over printed name/)).toBeInTheDocument();
    expect(screen.getByText(/Authorized signature over printed name/)).toBeInTheDocument();
  });

  test("a contract that runs until a date says so, and has no total", () => {
    render(<BillingDocument kind="CONTRACT" contract={{ ...contract, visitCount: null, endsOn: "2027-09-30" }} client={client} />);
    expect(screen.getByText(/^Until /)).toBeInTheDocument();
    expect(screen.queryByText("Contract value")).not.toBeInTheDocument();
  });

  test("the PDF is named after the contract", () => {
    expect(billingFileName({ kind: "CONTRACT", contract, client })).toBe("TPC-C-0002_Ana-Cruz_TPC-K-00001");
  });
});
