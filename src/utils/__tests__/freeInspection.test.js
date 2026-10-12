// Sprint 5: the inspection is part of the service, at no charge.
import { draftInvoiceLines, inspectionIncludedText } from "../billing";
import { jobTimeline } from "../jobStatus";

const inspection = { id: "i1", reference: "TPC-V-00038", scheduledAt: "2026-10-14T09:00:00", reportSubmittedAt: "2026-10-14T10:30:00", inspectionAreaSqm: 120 };
const quote = { id: "q1", reference: "TPC-Q-00030", status: "APPROVED", inspectionId: "i1", lines: [{ kind: "SERVICE", serviceId: "s1", description: "Termite Soil Treatment", quantity: 1, unitPrice: 18000 }] };

test("the quote says the inspection is included", () => {
  expect(inspectionIncludedText(inspection)).toMatch(/^Includes free site inspection \(TPC-V-00038, Oct 14, 2026\)$/);
  expect(inspectionIncludedText(null)).toBe("");
});

test("the invoice lists the inspection at ₱0 before the quote's lines", () => {
  const lines = draftInvoiceLines({ quote, inspection });
  expect(lines[0]).toMatchObject({ description: "Site inspection (TPC-V-00038): included", unitPrice: 0, quantity: 1 });
  expect(lines[1]).toMatchObject({ description: "Termite Soil Treatment", unitPrice: 18000 });
  // A quote already invoiced does not repeat it, and no inspection adds nothing.
  expect(draftInvoiceLines({ quote, inspection, quoteInvoiced: true })).toHaveLength(0);
  expect(draftInvoiceLines({ quote })).toHaveLength(1);
});

test("the job timeline starts with the free inspection", () => {
  const visit = { id: "v1", reference: "TPC-V-00040", scheduledAt: "2026-10-20T09:00:00", createdAt: "2026-10-16T09:00:00", status: "Confirmed" };
  const steps = jobTimeline(visit, { quote: { ...quote, sentAt: "2026-10-15T09:00:00" }, inspection });
  expect(steps[0]).toMatchObject({ label: "Site inspection TPC-V-00038 (free)", detail: "120 sqm", done: true });
});
