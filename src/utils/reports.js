// The Reports page (Sprint 4): three reports over a date range, worked out
// from the lists already loaded, plus CSV export. Pure, unit-tested.
//
//   salesReport        invoiced, collected, outstanding and overdue; by client
//                      and by service
//   stockUsageReport   what visits used, and what it cost, item by item
//   technicianReport   each technician's visits, reports and signatures
//   toCsv              any of their tables as CSV text
//
// A range is { from, to } as "YYYY-MM-DD", both days included.

import { invoiceBalance, paymentCounts } from "./billing";
import { dayKey, isPlausibleMovement } from "./dashboardMetrics";
import { crewOf, endOf } from "./scheduling";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const inRange = (key, { from, to }) => Boolean(key) && (!from || key >= from) && (!to || key <= to);

/** Common ranges for the date picker, as { from, to }. */
export function presetRange(preset, now = new Date()) {
  const key = (date) => dayKey(date);
  const year = now.getFullYear();
  const month = now.getMonth();
  if (preset === "LAST_MONTH") return { from: key(new Date(year, month - 1, 1)), to: key(new Date(year, month, 0)) };
  if (preset === "THIS_YEAR") return { from: key(new Date(year, 0, 1)), to: key(now) };
  if (preset === "LAST_30") return { from: key(new Date(year, month, now.getDate() - 29)), to: key(now) };
  return { from: key(new Date(year, month, 1)), to: key(now) }; // THIS_MONTH
}

// ---------------------------------------------------------------------------
// Sales and collections.
// ---------------------------------------------------------------------------

/**
 * Invoices issued in the range (void ones left out), money received in the
 * range (down payments too; a check only once cleared), what is still owed on
 * those invoices, and how much of it is past due.
 */
export function salesReport({ invoices = [], payments = [], clients = [], services = [] } = {}, range, now = new Date()) {
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const serviceName = new Map(services.map((service) => [service.id, service.name]));
  const issued = invoices.filter((invoice) => invoice.status !== "VOID" && inRange(invoice.issuedOn, range));
  const received = payments.filter((payment) => paymentCounts(payment) && inRange(payment.paidOn, range));

  const totals = { invoices: issued.length, invoiced: 0, collected: 0, outstanding: 0, overdue: 0 };
  const byClient = new Map();
  const clientRow = (id) => {
    if (!byClient.has(id)) byClient.set(id, { clientId: id, client: clientName.get(id) || "Unknown client", invoices: 0, invoiced: 0, collected: 0, balance: 0 });
    return byClient.get(id);
  };

  issued.forEach((invoice) => {
    const balance = invoiceBalance(invoice, payments, now);
    totals.invoiced += invoice.total;
    totals.outstanding += balance.balance;
    if (balance.state === "OVERDUE") totals.overdue += balance.balance;
    const row = clientRow(invoice.clientId);
    row.invoices += 1;
    row.invoiced += invoice.total;
    row.balance += balance.balance;
  });
  received.forEach((payment) => {
    totals.collected += payment.amount;
    clientRow(payment.clientId).collected += payment.amount;
  });

  const byService = new Map();
  issued.forEach((invoice) => invoice.lines.forEach((line) => {
    const name = line.kind === "SERVICE"
      ? serviceName.get(line.serviceId) || String(line.description).split(" · ")[0]
      : line.kind === "MATERIAL" ? "Materials" : "Extra work";
    if (!byService.has(name)) byService.set(name, { service: name, lines: 0, amount: 0 });
    const row = byService.get(name);
    row.lines += 1;
    row.amount += line.amount;
  }));

  const money = (row, keys) => keys.forEach((field) => { row[field] = round2(row[field]); });
  money(totals, ["invoiced", "collected", "outstanding", "overdue"]);
  const clientRows = [...byClient.values()].map((row) => { money(row, ["invoiced", "collected", "balance"]); return row; })
    .sort((a, b) => b.invoiced - a.invoiced || b.collected - a.collected);
  const serviceRows = [...byService.values()].map((row) => { money(row, ["amount"]); return row; })
    .sort((a, b) => b.amount - a.amount);
  return { totals, byClient: clientRows, byService: serviceRows };
}

/**
 * Money received in the range, month by month (every month in the range, so
 * a month with nothing shows as nothing): [{ month: "YYYY-MM", label, value }].
 */
export function collectionsByMonth(payments = [], range) {
  const totals = new Map();
  if (range?.from && range?.to) {
    const cursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00`);
    const last = range.to.slice(0, 7);
    for (let guard = 0; guard < 60; guard += 1) {
      const month = dayKey(cursor).slice(0, 7);
      if (month > last) break;
      totals.set(month, 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  payments
    .filter((payment) => paymentCounts(payment) && inRange(payment.paidOn, range))
    .forEach((payment) => {
      const month = String(payment.paidOn).slice(0, 7);
      totals.set(month, (totals.get(month) || 0) + (Number(payment.amount) || 0));
    });
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({
      month,
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString([], { month: "short", year: "numeric" }),
      value: round2(value),
    }));
}

// ---------------------------------------------------------------------------
// Stock usage.
// ---------------------------------------------------------------------------

/**
 * What visits used in the range: every stock-out recorded against a visit
 * (checkouts to a technician are custody, not use, so they are left out),
 * item by item, costed at what the movement recorded. Rows the system could
 * not accept today (migration 058) are skipped from the cost.
 */
export function stockUsageReport({ movements = [], inventory = [] } = {}, range) {
  const itemById = new Map(inventory.map((item) => [item.id, item]));
  const used = movements.filter((movement) => movement.movementType === "OUT" && movement.appointmentId && inRange(String(movement.movementDate).slice(0, 10), range));
  const byItem = new Map();
  used.forEach((movement) => {
    const item = itemById.get(movement.itemId);
    if (!byItem.has(movement.itemId)) {
      byItem.set(movement.itemId, { itemId: movement.itemId, item: item?.name || movement.itemName || "Unknown item", unit: item?.unit || movement.itemUnit || "", type: item?.type || "", quantity: 0, cost: 0, visits: new Set() });
    }
    const row = byItem.get(movement.itemId);
    row.quantity += Number(movement.amount) || 0;
    if (isPlausibleMovement(movement)) row.cost += Number(movement.totalCost) || 0;
    row.visits.add(movement.appointmentId);
  });
  const rows = [...byItem.values()]
    .map((row) => ({ ...row, quantity: Math.round(row.quantity * 1000) / 1000, cost: round2(row.cost), visits: row.visits.size }))
    .sort((a, b) => b.cost - a.cost || b.quantity - a.quantity);
  const visits = new Set(used.map((movement) => movement.appointmentId));
  return {
    totals: { items: rows.length, cost: round2(rows.reduce((sum, row) => sum + row.cost, 0)), visits: visits.size },
    rows,
  };
}

// ---------------------------------------------------------------------------
// Technician performance.
// ---------------------------------------------------------------------------

/**
 * For each technician, their visits in the range (as lead or crew; cancelled
 * ones left out): how many were completed, reports filed within 24 hours of
 * the visit ending, reports filed late, reports still missing on visits that
 * have ended, and reports filed without the customer's signature.
 */
export function technicianReport({ appointments = [], users = [] } = {}, range, now = new Date()) {
  const technicians = users.filter((user) => user.role === "TECHNICIAN");
  const visits = appointments.filter((visit) => visit.status !== "Cancelled" && inRange(dayKey(visit.scheduledAt), range));
  const rows = technicians.map((technician) => {
    const mine = visits.filter((visit) => crewOf(visit).includes(technician.id));
    const ended = mine.filter((visit) => endOf(visit) <= now.getTime());
    const filed = mine.filter((visit) => visit.reportSubmitted);
    const onTime = filed.filter((visit) => visit.reportSubmittedAt && new Date(visit.reportSubmittedAt).getTime() <= endOf(visit) + 24 * 3600000);
    return {
      technicianId: technician.id,
      technician: technician.name || technician.username || "Technician",
      visits: mine.length,
      completed: mine.filter((visit) => visit.status === "Completed").length,
      reportsOnTime: onTime.length,
      reportsLate: filed.length - onTime.length,
      reportsMissing: ended.filter((visit) => !visit.reportSubmitted).length,
      missingSignature: filed.filter((visit) => !visit.signaturePath && !visit.completionNote).length,
    };
  }).sort((a, b) => b.completed - a.completed || b.visits - a.visits);
  return {
    totals: {
      visits: rows.reduce((sum, row) => sum + row.visits, 0),
      completed: rows.reduce((sum, row) => sum + row.completed, 0),
      reportsMissing: rows.reduce((sum, row) => sum + row.reportsMissing, 0),
    },
    rows,
  };
}

// ---------------------------------------------------------------------------
// Export.
// ---------------------------------------------------------------------------

/** CSV text for `rows`, with `columns` = [{ key, label }]; quotes where needed. */
export function toCsv(rows, columns) {
  const cell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map((column) => cell(column.label)).join(","), ...rows.map((row) => columns.map((column) => cell(row[column.key])).join(","))].join("\n");
}
