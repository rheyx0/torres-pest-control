import { clientNow, jobTimeline } from "../jobStatus";
import { checkoutBalances } from "../custody";

const now = new Date("2026-10-03T10:00:00");
const nameOf = (id) => ({ t1: "Karl Hameed" })[id] || "";

describe("clientNow", () => {
  it("leads with what is happening today", () => {
    const visits = [
      { id: "v1", status: "In progress", scheduledAt: "2026-10-03T08:00:00", serviceType: "Termite Control", technicianIds: ["t1"] },
      { id: "v2", status: "Confirmed", scheduledAt: "2026-10-03T15:00:00", serviceType: "Inspection", technicianIds: [] },
    ];
    const notes = clientNow({ visits, nameOf }, now);
    expect(notes[0].text).toBe("Termite Control in progress now · Karl Hameed on site");
    expect(notes[1].text).toMatch(/^Visit today at .* · Inspection · no technician yet$/);
  });

  it("says what the client or the office is waiting on", () => {
    const visits = [{ id: "v1", reference: "TPC-V-00022", status: "Completed", scheduledAt: "2026-09-20T09:00:00", reportSubmitted: true }];
    const quotes = [{ id: "q1", reference: "TPC-Q-00013", clientId: "c1", status: "APPROVED", depositAmount: 2240, total: 11200 }];
    const invoices = [{ id: "i1", reference: "TPC-INV-00012", amountDue: 5000, dueOn: "2026-09-25", status: "ISSUED" }];
    const texts = clientNow({ visits, quotes, invoices, nameOf }, now, 10).map((note) => note.text);
    expect(texts).toContain("Invoice TPC-INV-00012 is overdue · ₱5,000.00 still owed");
    expect(texts).toContain("TPC-V-00022 is done, not invoiced yet");
    expect(texts.some((text) => text.startsWith("Quotation TPC-Q-00013 approved · waiting for the down payment"))).toBe(true);
  });

  it("is empty when nothing is open", () => {
    expect(clientNow({ visits: [] }, now)).toEqual([]);
  });
});

describe("jobTimeline", () => {
  it("tells one job from quotation to payment, then what is left", () => {
    const visit = { id: "v1", reference: "TPC-V-00022", status: "Completed", createdAt: "2026-09-10T08:00:00", scheduledAt: "2026-09-12T09:00:00", startedAt: "2026-09-12T09:05:00", reportSubmitted: true, reportSubmittedAt: "2026-09-12T11:00:00", signedAt: "2026-09-12T11:00:00", customerName: "Juan Dela Cruz" };
    const quote = { id: "q1", reference: "TPC-Q-00013", status: "APPROVED", sentAt: "2026-09-05T10:00:00", decidedAt: "2026-09-06T10:00:00", total: 11200 };
    const invoice = { id: "i1", reference: "TPC-INV-00012", issuedOn: "2026-09-13", amountDue: 8960, status: "ISSUED" };
    const payments = [{ id: "p1", quoteId: "q1", kind: "DEPOSIT", method: "CASH", amount: 2240, paidOn: "2026-09-07", reference: "TPC-R-00001" }];
    const history = [{ fromStatus: "Pending", toStatus: "Confirmed", changedAt: "2026-09-11T09:00:00", changedByName: "Von" }];
    const steps = jobTimeline(visit, { quote, invoice, payments, statusHistory: history, nameOf });
    expect(steps.map((step) => step.label)).toEqual([
      "Quotation TPC-Q-00013 sent",
      "Quotation TPC-Q-00013 approved",
      "Down payment received",
      "Booked TPC-V-00022",
      "Pending → Confirmed",
      "Started on site",
      "Report filed",
      "Signed by the customer",
      "Invoiced on TPC-INV-00012",
      "Payment still owed",
    ]);
    expect(steps.at(-1)).toMatchObject({ done: false, detail: "₱8,960.00" });
  });

  it("shows a visit not done yet as still to come", () => {
    const steps = jobTimeline({ id: "v2", reference: "TPC-V-00030", status: "Confirmed", createdAt: "2026-10-01T08:00:00", scheduledAt: "2026-10-05T09:00:00" });
    expect(steps.map((step) => [step.label, step.done])).toEqual([["Booked TPC-V-00030", true], ["Visit to be done", false], ["To be invoiced", false]]);
  });
});

describe("lost stock while with a technician", () => {
  it("closes the checkout without counting as used or returned", () => {
    const movements = [
      { id: "c1", stockOutReason: "TECHNICIAN_CHECKOUT", amount: 10, movementType: "OUT", movementDate: "2026-10-01" },
      { id: "m1", checkoutId: "c1", movementType: "OUT", amount: 2 },
      { id: "m2", checkoutId: "c1", movementType: "RETURN", amount: 3 },
      { id: "m3", checkoutId: "c1", movementType: "OUT", stockOutReason: "MISSING", amount: 1 },
    ];
    expect(checkoutBalances(movements)[0]).toMatchObject({ used: 2, returned: 3, lost: 1, remaining: 4 });
  });
});
