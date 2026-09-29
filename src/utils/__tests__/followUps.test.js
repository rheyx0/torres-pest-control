import { findFollowUpService, followUpPriceFor } from "../sprint4";
import { draftInvoiceLines } from "../billing";

// Migration 068: a follow-up is charged by the treatment the client had, and
// billed under the same quotation.
const termite = { id: "s1", name: "Termite Control", followUpPrice: 800 };
const general = { id: "s2", name: "General Treatment", followUpPrice: null };
const followUpVisit = { id: "s3", name: "Follow-up Visit", defaultPrice: 500, isActive: true };
const original = { id: "v1", serviceIds: ["s1"] };

describe("followUpPriceFor", () => {
  it("uses the follow-up price of the service the client had", () => {
    expect(followUpPriceFor(original, [termite], followUpVisit)).toBe(800);
  });

  it("falls back to the Follow-up Visit service's price for a service with none", () => {
    expect(followUpPriceFor(original, [general], followUpVisit)).toBe(500);
    expect(followUpPriceFor(original, [termite, general], followUpVisit)).toBe(1300);
  });

  it("leaves the price empty when nothing is priced", () => {
    expect(followUpPriceFor(original, [general], null)).toBeNull();
    expect(followUpPriceFor(null, [termite], followUpVisit)).toBeNull();
  });

  it("finds the Follow-up Visit service by name", () => {
    expect(findFollowUpService([termite, followUpVisit])?.id).toBe("s3");
    expect(findFollowUpService([termite, { ...followUpVisit, isActive: false }])).toBeNull();
  });
});

describe("draftInvoiceLines with a follow-up", () => {
  const quote = { id: "q1", lines: [{ kind: "SERVICE", serviceId: "s1", description: "Termite Control", quantity: 1, unit: "job", unitPrice: 10000 }] };
  const treatment = { id: "v1", reference: "TPC-V-00022", quoteId: "q1", serviceType: "Termite Control", price: 10000 };
  const followUp = { id: "v2", reference: "TPC-V-00031", quoteId: "q1", followUpOf: "v1", serviceId: "s3", serviceType: "Follow-up Visit", price: 800 };

  it("charges the follow-up on top of the quote's lines", () => {
    const lines = draftInvoiceLines({ quote, visits: [treatment, followUp] });
    expect(lines.map((line) => [line.description, line.unitPrice])).toEqual([
      ["Termite Control", 10000],
      ["Follow-up Visit · TPC-V-00031", 800],
    ]);
  });

  it("charges a Follow-up Visit booked without the link, but not other visits twice", () => {
    const unlinked = { id: "v3", reference: "TPC-V-00040", quoteId: "", serviceType: "Follow-up Visit", price: 800 };
    const lines = draftInvoiceLines({ quote, visits: [treatment, unlinked] });
    expect(lines.map((line) => line.description)).toEqual(["Termite Control", "Follow-up Visit · TPC-V-00040"]);
  });

  it("bills a follow-up alone once the quote is invoiced", () => {
    const lines = draftInvoiceLines({ quote, quoteInvoiced: true, visits: [followUp] });
    expect(lines).toEqual([expect.objectContaining({ description: "Follow-up Visit · TPC-V-00031", unitPrice: 800, appointmentId: "v2" })]);
  });
});
