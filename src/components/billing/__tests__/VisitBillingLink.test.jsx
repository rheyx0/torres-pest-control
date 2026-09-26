import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import VisitBillingLink from "../VisitBillingLink";
import { useOptionalBilling } from "../../../hooks/useBilling";

jest.mock("../../../hooks/useAuth", () => () => ({ can: () => true }));
jest.mock("../../../hooks/useBilling", () => ({ useOptionalBilling: jest.fn() }));

const paid = { id: "q1", reference: "TPC-Q-00001", clientId: "c1", status: "APPROVED", validUntil: "2099-01-01", total: 4480, depositAmount: 0 };
const unpaid = { id: "q2", reference: "TPC-Q-00002", clientId: "c1", status: "APPROVED", validUntil: "2099-01-01", total: 1680, depositAmount: 840 };
const contract = { id: "k1", reference: "TPC-K-00001", title: "Quarterly termite", clientId: "c1", status: "ACTIVE", planId: "" };

function setup({ quotes = [paid, unpaid], contracts = [contract], appointment = {} } = {}) {
  const billing = {
    office: true,
    available: true,
    quotes,
    contracts,
    quoteById: (id) => quotes.find((quote) => quote.id === id) || null,
    paymentsForQuote: () => [],
    linkQuoteAppointments: jest.fn().mockResolvedValue(1),
    linkContractPlan: jest.fn().mockResolvedValue({}),
  };
  useOptionalBilling.mockReturnValue(billing);
  render(<MemoryRouter><VisitBillingLink appointment={{ id: "a1", clientId: "c1", status: "Confirmed", ...appointment }} /></MemoryRouter>);
  return billing;
}

test("a visit booked without billing says so, and can be linked to a paid quote", async () => {
  const billing = setup();
  expect(screen.getByText(/Not linked to a quote or contract/)).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /TPC-Q-00002/ })).toBeDisabled();
  // Not in a plan: no contract to offer.
  expect(screen.queryByRole("option", { name: /TPC-K-00001/ })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Link to quote or contract"), "quote:q1");
  await userEvent.click(screen.getByRole("button", { name: "Link" }));
  expect(billing.linkQuoteAppointments).toHaveBeenCalledWith("q1", ["a1"]);
});

test("a visit in a plan can be linked to an active contract", async () => {
  const billing = setup({ appointment: { planId: "p1" } });
  await userEvent.selectOptions(screen.getByLabelText("Link to quote or contract"), "contract:k1");
  await userEvent.click(screen.getByRole("button", { name: "Link" }));
  expect(billing.linkContractPlan).toHaveBeenCalledWith("k1", "a1");
});

test("a linked visit shows what it is billed under", () => {
  setup({ appointment: { quoteId: "q1" } });
  expect(screen.getByRole("link", { name: "TPC-Q-00001" })).toHaveAttribute("href", "/billing?quote=q1");
  expect(screen.queryByText(/Not linked/)).not.toBeInTheDocument();
});

test("without billing it shows nothing", () => {
  useOptionalBilling.mockReturnValue(null);
  const { container } = render(<MemoryRouter><VisitBillingLink appointment={{ id: "a1", clientId: "c1" }} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
