import { contractInvoicesDue, followUpReminders, isInspectionVisit, paymentCheck, paymentReminders, prepaidPlanIds } from "../sprint4";
import { gmailComposeUrl, documentEmail } from "../gmail";
import { materialCharge, includedMaterialsText, BILLING_MODES } from "../pricing";

const now = new Date("2026-09-28T10:00:00");
const juan = { id: "c1", name: "Juan Dela Cruz" };
const termite = { id: "s1", name: "Termite Control" };
const inspection = { id: "s2", name: "Inspection", skipPaymentCheck: true };
const followUp = { id: "s3", name: "Follow-up Visit", skipPaymentCheck: true };

describe("paymentCheck", () => {
  it("refuses a treatment for a client with nothing paid", () => {
    const result = paymentCheck({ client: juan, services: [termite] }, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Juan Dela Cruz has no approved quotation/);
  });

  it("lets services marked 'Can be booked without payment' through", () => {
    expect(paymentCheck({ client: juan, services: [inspection] }, now)).toMatchObject({ ok: true, via: "service" });
    expect(paymentCheck({ client: juan, services: [inspection, followUp] }, now).ok).toBe(true);
    // one paid service on the visit brings the check back
    expect(paymentCheck({ client: juan, services: [inspection, termite] }, now).ok).toBe(false);
  });

  it("skips the check for an exempted client or a booking under a quote", () => {
    expect(paymentCheck({ client: { ...juan, skipPaymentCheck: true }, services: [termite] }, now).via).toBe("client");
    expect(paymentCheck({ client: juan, services: [termite], source: { kind: "QUOTE", id: "q1" } }, now).via).toBe("source");
  });

  it("passes with an approved quote whose down payment is paid, not before", () => {
    const quote = { id: "q1", clientId: "c1", status: "APPROVED", depositAmount: 1000 };
    expect(paymentCheck({ client: juan, services: [termite], quotes: [quote] }, now).ok).toBe(false);
    const payments = [{ quoteId: "q1", kind: "DEPOSIT", method: "CASH", amount: 1000 }];
    expect(paymentCheck({ client: juan, services: [termite], quotes: [quote], payments }, now)).toMatchObject({ ok: true, via: "quote" });
    const bounced = [{ quoteId: "q1", kind: "DEPOSIT", method: "CHECK", checkStatus: "PENDING", amount: 1000 }];
    expect(paymentCheck({ client: juan, services: [termite], quotes: [quote], payments: bounced }, now).ok).toBe(false);
  });

  it("passes with an active contract", () => {
    expect(paymentCheck({ client: juan, services: [termite], contracts: [{ id: "k1", clientId: "c1", status: "ACTIVE" }] }, now).via).toBe("contract");
    expect(paymentCheck({ client: juan, services: [termite], contracts: [{ id: "k1", clientId: "c1", status: "DRAFT" }] }, now).ok).toBe(false);
  });
});

describe("followUpReminders", () => {
  const done = { id: "v1", clientId: "c1", status: "Completed", reportSubmitted: true, scheduledAt: "2026-09-10T09:00:00" };

  it("shows a follow-up date within 7 days", () => {
    const list = followUpReminders([{ ...done, followUpDate: "2026-10-03" }], [juan], now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ dueOn: "2026-10-03", days: 5, client: juan });
  });

  it("waits until 7 days before", () => {
    expect(followUpReminders([{ ...done, followUpDate: "2026-10-10" }], [juan], now)).toHaveLength(0);
  });

  it("drops the reminder once something is booked for the client", () => {
    const booked = { id: "v2", clientId: "c1", status: "Pending", scheduledAt: "2026-10-03T09:00:00" };
    expect(followUpReminders([{ ...done, followUpDate: "2026-10-03" }, booked], [juan], now)).toHaveLength(0);
  });
});

describe("paymentReminders", () => {
  const invoice = (id, dueOn, extra = {}) => ({ id, reference: id, dueOn, amountDue: 5000, status: "ISSUED", ...extra });

  it("splits invoices into due within 3 days and overdue", () => {
    const { dueSoon, overdue } = paymentReminders([invoice("a", "2026-09-30"), invoice("b", "2026-09-20"), invoice("c", "2026-10-20")], [], now);
    expect(dueSoon.map((entry) => entry.invoice.id)).toEqual(["a"]);
    expect(overdue.map((entry) => entry.invoice.id)).toEqual(["b"]);
    expect(overdue[0].balance).toBe(5000);
  });

  it("leaves out paid and void invoices", () => {
    const payments = [{ invoiceId: "a", kind: "PAYMENT", method: "CASH", amount: 5000 }];
    const { dueSoon, overdue } = paymentReminders([invoice("a", "2026-09-20"), invoice("b", "2026-09-29", { status: "VOID" })], payments, now);
    expect(dueSoon).toHaveLength(0);
    expect(overdue).toHaveLength(0);
  });
});

describe("contract invoicing", () => {
  const contract = { id: "k1", reference: "TPC-K-00001", title: "Quarterly termite", clientId: "c1", status: "ACTIVE", planId: "p1", pricePerVisit: 3000, serviceIds: ["s1"], visitCount: 4 };
  const visit = (id, date, extra = {}) => ({ id, planId: "p1", status: "Completed", scheduledAt: `${date}T09:00:00`, ...extra });

  it("bills each completed visit on a per-visit contract", () => {
    const items = contractInvoicesDue({ contracts: [{ ...contract, billingSchedule: "PER_VISIT" }], appointments: [visit("v1", "2026-09-01"), visit("v2", "2026-09-15", { invoiceId: "i1" }), visit("v3", "2026-10-01", { status: "Pending" })] }, now);
    expect(items.map((item) => item.visits[0].id)).toEqual(["v1"]);
  });

  it("bills a monthly contract once the month is over", () => {
    const items = contractInvoicesDue({ contracts: [{ ...contract, billingSchedule: "MONTHLY" }], appointments: [visit("v1", "2026-08-05"), visit("v2", "2026-08-20"), visit("v3", "2026-09-05")] }, now);
    expect(items).toHaveLength(1);
    expect(items[0].visits.map((entry) => entry.id)).toEqual(["v1", "v2"]);
  });

  it("bills an up-front contract once, for every visit", () => {
    const upfront = { ...contract, billingSchedule: "UPFRONT" };
    const items = contractInvoicesDue({ contracts: [upfront] }, now);
    expect(items).toHaveLength(1);
    expect(items[0].lines[0]).toMatchObject({ quantity: 4, unitPrice: 3000 });
    const issued = [{ id: "i1", contractId: "k1", status: "ISSUED" }];
    expect(contractInvoicesDue({ contracts: [upfront], invoices: issued }, now)).toHaveLength(0);
    expect(prepaidPlanIds([upfront], issued)).toEqual(new Set(["p1"]));
    expect(prepaidPlanIds([upfront], [{ ...issued[0], status: "VOID" }]).size).toBe(0);
  });
});

describe("isInspectionVisit", () => {
  it("knows an inspection by its service or its results", () => {
    expect(isInspectionVisit({ serviceType: "Inspection" })).toBe(true);
    expect(isInspectionVisit({ serviceType: "Termite Control" }, [termite])).toBe(false);
    expect(isInspectionVisit({ serviceType: "Termite Control", inspectionAreaSqm: 120 })).toBe(true);
  });
});

describe("gmail", () => {
  it("builds a compose link with the draft filled in", () => {
    const url = new URL(gmailComposeUrl({ to: "juan@example.com", subject: "Invoice TPC-INV-00001", body: "Hello" }));
    expect(url.host).toBe("mail.google.com");
    expect(url.searchParams.get("to")).toBe("juan@example.com");
    expect(url.searchParams.get("su")).toBe("Invoice TPC-INV-00001");
  });

  it("writes the message for each document", () => {
    const email = documentEmail("INVOICE", { reference: "TPC-INV-00001", amountDue: 5000, dueOn: "2026-10-15" }, juan);
    expect(email.subject).toMatch(/TPC-INV-00001/);
    expect(email.body).toMatch(/Good day Juan Dela Cruz/);
    expect(email.body).toMatch(/attached as a PDF/);
    expect(documentEmail("QUOTE", { reference: "TPC-Q-00001", total: 8000, depositAmount: 2000 }, juan).body).toMatch(/down payment/);
  });
});

describe("Charge all materials", () => {
  const gloves = { id: "g", name: "Nitrile Gloves", unit: "box", cost: 100, priceMode: "FIXED", customerPrice: 150 };

  it("charges everything used, with nothing included", () => {
    expect(materialCharge({ billingMode: BILLING_MODES.CHARGE_ALL, defaultAmount: 10 }, 4, gloves)).toMatchObject({ extraQuantity: 4, amount: 600 });
    expect(materialCharge({ billingMode: BILLING_MODES.EXTRA_CHARGED, defaultAmount: 10 }, 4, gloves).amount).toBe(0);
  });

  it("names a Charge all material apart from what is included", () => {
    const service = { materials: [{ itemId: "g", defaultAmount: 2, billingMode: BILLING_MODES.CHARGE_ALL }] };
    expect(includedMaterialsText(service, () => gloves)).toBe("Nitrile Gloves charged per use");
  });
});
