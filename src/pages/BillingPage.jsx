// Billing route (Sprint 3): quotes, invoices, contracts and the money received.
//
//   ?quote=<id>              opens that quote
//   ?invoice=<id>            opens that invoice
//   ?contract=<id>           opens that contract
//   ?new=1&client=<id>       starts a quote for that client (from a profile)
//
// A quote is approved, its down payment recorded, then "Book visit" hands the
// quote to the Schedule page (?quote=<id>), which prefills the booking and
// links the visits back once they are saved. After the service the quote (or
// the visits alone) is invoiced, the down payment deducted, and payments are
// recorded against the invoice until the balance is nil.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import { Button, Card, DataTable, Input, SegmentedControl, StatusPill } from "../components/ui";
import QuoteEditor from "../components/billing/QuoteEditor";
import QuoteDetail from "../components/billing/QuoteDetail";
import InvoiceEditor from "../components/billing/InvoiceEditor";
import InvoiceDetail, { INVOICE_TONES } from "../components/billing/InvoiceDetail";
import ContractEditor from "../components/billing/ContractEditor";
import ContractDetail, { CONTRACT_TONES } from "../components/billing/ContractDetail";
import PaymentForm from "../components/billing/PaymentForm";
import PaymentList from "../components/billing/PaymentList";
import BillingPrinter from "../components/billing/BillingPrinter";
import useAuth from "../hooks/useAuth";
import useBilling from "../hooks/useBilling";
import useClients from "../hooks/useClients";
import useServices from "../hooks/useServices";
import useInventory from "../hooks/useInventory";
import { useScheduling } from "../context/SchedulingContext";
import { useToast } from "../context/ToastContext";
import { colors, pageShell } from "../styles/theme";
import { CONTRACT_STATUS_LABELS, INVOICE_STATE_LABELS, QUOTE_STATUS_LABELS } from "../utils/constants";
import { billingOverview, depositStatus, invoiceBalance, quoteStatus } from "../utils/billing";
import { StatTile, TileRow } from "../components/dashboard/DashboardParts";
import { servicesOf } from "../utils/scheduling";
import { includedMaterialsText } from "../utils/pricing";
import { contractInvoicesDue, prepaidPlanIds } from "../utils/sprint4";
import { documentEmail, gmailComposeUrl } from "../utils/gmail";
import { formatDate, formatPeso } from "../utils/formatters";
import { SUBSYSTEMS } from "../utils/permissions";

const TABS = [
  { value: "quotes", label: "Quotes" },
  { value: "invoices", label: "Invoices" },
  { value: "contracts", label: "Contracts" },
  { value: "payments", label: "Payments" },
];

const QUOTE_FILTERS = ["All", "Draft", "Sent", "Approved", "Rejected", "Expired"];
const INVOICE_FILTERS = ["All", "Unpaid", "Partly paid", "Overdue", "Paid", "Void"];
const CONTRACT_FILTERS = ["All", "Draft", "Active", "Ended", "Cancelled"];

function BillingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can, currentUser } = useAuth();
  const billing = useBilling();
  const { quotes, invoices, payments, extras, available, invoicesAvailable, loading, error, quoteById, invoiceById, paymentsForQuote, paymentsForInvoice } = billing;
  const { clients, uploadDocumentRecord, getDocumentUrl } = useClients();
  const { services: billingServices, activeServices, serviceById, serviceByName } = useServices();
  const { inventory } = useInventory();
  const { appointments } = useScheduling();
  const { showSuccess, showError } = useToast();

  const [tab, setTab] = useState(searchParams.get("invoice") ? "invoices" : searchParams.get("contract") ? "contracts" : "quotes");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // { quote } — quote null means new
  const [invoicing, setInvoicing] = useState(null); // { quoteId, clientId } or a contract's { contract, visitIds, lines }
  const [paying, setPaying] = useState(null); // { quote } for a down payment, { invoice } for a payment
  const [printRequest, setPrintRequest] = useState(null);

  const canCreate = can(SUBSYSTEMS.BILLING, "create");
  const canReverse = can(SUBSYSTEMS.BILLING, "delete");
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const itemById = useMemo(() => {
    const byId = new Map(inventory.map((item) => [item.id, item]));
    return (id) => byId.get(id) || null;
  }, [inventory]);
  const clientName = (id) => clientById.get(id)?.name || "—";

  const openQuoteRecord = quoteById(searchParams.get("quote"));
  const openInvoiceRecord = invoiceById(searchParams.get("invoice"));
  const openContractRecord = billing.contractById(searchParams.get("contract"));
  const startNew = searchParams.get("new") === "1" && canCreate;
  // "Create quote from inspection" (Sprint 4) arrives as &inspection=<visit>.
  const inspectionVisit = startNew ? appointments.find((visit) => visit.id === searchParams.get("inspection")) || null : null;
  const quoteEditorOpen = editing || startNew;
  const [contractEditing, setContractEditing] = useState(null); // { contract } — null contract means new
  const modalOpen = quoteEditorOpen || invoicing || paying || contractEditing;

  const setParams = (next) => setSearchParams(next, { replace: true });
  const openQuote = (id) => setParams(id ? { quote: id } : {});
  const openInvoice = (id) => setParams(id ? { invoice: id } : {});
  const openContract = (id) => setParams(id ? { contract: id } : {});
  const changeTab = (next) => {
    setTab(next);
    setFilter("All");
  };

  const needle = search.trim().toLowerCase();
  const matches = (record) => !needle || `${record.reference} ${record.clientName}`.toLowerCase().includes(needle);

  // Every row matching the search; the status filter is applied after, so
  // each filter chip can say how many it would show.
  const quoteMatches = useMemo(() => quotes
    .map((quote) => ({ ...quote, state: QUOTE_STATUS_LABELS[quoteStatus(quote)], clientName: clientById.get(quote.clientId)?.name || "—" }))
    .filter(matches),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [quotes, clientById, needle]);
  const quoteRows = useMemo(() => quoteMatches.filter((quote) => filter === "All" || quote.state === filter), [quoteMatches, filter]);

  const invoiceMatches = useMemo(() => invoices
    .map((invoice) => {
      const balance = invoiceBalance(invoice, payments);
      return { ...invoice, balance, state: INVOICE_STATE_LABELS[balance.state], clientName: clientById.get(invoice.clientId)?.name || "—" };
    })
    .filter(matches),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [invoices, payments, clientById, needle]);
  const invoiceRows = useMemo(() => invoiceMatches.filter((invoice) => filter === "All" || invoice.state === filter), [invoiceMatches, filter]);
  const overview = useMemo(() => billingOverview({ quotes, invoices: invoicesAvailable ? invoices : [], payments }), [quotes, invoices, payments, invoicesAvailable]);

  const quoteColumns = [
    { key: "reference", label: "Quote", sortable: true, render: (quote) => <strong style={{ color: colors.ink }}>{quote.reference}</strong> },
    { key: "clientName", label: "Client", sortable: true },
    { key: "state", label: "Status", sortable: true, render: (quote) => <StatusPill status={quote.state} /> },
    {
      key: "deposit",
      label: "Down payment",
      render: (quote) => {
        const deposit = depositStatus(quote, paymentsForQuote(quote.id));
        if (!deposit.required) return <span style={{ color: colors.muted }}>None</span>;
        return `${formatPeso(deposit.paid)} of ${formatPeso(deposit.required)}`;
      },
    },
    { key: "validUntil", label: "Valid until", sortable: true, render: (quote) => formatDate(quote.validUntil) },
    { key: "total", label: "Total", align: "right", sortable: true, render: (quote) => formatPeso(quote.total) },
  ];

  const invoiceColumns = [
    { key: "reference", label: "Invoice", sortable: true, render: (invoice) => <strong style={{ color: colors.ink }}>{invoice.reference}</strong> },
    { key: "clientName", label: "Client", sortable: true },
    { key: "state", label: "Status", sortable: true, render: (invoice) => <StatusPill tone={INVOICE_TONES[invoice.balance.state]} status={invoice.state} /> },
    { key: "issuedOn", label: "Issued", sortable: true, render: (invoice) => formatDate(invoice.issuedOn) },
    { key: "dueOn", label: "Due", sortable: true, render: (invoice) => formatDate(invoice.dueOn) },
    { key: "amountDue", label: "Amount due", align: "right", sortable: true, render: (invoice) => formatPeso(invoice.amountDue) },
    { key: "balance", label: "Balance", align: "right", sortable: true, sortValue: (invoice) => invoice.balance.balance, render: (invoice) => (invoice.status === "VOID" ? "—" : formatPeso(invoice.balance.balance)) },
  ];

  const contractMatches = (billing.contracts || [])
    .map((contract) => ({ ...contract, state: CONTRACT_STATUS_LABELS[contract.status], clientName: clientName(contract.clientId) }))
    .filter((contract) => !needle || `${contract.reference} ${contract.clientName} ${contract.title}`.toLowerCase().includes(needle));

  const contractRows = contractMatches.filter((contract) => filter === "All" || contract.state === filter);

  const contractColumns = [
    { key: "reference", label: "Contract", sortable: true, render: (contract) => <strong style={{ color: colors.ink }}>{contract.reference}</strong> },
    { key: "clientName", label: "Client", sortable: true },
    { key: "title", label: "Title", sortable: true },
    { key: "state", label: "Status", sortable: true, render: (contract) => <StatusPill tone={CONTRACT_TONES[contract.status]} status={contract.state} /> },
    { key: "startsOn", label: "Starts", sortable: true, render: (contract) => formatDate(contract.startsOn) },
    { key: "pricePerVisit", label: "Per visit", align: "right", sortable: true, render: (contract) => formatPeso(contract.pricePerVisit) },
  ];

  const saveContract = async (values) => {
    const contract = contractEditing?.contract || null;
    const result = await billing.saveContract(contract?.id || null, values);
    if (typeof result === "string") return result;
    showSuccess(contract ? `${contract.reference} saved.` : `Contract ${result?.reference || ""} created as a draft.`);
    setContractEditing(null);
    setTab("contracts");
    if (result?.id) openContract(result.id);
    return true;
  };

  // The signed copy is filed with the client's documents (category CONTRACT),
  // then attached to the contract.
  const uploadSigned = async (contract, file) => {
    const document = await uploadDocumentRecord(contract.clientId, file, "CONTRACT");
    if (typeof document === "string") return document;
    const result = await billing.attachContractDocument(contract, document.id);
    if (typeof result !== "string") showSuccess("Signed copy attached.");
    return result;
  };

  const viewDocument = async (document) => {
    const result = await getDocumentUrl(document);
    if (result?.url) window.open(result.url, "_blank", "noopener");
    else showError(result?.error || "The file could not be opened.");
  };

  const paymentLabel = (payment) => {
    const source = payment.kind === "DEPOSIT" ? quoteById(payment.quoteId) : invoiceById(payment.invoiceId);
    const what = payment.kind === "DEPOSIT" ? "Down payment" : "Payment";
    return `${clientName(payment.clientId)} · ${what}${source ? ` · ${source.reference}` : ""}`;
  };

  const closeQuoteEditor = () => {
    setEditing(null);
    if (startNew) setParams({});
  };

  const saveQuote = async (form, lines) => {
    const quote = editing?.quote || null;
    const result = await billing.saveQuote(quote?.id || null, form, lines);
    if (typeof result === "string") return result;
    showSuccess(quote ? `${quote.reference} saved.` : `Quote ${result?.reference || ""} created.`);
    // A new quote from an inspection names it.
    if (!quote && inspectionVisit && result?.id) await billing.setQuoteInspection(result.id, inspectionVisit.id);
    setEditing(null);
    if (result?.id) openQuote(result.id);
    else if (startNew) setParams({});
    return true;
  };

  const issueInvoice = async (form, lines) => {
    const result = await billing.createInvoice(form, lines);
    if (typeof result === "string") return result;
    // A contract's invoice names the contract, so it is not billed twice.
    if (invoicing?.contract && result?.id) await billing.linkInvoiceContract(result.id, invoicing.contract.id);
    showSuccess(`Invoice ${result?.reference || ""} issued.`);
    setInvoicing(null);
    setTab("invoices");
    if (result?.id) openInvoice(result.id);
    return true;
  };

  const withToast = (message) => async (call) => {
    const result = await call();
    if (typeof result !== "string") showSuccess(message);
    return result;
  };

  const revise = async (quote) => {
    const result = await billing.reviseQuote(quote);
    if (typeof result === "string") return result;
    showSuccess(`Revision ${result?.reference || ""} created as a draft.`);
    if (result?.id) {
      openQuote(result.id);
      setEditing({ quote: result });
    }
    return true;
  };

  // Quotes, invoices and receipts print through BillingPrinter ("Save as PDF").
  // What a quote's service line covers, on screen and on the printout.
  const includesFor = (line) => (line.kind === "SERVICE" ? includedMaterialsText(serviceById(line.serviceId), itemById) : "");
  const printQuote = (quote) => setPrintRequest({ kind: "QUOTE", quote, client: clientById.get(quote.clientId), payments: paymentsForQuote(quote.id), includesFor });
  const printInvoice = (invoice) => {
    const lineVisits = new Set(invoice.lines.map((line) => line.appointmentId).filter(Boolean));
    setPrintRequest({
      kind: "INVOICE",
      invoice,
      client: clientById.get(invoice.clientId),
      quote: quoteById(invoice.quoteId),
      payments: paymentsForInvoice(invoice.id),
      visits: appointments.filter((visit) => visit.invoiceId === invoice.id || lineVisits.has(visit.id)),
    });
  };
  const printReceipt = (payment) => setPrintRequest({
    kind: "RECEIPT",
    payment,
    client: clientById.get(payment.clientId),
    quote: quoteById(payment.quoteId),
    invoice: invoiceById(payment.invoiceId),
    payments: payment.invoiceId ? paymentsForInvoice(payment.invoiceId) : [],
  });

  // Send by Gmail (Sprint 4): a draft to the client with the message written,
  // and "Save as PDF" for the document, to attach to it.
  const sendDocument = (kind, record, request) => {
    const client = request.client;
    if (!client?.email) {
      showError(`${client?.name || "This client"} has no email address. Add it to their profile first.`);
      return;
    }
    window.open(gmailComposeUrl({ to: client.email, ...documentEmail(kind, record, client) }), "_blank", "noopener");
    setPrintRequest(request);
    showSuccess("Gmail is open in a new tab. Save the PDF, then attach it to the email.");
  };
  const sendReceipt = (payment) => sendDocument("RECEIPT", payment, {
    kind: "RECEIPT",
    payment,
    client: clientById.get(payment.clientId),
    quote: quoteById(payment.quoteId),
    invoice: invoiceById(payment.invoiceId),
    payments: payment.invoiceId ? paymentsForInvoice(payment.invoiceId) : [],
  });

  // Contract invoicing (Sprint 4): what each contract's billing schedule says
  // is ready, each opening the invoice form filled in for review.
  const prepaid = prepaidPlanIds(billing.contracts || [], invoices);
  const contractReady = invoicesAvailable ? contractInvoicesDue({ contracts: billing.contracts || [], appointments, invoices }) : [];

  const checkStatus = (payment, status, note) => billing.setCheckStatus(payment, status, null, note);
  const reverse = (payment, reason) => billing.reversePayment(payment, reason);

  if (!available) {
    return (
      <div style={pageShell}>
        <PageHeader eyebrow="Money" title="Billing" />
        <Card>
          <p style={{ margin: 0 }}>Billing needs migrations 060 and 061. Apply them in the Supabase SQL editor, then reload.</p>
        </Card>
      </div>
    );
  }

  // Each filter chip carries its count ("Overdue 2"); the value stays the plain word.
  const filterRows = tab === "quotes" ? quoteMatches : tab === "contracts" ? contractMatches : invoiceMatches;
  const filters = (tab === "quotes" ? QUOTE_FILTERS : tab === "contracts" ? CONTRACT_FILTERS : INVOICE_FILTERS).map((value) => {
    const count = value === "All" ? filterRows.length : filterRows.filter((row) => row.state === value).length;
    return {
      value,
      label: (
        <>
          {value}
          {count > 0 && <span aria-hidden="true" style={{ color: colors.muted, fontVariantNumeric: "tabular-nums" }}>{count}</span>}
        </>
      ),
    };
  });
  const goTo = (nextTab, nextFilter) => {
    setTab(nextTab);
    setFilter(nextFilter);
  };
  const tabs = TABS.filter((entry) => (entry.value !== "invoices" || invoicesAvailable) && (entry.value !== "contracts" || billing.contractsAvailable));

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Money"
        title="Billing"
        description="Quotes, invoices and the money received."
        actions={canCreate && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {billing.contractsAvailable && <Button icon={<Plus size={15} />} onClick={() => setContractEditing({ contract: null })}>New contract</Button>}
            {invoicesAvailable && <Button icon={<Plus size={15} />} onClick={() => setInvoicing({ quoteId: "", clientId: "" })}>New invoice</Button>}
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing({ quote: null })}>New quote</Button>
          </div>
        )}
      />

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <SegmentedControl ariaLabel="Billing view" options={tabs} value={tab} onChange={changeTab} />
        {tab !== "payments" && (
          <>
            <SegmentedControl ariaLabel={`${tab === "quotes" ? "Quote" : tab === "contracts" ? "Contract" : "Invoice"} status`} size="sm" options={filters} value={filter} onChange={setFilter} />
            <Input aria-label="Search billing" placeholder="Search reference or client" value={search} onChange={(event) => setSearch(event.target.value)} style={{ flex: "1 1 220px", maxWidth: "320px" }} />
          </>
        )}
      </div>

      {/* Where the money stands; each tile opens the list it counts. */}
      <div style={{ marginBottom: "1rem" }}>
        <TileRow min="170px">
          {invoicesAvailable && (
            <StatTile label="To collect" value={formatPeso(overview.toCollect)} note={`${overview.toCollectCount} unpaid invoice${overview.toCollectCount === 1 ? "" : "s"}`} onClick={() => goTo("invoices", "All")} />
          )}
          {invoicesAvailable && (
            <StatTile label="Overdue" tone={overview.overdueCount ? "crit" : "plain"} value={formatPeso(overview.overdue)} note={overview.overdueCount ? `${overview.overdueCount} past the due date` : "Nothing overdue"} onClick={() => goTo("invoices", "Overdue")} />
          )}
          <StatTile label="Collected this month" tone="done" value={formatPeso(overview.collectedThisMonth)} note="Payments and down payments" onClick={() => goTo("payments", "All")} />
          <StatTile label="Down payments due" tone={overview.depositsDueCount ? "attn" : "plain"} value={formatPeso(overview.depositsDue)} note={`${overview.depositsDueCount} approved quote${overview.depositsDueCount === 1 ? "" : "s"} waiting`} onClick={() => goTo("quotes", "Approved")} />
        </TileRow>
      </div>

      {error && <p role="alert" style={{ color: colors.danger }}>{error}</p>}
      {!invoicesAvailable && <p style={{ color: colors.muted, fontSize: "0.85rem" }}>Invoices need migration 062.</p>}

      {tab === "quotes" && (
        <Card padded={false}>
          <DataTable caption="Quotes" columns={quoteColumns} rows={quoteRows} initialSort={{ key: "reference", direction: "desc" }} onRowClick={(quote) => openQuote(quote.id)} loading={loading} empty={loading ? "Loading quotes…" : "No quotes yet."} />
        </Card>
      )}
      {tab === "invoices" && contractReady.length > 0 && (
        <Card title="Ready to invoice from contracts" style={{ marginBottom: "1rem" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {contractReady.map((item) => (
              <li key={item.key} style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", padding: "0.55rem 0", borderTop: `1px solid ${colors.line}` }}>
                <span style={{ flex: "1 1 260px", color: colors.ink }}>
                  {clientName(item.contract.clientId)} · {item.label}
                </span>
                <Button size="sm" variant="primary" onClick={() => setInvoicing({ clientId: item.contract.clientId, quoteId: "", contract: item.contract, visitIds: item.visits.map((visit) => visit.id), lines: item.lines || [] })}>
                  Review and issue
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === "invoices" && (
        <Card padded={false}>
          <DataTable caption="Invoices" columns={invoiceColumns} rows={invoiceRows} initialSort={{ key: "reference", direction: "desc" }} onRowClick={(invoice) => openInvoice(invoice.id)} loading={loading} empty={loading ? "Loading invoices…" : "No invoices yet."} />
        </Card>
      )}
      {tab === "contracts" && (
        <Card padded={false}>
          <DataTable caption="Contracts" columns={contractColumns} rows={contractRows} initialSort={{ key: "reference", direction: "desc" }} onRowClick={(contract) => openContract(contract.id)} loading={loading} empty={loading ? "Loading contracts…" : "No contracts yet."} />
        </Card>
      )}
      {tab === "payments" && (
        <Card>
          <PaymentList payments={payments} labelFor={paymentLabel} canReverse={canReverse} onCheck={checkStatus} onReverse={reverse} onReceipt={printReceipt} empty={loading ? "Loading payments…" : "No payments recorded yet."} />
        </Card>
      )}

      {openQuoteRecord && !modalOpen && (
        <QuoteDetail
          quote={openQuoteRecord}
          client={clientById.get(openQuoteRecord.clientId)}
          payments={paymentsForQuote(openQuoteRecord.id)}
          visits={appointments.filter((visit) => visit.quoteId === openQuoteRecord.id)}
          invoices={billing.invoicesForQuote(openQuoteRecord.id)}
          canReverse={canReverse}
          onEdit={() => setEditing({ quote: openQuoteRecord })}
          onSend={() => withToast(`${openQuoteRecord.reference} marked as sent.`)(() => billing.sendQuote(openQuoteRecord))}
          onDecide={(approved, note) => withToast(`${openQuoteRecord.reference} ${approved ? "approved" : "rejected"}.`)(() => billing.decideQuote(openQuoteRecord, approved, note))}
          onRevise={() => revise(openQuoteRecord)}
          onDelete={async () => {
            const result = await billing.deleteQuote(openQuoteRecord);
            if (typeof result === "string") return result;
            showSuccess(`${openQuoteRecord.reference} deleted.`);
            openQuote(null);
            return true;
          }}
          onRecordDeposit={() => setPaying({ quote: openQuoteRecord })}
          onBook={() => navigate(`/scheduling?quote=${openQuoteRecord.id}`)}
          onInvoice={invoicesAvailable && canCreate ? () => setInvoicing({ quoteId: openQuoteRecord.id, clientId: openQuoteRecord.clientId }) : undefined}
          onOpenInvoice={(id) => { setTab("invoices"); openInvoice(id); }}
          onPrint={() => printQuote(openQuoteRecord)}
          onEmail={() => sendDocument("QUOTE", openQuoteRecord, { kind: "QUOTE", quote: openQuoteRecord, client: clientById.get(openQuoteRecord.clientId), payments: paymentsForQuote(openQuoteRecord.id), includesFor })}
          onSendReceipt={sendReceipt}
          inspection={openQuoteRecord.inspectionId ? appointments.find((visit) => visit.id === openQuoteRecord.inspectionId) || null : null}
          includesFor={includesFor}
          onReceipt={printReceipt}
          onCheck={checkStatus}
          onReverse={reverse}
          onClose={() => openQuote(null)}
        />
      )}

      {openInvoiceRecord && !modalOpen && (
        <InvoiceDetail
          invoice={openInvoiceRecord}
          client={clientById.get(openInvoiceRecord.clientId)}
          quote={quoteById(openInvoiceRecord.quoteId)}
          payments={paymentsForInvoice(openInvoiceRecord.id)}
          canVoid={canReverse}
          canReverse={canReverse}
          onRecordPayment={() => setPaying({ invoice: openInvoiceRecord })}
          onVoid={async (reason) => {
            const result = await billing.voidInvoice(openInvoiceRecord, reason);
            if (typeof result === "string") return result;
            showSuccess(`${openInvoiceRecord.reference} voided.`);
            return true;
          }}
          onCheck={checkStatus}
          onReverse={reverse}
          onOpenQuote={() => { setTab("quotes"); openQuote(openInvoiceRecord.quoteId); }}
          onPrint={() => printInvoice(openInvoiceRecord)}
          onEmail={() => sendDocument("INVOICE", openInvoiceRecord, {
            kind: "INVOICE",
            invoice: openInvoiceRecord,
            client: clientById.get(openInvoiceRecord.clientId),
            quote: quoteById(openInvoiceRecord.quoteId),
            payments: paymentsForInvoice(openInvoiceRecord.id),
            visits: appointments.filter((visit) => visit.invoiceId === openInvoiceRecord.id),
          })}
          onSendReceipt={sendReceipt}
          onReceipt={printReceipt}
          onClose={() => openInvoice(null)}
        />
      )}

      {quoteEditorOpen && (
        <QuoteEditor
          quote={editing?.quote || null}
          clients={clients}
          services={activeServices}
          inventory={inventory}
          initialClientId={startNew ? searchParams.get("client") || "" : ""}
          inspection={editing?.quote ? null : inspectionVisit}
          onSave={saveQuote}
          onClose={closeQuoteEditor}
        />
      )}

      {openContractRecord && !modalOpen && (() => {
        const contract = openContractRecord;
        const client = clientById.get(contract.clientId);
        const signedDocument = (client?.documents || []).find((document) => document.id === contract.signedDocumentId) || null;
        const toast = (message) => async (call) => {
          const result = await call();
          if (typeof result !== "string") showSuccess(message);
          return result;
        };
        return (
          <ContractDetail
            contract={contract}
            client={client}
            signedDocument={signedDocument}
            visits={contract.planId ? appointments.filter((visit) => visit.planId === contract.planId) : []}
            onEdit={() => setContractEditing({ contract })}
            onPrint={() => setPrintRequest({ kind: "CONTRACT", contract, client })}
            onEmail={() => sendDocument("CONTRACT", contract, { kind: "CONTRACT", contract, client })}
            onUploadSigned={(file) => uploadSigned(contract, file)}
            onViewSigned={() => signedDocument && viewDocument(signedDocument)}
            onActivate={() => toast(`${contract.reference} is active.`)(() => billing.setContractStatus(contract, "ACTIVE"))}
            onEnd={() => toast(`${contract.reference} ended.`)(() => billing.setContractStatus(contract, "ENDED"))}
            onCancel={(reason) => toast(`${contract.reference} cancelled.`)(() => billing.cancelContract(contract, reason))}
            onDelete={async () => {
              const result = await billing.deleteContract(contract);
              if (typeof result === "string") return result;
              showSuccess(`${contract.reference} deleted.`);
              openContract(null);
              return true;
            }}
            onBook={() => navigate(`/scheduling?contract=${contract.id}`)}
            onClose={() => openContract(null)}
          />
        );
      })()}

      {contractEditing && (
        <ContractEditor
          contract={contractEditing.contract}
          clients={clients}
          services={billingServices}
          onSave={saveContract}
          onClose={() => setContractEditing(null)}
        />
      )}

      {invoicing && (
        <InvoiceEditor
          clients={clients}
          quotes={quotes}
          invoices={invoices}
          payments={payments}
          appointments={appointments}
          extras={extras}
          servicesFor={(visit) => servicesOf(visit, serviceById, serviceByName)}
          itemById={itemById}
          initialClientId={invoicing.clientId}
          initialQuoteId={invoicing.quoteId}
          initialVisitIds={invoicing.visitIds || null}
          presetLines={invoicing.lines || []}
          contract={invoicing.contract || null}
          prepaid={prepaid}
          onSave={issueInvoice}
          onClose={() => setInvoicing(null)}
        />
      )}

      {paying?.quote && (() => {
        const quote = paying.quote;
        const deposit = depositStatus(quote, paymentsForQuote(quote.id));
        return (
          <PaymentForm
            title="Record down payment"
            subtitle={`${quote.reference} · ${clientName(quote.clientId)}`}
            suggested={Math.max(0, deposit.remaining - deposit.pending)}
            max={Math.max(0, Number(quote.total) - deposit.paid - deposit.pending)}
            onSave={async (values) => {
              const result = await billing.recordPayment({ ...values, kind: "DEPOSIT", quoteId: quote.id }, `down payment on ${quote.reference}`);
              if (typeof result === "string") return result;
              showSuccess(`Down payment ${result?.reference || ""} recorded${currentUser?.name ? ` by ${currentUser.name}` : ""}.`);
              setPaying(null);
              return true;
            }}
            onClose={() => setPaying(null)}
          />
        );
      })()}

      {paying?.invoice && (() => {
        const invoice = paying.invoice;
        const balance = invoiceBalance(invoice, paymentsForInvoice(invoice.id));
        const open = Math.max(0, Math.round((balance.balance - balance.pending) * 100) / 100);
        return (
          <PaymentForm
            title="Record payment"
            subtitle={`${invoice.reference} · ${clientName(invoice.clientId)}`}
            suggested={open}
            max={open}
            onSave={async (values) => {
              const result = await billing.recordPayment({ ...values, kind: "PAYMENT", invoiceId: invoice.id }, `payment on ${invoice.reference}`);
              if (typeof result === "string") return result;
              showSuccess(`Payment ${result?.reference || ""} recorded.`);
              setPaying(null);
              return true;
            }}
            onClose={() => setPaying(null)}
          />
        );
      })()}
      <BillingPrinter request={printRequest} onDone={() => setPrintRequest(null)} />
    </div>
  );
}

export default BillingPage;
