// Reports (Sprint 4, admin and staff, read only): sales and collections, stock usage, and
// technician performance over a date range, each downloadable as Excel (CSV)
// or PDF. Worked out from the lists already loaded (utils/reports.js); the
// PDF prints through BillingPrinter with the company letterhead.

import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import BillingPrinter from "../components/billing/BillingPrinter";
import { Button, Card, DataTable, Input, SegmentedControl } from "../components/ui";
import { RankedBars, StatTile, TileRow } from "../components/dashboard/DashboardParts";
import useClients from "../hooks/useClients";
import useInventory from "../hooks/useInventory";
import useServices from "../hooks/useServices";
import useUsers from "../hooks/useUsers";
import { useOptionalBilling } from "../hooks/useBilling";
import { useScheduling } from "../context/SchedulingContext";
import { colors, pageShell } from "../styles/theme";
import { formatDate, formatPeso } from "../utils/formatters";
import { collectionsByMonth, presetRange, salesReport, stockUsageReport, technicianReport, toCsv } from "../utils/reports";

const REPORTS = [
  { value: "sales", label: "Sales & collections" },
  { value: "stock", label: "Stock usage" },
  { value: "technicians", label: "Technician performance" },
];

const PRESETS = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_30", label: "Last 30 days" },
  { value: "THIS_YEAR", label: "This year" },
];

const peso = (value) => formatPeso(value);

/** Downloads `text` as a file in the browser. */
function download(fileName, text) {
  const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const { clients } = useClients();
  const { inventory, movements = [] } = useInventory();
  const { services } = useServices();
  const { users } = useUsers();
  const { appointments } = useScheduling();
  const billing = useOptionalBilling();

  const [report, setReport] = useState("sales");
  const [preset, setPreset] = useState("THIS_MONTH");
  const [range, setRange] = useState(() => presetRange("THIS_MONTH"));
  const [printRequest, setPrintRequest] = useState(null);

  const choosePreset = (value) => {
    setPreset(value);
    setRange(presetRange(value));
  };
  const setDate = (field) => (event) => {
    setPreset("");
    setRange((current) => ({ ...current, [field]: event.target.value }));
  };

  const period = `${formatDate(range.from)} – ${formatDate(range.to)}`;
  const invoicesOn = Boolean(billing?.invoicesAvailable);

  // Each report: its figures, a chart or two (screen only), and its tables
  // (for the screen, the CSV and the PDF).
  const built = useMemo(() => {
    if (report === "sales") {
      const data = salesReport({ invoices: billing?.invoices || [], payments: billing?.payments || [], clients, services }, range);
      const top = (rows, key, label) => rows.filter((row) => row[key] > 0).slice(0, 5).map((row) => ({ label: row[label], value: row[key] }));
      return {
        title: "Sales & Collections Report",
        charts: [
          { title: "Collected by month", rows: collectionsByMonth(billing?.payments || [], range).map((row) => ({ label: row.label, value: row.value })), format: peso },
          { title: "Top clients by amount invoiced", rows: top(data.byClient, "invoiced", "client"), format: peso },
        ],
        summary: [
          { label: "Invoices issued", value: data.totals.invoices },
          { label: "Invoiced", value: peso(data.totals.invoiced) },
          { label: "Collected", value: peso(data.totals.collected) },
          { label: "Still owed", value: peso(data.totals.outstanding) },
          { label: "Overdue", value: peso(data.totals.overdue) },
        ],
        tables: [
          {
            title: "By client",
            columns: [
              { key: "client", label: "Client" },
              { key: "invoices", label: "Invoices", numeric: true },
              { key: "invoiced", label: "Invoiced", numeric: true, format: peso },
              { key: "collected", label: "Collected", numeric: true, format: peso },
              { key: "balance", label: "Still owed", numeric: true, format: peso },
            ],
            rows: data.byClient,
          },
          {
            title: "By service",
            columns: [
              { key: "service", label: "Service" },
              { key: "lines", label: "Invoice lines", numeric: true },
              { key: "amount", label: "Amount", numeric: true, format: peso },
            ],
            rows: data.byService,
          },
        ],
      };
    }
    if (report === "stock") {
      const data = stockUsageReport({ movements, inventory }, range);
      return {
        title: "Stock Usage Report",
        charts: [
          { title: "Top items by cost", rows: data.rows.filter((row) => row.cost > 0).slice(0, 5).map((row) => ({ label: row.item, value: row.cost })), format: peso },
          { title: "Items on the most visits", rows: [...data.rows].sort((a, b) => b.visits - a.visits).slice(0, 5).map((row) => ({ label: row.item, value: row.visits })), format: (value) => `${value} visit${value === 1 ? "" : "s"}` },
        ],
        summary: [
          { label: "Items used", value: data.totals.items },
          { label: "Visits", value: data.totals.visits },
          { label: "Cost of what was used", value: peso(data.totals.cost) },
        ],
        tables: [{
          title: "Used on visits, by item",
          columns: [
            { key: "item", label: "Item" },
            { key: "quantity", label: "Quantity", numeric: true },
            { key: "unit", label: "Unit" },
            { key: "visits", label: "Visits", numeric: true },
            { key: "cost", label: "Cost", numeric: true, format: peso },
          ],
          rows: data.rows,
        }],
      };
    }
    const data = technicianReport({ appointments, users }, range);
    return {
      title: "Technician Performance Report",
      charts: [
        { title: "Completed visits", rows: data.rows.map((row) => ({ label: row.technician, value: row.completed })), format: (value) => String(value) },
        { title: "Reports still missing", rows: data.rows.filter((row) => row.reportsMissing > 0).map((row) => ({ label: row.technician, value: row.reportsMissing })), format: (value) => String(value) },
      ],
      summary: [
        { label: "Visits", value: data.totals.visits },
        { label: "Completed", value: data.totals.completed },
        { label: "Reports missing", value: data.totals.reportsMissing },
      ],
      tables: [{
        title: "By technician",
        columns: [
          { key: "technician", label: "Technician" },
          { key: "visits", label: "Visits", numeric: true },
          { key: "completed", label: "Completed", numeric: true },
          { key: "reportsOnTime", label: "Reports on time", numeric: true },
          { key: "reportsLate", label: "Reports late", numeric: true },
          { key: "reportsMissing", label: "Reports missing", numeric: true },
          { key: "missingSignature", label: "No customer signature", numeric: true },
        ],
        rows: data.rows,
      }],
    };
  }, [report, range, billing, clients, services, movements, inventory, appointments, users]);

  const fileBase = `${built.title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}_${range.from}_${range.to}`;
  const exportCsv = () => {
    const text = built.tables.map((table) => `${table.title}\n${toCsv(table.rows, table.columns)}`).join("\n\n");
    download(`${fileBase}.csv`, `${built.title}\nPeriod,${range.from} to ${range.to}\n${built.summary.map((entry) => `${entry.label},"${entry.value}"`).join("\n")}\n\n${text}`);
  };
  const exportPdf = () => setPrintRequest({ kind: "REPORT", report: { ...built, reference: fileBase, period } });

  const rangeInvalid = !range.from || !range.to || range.from > range.to;

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Money"
        title="Reports"
        description="How the business is doing over a period: money, stock and the team."
        actions={(
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button icon={<Download size={15} />} onClick={exportCsv} disabled={rangeInvalid}>Download Excel (CSV)</Button>
            <Button variant="primary" icon={<FileText size={15} />} onClick={exportPdf} disabled={rangeInvalid}>Download PDF</Button>
          </div>
        )}
      />

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <SegmentedControl ariaLabel="Report" options={REPORTS} value={report} onChange={setReport} />
        <SegmentedControl ariaLabel="Period" size="sm" options={PRESETS} value={preset} onChange={choosePreset} />
        <span style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", color: colors.body }}>
          <Input aria-label="From" type="date" value={range.from} max={range.to} onChange={setDate("from")} style={{ width: "auto" }} />
          to
          <Input aria-label="To" type="date" value={range.to} min={range.from} onChange={setDate("to")} style={{ width: "auto" }} />
        </span>
      </div>

      {rangeInvalid && <p role="alert" style={{ color: colors.danger }}>Choose a start date on or before the end date.</p>}
      {report === "sales" && !invoicesOn && <p style={{ color: colors.muted }}>Sales need billing (migrations 061 and 062).</p>}

      <div style={{ display: "grid", gap: "1rem" }}>
        <TileRow min="150px">
          {built.summary.map((entry) => <StatTile key={entry.label} label={entry.label} value={entry.value} />)}
        </TileRow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
          {built.charts.map((chart) => (
            <Card key={chart.title} title={chart.title}>
              <RankedBars rows={chart.rows.some((row) => row.value > 0) ? chart.rows : []} format={chart.format} />
            </Card>
          ))}
        </div>
        {built.tables.map((table) => (
          <Card key={table.title} title={table.title} padded={false}>
            <DataTable
              caption={table.title}
              columns={table.columns.map((column) => ({
                key: column.key,
                label: column.label,
                align: column.numeric ? "right" : "left",
                sortable: true,
                render: column.format ? (row) => column.format(row[column.key]) : undefined,
              }))}
              rows={table.rows}
              rowKey={(row) => row.clientId || row.itemId || row.technicianId || row.service}
              empty="Nothing in this period."
            />
          </Card>
        ))}
      </div>

      <BillingPrinter request={printRequest} onDone={() => setPrintRequest(null)} />
    </div>
  );
}

export default ReportsPage;
