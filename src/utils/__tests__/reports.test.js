import { presetRange, salesReport, stockUsageReport, technicianReport, toCsv } from "../reports";

const now = new Date("2026-09-28T10:00:00");
const september = { from: "2026-09-01", to: "2026-09-30" };

describe("presetRange", () => {
  it("gives the common periods", () => {
    expect(presetRange("THIS_MONTH", now)).toEqual({ from: "2026-09-01", to: "2026-09-28" });
    expect(presetRange("LAST_MONTH", now)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("THIS_YEAR", now)).toEqual({ from: "2026-01-01", to: "2026-09-28" });
    expect(presetRange("LAST_30", now)).toEqual({ from: "2026-08-30", to: "2026-09-28" });
  });
});

describe("salesReport", () => {
  const clients = [{ id: "c1", name: "Juan Dela Cruz" }, { id: "c2", name: "Arawan Logistics Center" }];
  const services = [{ id: "s1", name: "Termite Control" }];
  const invoices = [
    { id: "i1", clientId: "c1", issuedOn: "2026-09-02", dueOn: "2026-09-17", total: 5000, amountDue: 5000, status: "ISSUED", lines: [{ kind: "SERVICE", serviceId: "s1", amount: 4500 }, { kind: "MATERIAL", amount: 500 }] },
    { id: "i2", clientId: "c2", issuedOn: "2026-09-20", dueOn: "2026-10-20", total: 8000, amountDue: 8000, status: "ISSUED", lines: [{ kind: "SERVICE", serviceId: "s1", amount: 8000 }] },
    { id: "i3", clientId: "c2", issuedOn: "2026-09-21", total: 999, amountDue: 999, status: "VOID", lines: [] },
    { id: "i4", clientId: "c1", issuedOn: "2026-08-10", total: 700, amountDue: 700, status: "ISSUED", lines: [] },
  ];
  const payments = [
    { invoiceId: "i2", clientId: "c2", kind: "PAYMENT", method: "CASH", amount: 3000, paidOn: "2026-09-21" },
    { invoiceId: "i1", clientId: "c1", kind: "PAYMENT", method: "CHECK", checkStatus: "PENDING", amount: 5000, paidOn: "2026-09-22" },
  ];

  it("totals invoiced, collected, owed and overdue in the period", () => {
    const { totals } = salesReport({ invoices, payments, clients, services }, september, now);
    expect(totals).toEqual({ invoices: 2, invoiced: 13000, collected: 3000, outstanding: 10000, overdue: 5000 });
  });

  it("breaks it down by client and by service", () => {
    const { byClient, byService } = salesReport({ invoices, payments, clients, services }, september, now);
    expect(byClient.map((row) => [row.client, row.invoiced, row.collected, row.balance])).toEqual([
      ["Arawan Logistics Center", 8000, 3000, 5000],
      ["Juan Dela Cruz", 5000, 0, 5000],
    ]);
    expect(byService).toEqual([{ service: "Termite Control", lines: 2, amount: 12500 }, { service: "Materials", lines: 1, amount: 500 }]);
  });
});

describe("stockUsageReport", () => {
  it("counts what visits used, not checkouts, by item", () => {
    const inventory = [{ id: "d", name: "Demand CS Residual Spray", unit: "L" }];
    const movements = [
      { itemId: "d", movementType: "OUT", appointmentId: "v1", amount: 2, totalCost: 4800, movementDate: "2026-09-05" },
      { itemId: "d", movementType: "OUT", appointmentId: "v2", amount: 1, totalCost: 2400, movementDate: "2026-09-12" },
      { itemId: "d", movementType: "OUT", appointmentId: null, amount: 5, totalCost: 12000, movementDate: "2026-09-12" },
      { itemId: "d", movementType: "OUT", appointmentId: "v3", amount: 1, totalCost: 2400, movementDate: "2026-08-12" },
    ];
    const { totals, rows } = stockUsageReport({ movements, inventory }, september);
    expect(totals).toEqual({ items: 1, cost: 7200, visits: 2 });
    expect(rows[0]).toMatchObject({ item: "Demand CS Residual Spray", quantity: 3, unit: "L", visits: 2 });
  });
});

describe("technicianReport", () => {
  it("counts each technician's visits and reports", () => {
    const users = [{ id: "t1", name: "Tech One", role: "TECHNICIAN" }, { id: "a1", name: "Admin", role: "ADMIN" }];
    const appointments = [
      { id: "v1", technicianIds: ["t1"], status: "Completed", scheduledAt: "2026-09-05T09:00:00", reportSubmitted: true, reportSubmittedAt: "2026-09-05T12:00:00", signaturePath: "x.png" },
      { id: "v2", technicianIds: ["t1"], status: "Completed", scheduledAt: "2026-09-06T09:00:00", reportSubmitted: true, reportSubmittedAt: "2026-09-10T12:00:00" },
      { id: "v3", technicianIds: ["t1"], status: "Confirmed", scheduledAt: "2026-09-07T09:00:00" },
      { id: "v4", technicianIds: ["t1"], status: "Cancelled", scheduledAt: "2026-09-08T09:00:00" },
    ];
    const { rows } = technicianReport({ appointments, users }, september, now);
    expect(rows).toEqual([{ technicianId: "t1", technician: "Tech One", visits: 3, completed: 2, reportsOnTime: 1, reportsLate: 1, reportsMissing: 1, missingSignature: 1 }]);
  });
});

describe("toCsv", () => {
  it("quotes cells that need it", () => {
    expect(toCsv([{ name: 'Juan "JD", Jr.', amount: 5 }], [{ key: "name", label: "Client" }, { key: "amount", label: "Amount" }]))
      .toBe('Client,Amount\n"Juan ""JD"", Jr.",5');
  });
});
