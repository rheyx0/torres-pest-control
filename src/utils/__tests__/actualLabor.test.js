// Sprint 5: the invoice's Labor follows the crew that actually came.
import { actualTechnicianDays, draftInvoiceLines } from "../billing";

const quote = { id: "q1", status: "APPROVED", lines: [
  { kind: "SERVICE", serviceId: "s1", description: "Termite Soil Treatment", quantity: 1, unitPrice: 18000 },
  { kind: "EXTRA", unit: "technician-day", description: "Labor (2 technicians × 3 days)", quantity: 6, unitPrice: 1000 },
] };
const day = (date, crew) => ({ id: date, quoteId: "q1", status: "Completed", scheduledAt: `${date}T09:00:00`, technicianIds: crew });
const visits = [day("2026-10-14", ["a", "b", "c"]), day("2026-10-12", ["a", "b"]), day("2026-10-13", ["a", "b", "c"])];

test("technician-days are each visit's crew, in date order", () => {
  expect(actualTechnicianDays(visits)).toEqual({ perVisit: [2, 3, 3], total: 8 });
  expect(actualTechnicianDays([{ ...visits[0], warrantyKind: "CHECKUP" }])).toEqual({ perVisit: [], total: 0 });
});

test("the Labor line is the actual figure, with the quoted one beside it", () => {
  const lines = draftInvoiceLines({ quote, visits });
  expect(lines[1]).toMatchObject({ description: "Labor (8 technician-days: 2 + 3 + 3) · quoted 2 × 3", quantity: 8, unitPrice: 1000 });
  // No visit ticked yet: the quoted figure stays.
  expect(draftInvoiceLines({ quote, visits: [] })[1]).toMatchObject({ quantity: 6, description: "Labor (2 technicians × 3 days)" });
});
