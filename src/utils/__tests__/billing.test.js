import { canBookFromQuote, depositStatus, lineAmount, paymentCounts, quoteStatus, quoteTotals, validUntilFrom } from "../billing";

const lines = [
  { quantity: 2, unitPrice: 1000 },
  { quantity: 1, unitPrice: 500 },
];

describe("quoteTotals", () => {
  test("a line is quantity × price, rounded to centavos", () => {
    expect(lineAmount({ quantity: 3, unitPrice: 33.333 })).toBe(100);
  });

  test("10% discount, 12% VAT added, 50% down payment", () => {
    expect(quoteTotals(lines, { discountType: "PERCENT", discountValue: 10, vatMode: "ADDED", vatRate: 12, depositType: "PERCENT", depositValue: 50 }))
      .toEqual({ subtotal: 2500, discountAmount: 250, vatAmount: 270, total: 2520, depositAmount: 1260 });
  });

  test("VAT inclusive is carved out of the total, not added", () => {
    const totals = quoteTotals([{ quantity: 1, unitPrice: 1120 }], { vatMode: "INCLUSIVE", vatRate: 12 });
    expect(totals.vatAmount).toBe(120);
    expect(totals.total).toBe(1120);
  });

  test("no VAT and a peso discount", () => {
    const totals = quoteTotals(lines, { discountType: "AMOUNT", discountValue: 500, vatMode: "NONE" });
    expect(totals.total).toBe(2000);
    expect(totals.vatAmount).toBe(0);
  });

  test("a peso discount or down payment never exceeds what it comes off", () => {
    const totals = quoteTotals(lines, { discountType: "AMOUNT", discountValue: 9000, vatMode: "NONE", depositType: "AMOUNT", depositValue: 50 });
    expect(totals.discountAmount).toBe(2500);
    expect(totals.total).toBe(0);
    expect(totals.depositAmount).toBe(0);
  });

  test("no down payment by default", () => {
    expect(quoteTotals(lines).depositAmount).toBe(0);
  });
});

describe("quoteStatus", () => {
  const now = new Date(2026, 8, 26);

  test("a sent quote past its validity date is expired", () => {
    expect(quoteStatus({ status: "SENT", validUntil: "2026-09-25" }, now)).toBe("EXPIRED");
  });

  test("valid through the whole of its last day", () => {
    expect(quoteStatus({ status: "SENT", validUntil: "2026-09-26" }, now)).toBe("SENT");
  });

  test("only a sent quote expires", () => {
    expect(quoteStatus({ status: "APPROVED", validUntil: "2026-01-01" }, now)).toBe("APPROVED");
    expect(quoteStatus({ status: "DRAFT", validUntil: "2026-01-01" }, now)).toBe("DRAFT");
  });
});

describe("payments and the down payment", () => {
  const quote = { id: "q1", status: "APPROVED", validUntil: "2099-01-01", depositAmount: 1000 };
  const pay = (fields) => ({ id: Math.random().toString(36), quoteId: "q1", kind: "DEPOSIT", method: "CASH", amount: 0, ...fields });

  test("a check counts only once cleared; a reversed payment never", () => {
    expect(paymentCounts(pay({ method: "CASH" }))).toBe(true);
    expect(paymentCounts(pay({ method: "CHECK", checkStatus: "PENDING" }))).toBe(false);
    expect(paymentCounts(pay({ method: "CHECK", checkStatus: "CLEARED" }))).toBe(true);
    expect(paymentCounts(pay({ method: "CHECK", checkStatus: "BOUNCED" }))).toBe(false);
    expect(paymentCounts(pay({ method: "GCASH", reversedAt: "2026-09-26" }))).toBe(false);
  });

  test("nothing required", () => {
    expect(depositStatus({ ...quote, depositAmount: 0 }, []).state).toBe("NONE");
  });

  test("due, partial, pending check, paid", () => {
    expect(depositStatus(quote, []).state).toBe("DUE");
    expect(depositStatus(quote, [pay({ amount: 400 })])).toMatchObject({ state: "PARTIAL", paid: 400, remaining: 600 });
    expect(depositStatus(quote, [pay({ amount: 400 }), pay({ amount: 600, method: "CHECK", checkStatus: "PENDING" })])).toMatchObject({ state: "PENDING_CHECK", pending: 600 });
    expect(depositStatus(quote, [pay({ amount: 1000, method: "BANK_TRANSFER" })])).toMatchObject({ state: "PAID", remaining: 0 });
  });

  test("another quote's payments and reversed ones don't count", () => {
    expect(depositStatus(quote, [pay({ amount: 1000, quoteId: "other" })]).state).toBe("DUE");
    expect(depositStatus(quote, [pay({ amount: 1000, reversedAt: "2026-09-26" })]).state).toBe("DUE");
  });

  test("booking waits for the down payment to be received and cleared", () => {
    expect(canBookFromQuote(quote, []).ok).toBe(false);
    expect(canBookFromQuote(quote, [pay({ amount: 1000, method: "CHECK", checkStatus: "PENDING" })]).reason).toMatch(/not cleared/);
    expect(canBookFromQuote(quote, [pay({ amount: 1000 })]).ok).toBe(true);
    expect(canBookFromQuote({ ...quote, depositAmount: 0 }, []).ok).toBe(true);
  });

  test("only an approved quote can be booked", () => {
    expect(canBookFromQuote({ ...quote, status: "SENT", depositAmount: 0 }, []).ok).toBe(false);
  });
});

test("validUntilFrom counts days from today", () => {
  expect(validUntilFrom(30, new Date(2026, 8, 26))).toBe("2026-10-26");
  expect(validUntilFrom(7, new Date(2026, 11, 28))).toBe("2027-01-04");
});
