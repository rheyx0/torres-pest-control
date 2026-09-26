import { billingSummary, depositToApply, draftInvoiceLines, dueDateFor, invoiceBalance, visitMaterialLines, invoiceableVisits } from "../billing";

const pay = (fields) => ({ id: Math.random().toString(36), kind: "PAYMENT", invoiceId: "inv1", method: "CASH", amount: 0, ...fields });

describe("dueDateFor", () => {
  test("adds the terms' days to the issue date", () => {
    expect(dueDateFor("2026-09-26", "DUE_ON_RECEIPT")).toBe("2026-09-26");
    expect(dueDateFor("2026-09-26", "NET_15")).toBe("2026-10-11");
    expect(dueDateFor("2026-12-20", "NET_30")).toBe("2027-01-19");
  });
});

describe("invoiceBalance", () => {
  const invoice = { id: "inv1", status: "ISSUED", amountDue: 3000, dueOn: "2026-10-11" };
  const before = new Date(2026, 9, 1);
  const after = new Date(2026, 9, 20);

  test("unpaid, partly paid, paid", () => {
    expect(invoiceBalance(invoice, [], before)).toMatchObject({ state: "UNPAID", balance: 3000 });
    expect(invoiceBalance(invoice, [pay({ amount: 1000 })], before)).toMatchObject({ state: "PARTIAL", paid: 1000, balance: 2000 });
    expect(invoiceBalance(invoice, [pay({ amount: 1000 }), pay({ amount: 2000, method: "GCASH" })], before)).toMatchObject({ state: "PAID", balance: 0 });
  });

  test("past the due date with a balance is overdue, even if partly paid", () => {
    expect(invoiceBalance(invoice, [], after).state).toBe("OVERDUE");
    expect(invoiceBalance(invoice, [pay({ amount: 1000 })], after).state).toBe("OVERDUE");
    expect(invoiceBalance(invoice, [pay({ amount: 3000 })], after).state).toBe("PAID");
  });

  test("a pending check isn't paid yet; a bounced one puts the balance back", () => {
    expect(invoiceBalance(invoice, [pay({ amount: 3000, method: "CHECK", checkStatus: "PENDING" })], before)).toMatchObject({ state: "UNPAID", pending: 3000, balance: 3000 });
    expect(invoiceBalance(invoice, [pay({ amount: 3000, method: "CHECK", checkStatus: "BOUNCED" })], before)).toMatchObject({ state: "UNPAID", balance: 3000 });
    expect(invoiceBalance(invoice, [pay({ amount: 3000, method: "CHECK", checkStatus: "CLEARED" })], before).state).toBe("PAID");
  });

  test("reversed payments and other invoices' payments don't count", () => {
    expect(invoiceBalance(invoice, [pay({ amount: 3000, reversedAt: "2026-09-30" })], before).balance).toBe(3000);
    expect(invoiceBalance(invoice, [pay({ amount: 3000, invoiceId: "other" })], before).balance).toBe(3000);
  });

  test("a void invoice is void", () => {
    expect(invoiceBalance({ ...invoice, status: "VOID" }, [], after).state).toBe("VOID");
  });
});

describe("depositToApply", () => {
  const quote = { id: "q1", depositAmount: 1400 };
  const deposit = (amount, fields) => ({ id: Math.random().toString(36), kind: "DEPOSIT", quoteId: "q1", method: "CASH", amount, ...fields });

  test("the down payment received comes off the invoice", () => {
    expect(depositToApply(quote, [deposit(1400)], [], 2800)).toBe(1400);
  });

  test("never more than the invoice total", () => {
    expect(depositToApply(quote, [deposit(1400)], [], 1000)).toBe(1000);
  });

  test("only once across the quote's invoices; a void one gives it back", () => {
    expect(depositToApply(quote, [deposit(1400)], [{ quoteId: "q1", status: "ISSUED", depositApplied: 1400 }], 2800)).toBe(0);
    expect(depositToApply(quote, [deposit(1400)], [{ quoteId: "q1", status: "VOID", depositApplied: 1400 }], 2800)).toBe(1400);
  });

  test("an uncleared check isn't deducted, and no quote means nothing", () => {
    expect(depositToApply(quote, [deposit(1400, { method: "CHECK", checkStatus: "PENDING" })], [], 2800)).toBe(0);
    expect(depositToApply(null, [], [], 2800)).toBe(0);
  });
});

const termidor = { id: "i1", name: "Termidor", unit: "L", cost: 1000, priceMode: "MARKUP", markupPercent: 50 };
const itemById = (id) => (id === "i1" ? termidor : null);
const termite = { id: "s1", materials: [{ itemId: "i1", defaultAmount: 2, billingMode: "EXTRA_CHARGED" }] };
const general = { id: "s2", materials: [{ itemId: "i1", defaultAmount: 1, billingMode: "INCLUDED" }] };

describe("visitMaterialLines", () => {
  const visit = (used, extra = []) => ({ id: "a1", reference: "TPC-V-00007", stockUsed: [{ itemId: "i1", amount: used }, ...extra] });

  test("charges only what was used beyond the included amount, at the customer price", () => {
    const [line] = visitMaterialLines(visit(3.5), [termite], itemById);
    expect(line).toMatchObject({ kind: "MATERIAL", itemId: "i1", appointmentId: "a1", quantity: 1.5, unitPrice: 1500 });
    expect(line.description).toBe("Termidor: 3.5 L used, 2 L included, extra charged · TPC-V-00007");
  });

  test("within the included amount, or an Included material: listed at ₱0", () => {
    expect(visitMaterialLines(visit(2), [termite], itemById)).toEqual([expect.objectContaining({ quantity: 2, unitPrice: 0, description: "Termidor (included) · TPC-V-00007" })]);
    expect(visitMaterialLines(visit(9), [general], itemById)).toEqual([expect.objectContaining({ quantity: 9, unitPrice: 0 })]);
  });

  test("an item not in the service is listed at ₱0 for the office to price", () => {
    expect(visitMaterialLines(visit(1), [], itemById)).toEqual([expect.objectContaining({ quantity: 1, unitPrice: 0, description: "Termidor (used, not in the service) · TPC-V-00007" })]);
  });

  test("one line per item, however many stock-out rows it came from; unknown items skipped", () => {
    const lines = visitMaterialLines(visit(1, [{ itemId: "i1", amount: 2.5 }, { itemId: "gone", amount: 4 }]), [termite], itemById);
    expect(lines).toEqual([expect.objectContaining({ quantity: 1.5, unitPrice: 1500 })]);
  });
});

describe("draftInvoiceLines", () => {
  const quote = { id: "q1", lines: [{ kind: "SERVICE", serviceId: "s1", description: "Termite treatment", quantity: 1, unit: "job", unitPrice: 4000 }] };
  const visit = { id: "a1", reference: "TPC-V-00007", serviceType: "Termite treatment", serviceId: "s1", price: 4000, stockUsed: [] };
  const extras = [
    { id: "e1", appointmentId: "a1", status: "APPROVED", description: "Storage room", quantity: 1, unit: "room", unitPrice: 800 },
    { id: "e2", appointmentId: "a1", status: "PROPOSED", description: "Garage", quantity: 1, unitPrice: 500 },
    { id: "e3", appointmentId: "a1", status: "APPROVED", description: "Already billed", quantity: 1, unitPrice: 100, invoiceId: "inv0" },
  ];

  test("from a quote: its lines plus approved extras not yet invoiced", () => {
    const lines = draftInvoiceLines({ quote, visits: [visit], extras });
    expect(lines.map((line) => line.description)).toEqual(["Termite treatment", "Storage room"]);
    expect(lines[1]).toMatchObject({ kind: "EXTRA", extraId: "e1", unitPrice: 800 });
  });

  test("a quote already invoiced once doesn't repeat its lines", () => {
    expect(draftInvoiceLines({ quote, quoteInvoiced: true, visits: [visit], extras }).map((line) => line.description)).toEqual(["Storage room"]);
  });

  test("without a quote: each visit at its booked price; a day with no price adds no line", () => {
    const lines = draftInvoiceLines({ visits: [visit, { ...visit, id: "a2", price: null }] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "SERVICE", appointmentId: "a1", quantity: 1, unitPrice: 4000 });
    expect(lines[0].description).toBe("Termite treatment · TPC-V-00007");
  });

  test("extra materials are added from the visit's usage", () => {
    const used = { ...visit, stockUsed: [{ itemId: "i1", amount: 3 }] };
    const lines = draftInvoiceLines({ quote, visits: [used], servicesFor: () => [termite], itemById });
    expect(lines.map((line) => line.kind)).toEqual(["SERVICE", "MATERIAL"]);
  });
});

test("invoiceableVisits: this client's completed visits not on an invoice", () => {
  const visits = [
    { id: "a1", clientId: "c1", status: "Completed" },
    { id: "a2", clientId: "c1", status: "Confirmed" },
    { id: "a3", clientId: "c1", status: "Completed", invoiceId: "inv1" },
    { id: "a4", clientId: "c2", status: "Completed" },
  ];
  expect(invoiceableVisits(visits, "c1").map((visit) => visit.id)).toEqual(["a1"]);
});

describe("billingSummary", () => {
  const now = new Date(2026, 9, 20); // Oct 20
  const quotes = [
    { id: "q1", status: "SENT", validUntil: "2026-11-01", total: 5000, createdAt: "2026-09-01T00:00:00Z" },
    { id: "q2", status: "SENT", validUntil: "2026-10-01", total: 9000, createdAt: "2026-09-02T00:00:00Z" }, // expired
    { id: "q3", status: "APPROVED", validUntil: "2026-11-01", total: 4000, depositAmount: 2000, createdAt: "2026-09-03T00:00:00Z" },
  ];
  const invoices = [
    { id: "i1", status: "ISSUED", amountDue: 3000, dueOn: "2026-10-01", createdAt: "2026-09-20T00:00:00Z" }, // overdue
    { id: "i2", status: "ISSUED", amountDue: 1000, dueOn: "2026-11-01", createdAt: "2026-10-05T00:00:00Z" },
    { id: "i3", status: "VOID", amountDue: 7000, dueOn: "2026-10-01", createdAt: "2026-10-06T00:00:00Z" },
  ];
  const payments = [
    { id: "p1", kind: "PAYMENT", invoiceId: "i1", method: "CASH", amount: 500, paidOn: "2026-10-03" },
    { id: "p2", kind: "DEPOSIT", quoteId: "q3", method: "GCASH", amount: 800, paidOn: "2026-09-10" }, // last month
    { id: "p3", kind: "PAYMENT", invoiceId: "i2", method: "CHECK", checkStatus: "PENDING", amount: 1000, paidOn: "2026-10-10" },
  ];
  const appointments = [
    { id: "a1", status: "Completed", scheduledAt: "2026-10-02T09:00:00" },
    { id: "a2", status: "Completed", scheduledAt: "2026-10-03T09:00:00", invoiceId: "i1" },
    { id: "a3", status: "Completed", scheduledAt: "2026-08-01T09:00:00" }, // before billing began
    { id: "a4", status: "Confirmed", scheduledAt: "2026-10-25T09:00:00" },
  ];
  const summary = billingSummary({ quotes, invoices, payments, appointments }, now);

  test("outstanding and overdue balances skip void and paid invoices", () => {
    expect(summary.outstanding).toEqual({ count: 2, amount: 3500 });
    expect(summary.overdue).toEqual({ count: 1, amount: 2500 });
  });

  test("collected counts this month's cleared money; pending checks are separate", () => {
    expect(summary.collected).toEqual({ count: 1, amount: 500 });
    expect(summary.pendingChecks).toEqual({ count: 1, amount: 1000 });
  });

  test("quotes waiting, down payments due, visits to invoice", () => {
    expect(summary.awaiting).toEqual({ count: 1, amount: 5000 });
    expect(summary.depositsDue).toEqual({ count: 1, amount: 1200 });
    expect(summary.toInvoice.count).toBe(1);
  });

  test("before any billing there is nothing to invoice", () => {
    expect(billingSummary({ appointments }, now).toInvoice.count).toBe(0);
  });
});
