// Full client profile: read-only summary, edit form, and documents.
//
// Sprint AC (View Single Client Profile): "Detail view displays full client
// information, classification, and attached documents" and "Staff can
// navigate back to the list or edit the profile from this view." Back
// navigation was missing entirely — the old page imported only useParams,
// with no Link anywhere.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PencilLine, Printer, Trash2, X } from "lucide-react";
import ClientForm from "./ClientForm";
import ClientDocuments, { CategoryTag } from "./ClientDocuments";
import ServiceReportPrinter from "../scheduling/ServiceReportPrinter";
import PageHeader from "../common/PageHeader";
import { useScheduling } from "../../context/SchedulingContext";
import useUsers from "../../hooks/useUsers";
import { formatDateTime, humanizeEnum } from "../../utils/formatters";
import { DOCUMENT_CATEGORIES } from "../../utils/constants";
import { colors, dangerButton, pageShell, primaryButton, secondaryButton } from "../../styles/theme";

function InfoBlock({ label, value }) {
  return <div style={{ padding: "0.8rem", background: "#f8fafc", borderRadius: "8px" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>{label}</div><div style={{ marginTop: "0.3rem", color: colors.body, fontSize: "0.84rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{value}</div></div>;
}

function ServiceReportSummary({ appointment }) {
  return <div style={{ display: "grid", gap: "0.65rem", margin: "1.25rem 1.25rem 0" }}>
    <InfoBlock label="Service type" value={appointment.serviceType || "Not specified."} />
    <InfoBlock label="Service location" value={appointment.serviceLocation || "Client address."} />
    <InfoBlock label="Inspection findings" value={appointment.report || "No findings recorded."} />
    <InfoBlock label="Treatment performed" value={appointment.treatmentPerformed || "No treatment recorded."} />
    <InfoBlock label="Recommendations" value={appointment.recommendations || "No recommendations recorded."} />
    <InfoBlock label="Follow-up date" value={appointment.followUpDate || "No follow-up scheduled."} />
    <InfoBlock label="Report submitted" value={appointment.reportSubmittedAt ? formatDateTime(appointment.reportSubmittedAt) : "Not submitted."} />
  </div>;
}

function HistoryFileList({ files, onOpen, emptyMessage }) {
  if (files.length === 0) {
    return <div style={{ marginTop: "0.3rem", color: colors.body, fontSize: "0.84rem" }}>{emptyMessage}</div>;
  }

  return <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.5rem" }}>
    {files.map((file) => <div key={file.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.55rem 0.65rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "7px" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", color: colors.body, fontSize: "0.8rem", fontWeight: 700 }}><CategoryTag category={file.category} />{file.name}</div>
        <div style={{ color: colors.muted, fontSize: "0.68rem" }}>{formatDateTime(file.uploadedAt)}</div>
      </div>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button type="button" onClick={() => onOpen(file)} style={{ ...secondaryButton, padding: "0.35rem 0.5rem", fontSize: "0.7rem" }}>Preview</button>
        <button type="button" onClick={() => onOpen(file, true)} style={{ ...secondaryButton, padding: "0.35rem 0.5rem", fontSize: "0.7rem" }}>Download</button>
      </div>
    </div>)}
  </div>;
}

const neutralCard = {
  background: "#ffffff",
  border: "1px solid rgba(148, 163, 184, 0.2)",
  borderRadius: "18px",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)",
};

function ClientDetails({
  client,
  canEdit,
  canDelete,
  canUploadDocuments,
  canRemoveDocuments,
  onSave,
  onDelete,
  onUploadDocument,
  onRemoveDocument,
  onResolveDocumentUrl,
}) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const { appointments, getAttachmentUrl, getSignatureUrl } = useScheduling();
  const { staff, technicians } = useUsers();
  const accounts = [...staff, ...technicians];
  const serviceHistory = appointments
    .filter((appointment) => appointment.clientId === client.id && appointment.status === "Completed")
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  const [printRequest, setPrintRequest] = useState(null);
  const [signatureUrl, setSignatureUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!selectedHistory?.signaturePath) { setSignatureUrl(""); return undefined; }
    getSignatureUrl(selectedHistory.signaturePath).then((result) => {
      if (!cancelled && result?.url) setSignatureUrl(result.url);
    });
    return () => { cancelled = true; };
  }, [selectedHistory?.signaturePath, getSignatureUrl]);

  const openHistoryDocument = async (document, download = false) => {
    const result = await onResolveDocumentUrl(document, { download });
    if (result?.url) window.open(result.url, download ? "_self" : "_blank", "noopener,noreferrer");
  };
  const openHistoryAttachment = async (attachment, download = false) => {
    const result = await getAttachmentUrl(attachment, { download });
    if (result?.url) window.open(result.url, download ? "_self" : "_blank", "noopener,noreferrer");
  };
  const overviewFields = useMemo(
    () => [
      { label: "Client No.", value: client.reference || "—" },
      { label: "Classification", value: client.classification === "OTHER" && client.classificationOther ? client.classificationOther : humanizeEnum(client.classification) },
      { label: "Pest Concern", value: client.pestConcern || "—" },
      { label: "Source", value: client.source || "—" },
      { label: "Phone", value: client.phone || "—" },
      { label: "Email", value: client.email || "—" },
      { label: "Address", value: client.address || "—", fullWidth: true },
    ],
    [client]
  );

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow={client.reference ? `Client Profile · ${client.reference}` : "Client Profile"}
        title={client.name}
        actions={
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.9rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
            {canEdit && (
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  ...primaryButton,
                  padding: "0.65rem 0.9rem",
                  fontSize: "0.82rem",
                }}
              >
                <PencilLine size={15} /> Edit Profile
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  ...dangerButton,
                  padding: "0.65rem 0.9rem",
                  fontSize: "0.82rem",
                  background: "#fff1f2",
                  color: "#be123c",
                  border: "1px solid #fecdd3",
                  boxShadow: "none",
                }}
              >
                <Trash2 size={15} /> Delete Permanently
              </button>
            )}
            </div>
            <Link
              to="/clients"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                ...secondaryButton,
                textDecoration: "none",
                paddingTop: "0.15rem",
              }}
            >
              <ArrowLeft size={16} /> Back to Client Profiles
            </Link>
          </div>
        }
      />

      <section style={{ ...neutralCard, marginBottom: "1rem", padding: "1rem 1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Client record</p>
            <h2 style={{ margin: "0.35rem 0 0", color: colors.ink, fontSize: "1.2rem", fontWeight: 800 }}>Profile overview</h2>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
          {overviewFields.map((field) => (
            <div key={field.label} style={{ gridColumn: field.fullWidth ? "1 / -1" : "span 1" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>
                {field.label}
              </div>
              <div style={{ marginTop: "0.35rem", fontSize: "0.95rem", color: "#0f172a", fontWeight: 600, lineHeight: 1.5 }}>
                {field.value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid #e2e8f0", fontSize: "0.74rem", color: "#64748b" }}>
          Created {formatDateTime(client.createdAt)} • Last updated {formatDateTime(client.updatedAt)}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.5rem" }}>
        <section style={{ ...neutralCard, padding: "1rem 1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Client history</p>
              <h2 style={{ margin: "0.35rem 0 0", color: colors.ink, fontSize: "1.2rem" }}>Service history</h2>
            </div>
            <span style={{ color: colors.muted, fontSize: "0.8rem" }}>{serviceHistory.length} appointment{serviceHistory.length === 1 ? "" : "s"}</span>
          </div>
          {serviceHistory.length === 0 ? (
            <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: "10px", background: "#f8fafc", color: colors.muted, fontSize: "0.85rem" }}>No service history recorded yet.</div>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
              {serviceHistory.map((appointment) => (
                <button type="button" key={appointment.id} onClick={() => setSelectedHistory(appointment)} style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "0.9rem", background: "#fff", textAlign: "left", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <strong style={{ color: colors.ink }}>{formatDateTime(appointment.scheduledAt)}</strong>
                    <span style={{ color: colors.brandInk, background: "#fef2f2", borderRadius: "999px", padding: "0.25rem 0.55rem", fontSize: "0.7rem", fontWeight: 800 }}>{appointment.status}</span>
                  </div>
                  {(appointment.serviceType || appointment.serviceLocation) && <p style={{ margin: "0.4rem 0 0", color: colors.muted, fontSize: "0.76rem" }}>{[appointment.serviceType, appointment.serviceLocation].filter(Boolean).join(" • ")}</p>}
                  {appointment.notes && <p style={{ margin: "0.55rem 0 0", color: colors.body, fontSize: "0.84rem" }}>{appointment.notes}</p>}
                  {appointment.report && <div style={{ marginTop: "0.65rem", paddingTop: "0.65rem", borderTop: "1px solid #f1f5f9" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Inspection and treatment report</div><div style={{ marginTop: "0.25rem", color: colors.body, fontSize: "0.84rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{appointment.report}</div>{appointment.reportSubmittedAt && <div style={{ marginTop: "0.35rem", color: colors.muted, fontSize: "0.7rem" }}>Submitted {formatDateTime(appointment.reportSubmittedAt)}</div>}</div>}
                  {(appointment.attachments || []).length > 0 && <div style={{ marginTop: "0.65rem", paddingTop: "0.65rem", borderTop: "1px solid #f1f5f9" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Report attachments</div><div style={{ marginTop: "0.35rem", color: colors.body, fontSize: "0.78rem" }}>{appointment.attachments.length} file{appointment.attachments.length === 1 ? "" : "s"} — click this visit to view or download them.</div></div>}
                  {(appointment.stockUsed || []).length > 0 && <div style={{ marginTop: "0.65rem", paddingTop: "0.65rem", borderTop: "1px solid #f1f5f9" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Materials used</div><div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.35rem" }}>{appointment.stockUsed.map((entry, index) => <span key={`${entry.itemId}-${index}`} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "0.3rem 0.45rem", color: colors.body, fontSize: "0.75rem" }}>{entry.name}: {entry.amount} {entry.unit}</span>)}</div></div>}
                </button>
              ))}
            </div>
          )}
        </section>
        <div style={{ ...neutralCard, padding: "1rem 1.25rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "0.3rem", color: colors.body, fontSize: "1.05rem" }}>Client documents</h2>
          <p style={{ margin: "0 0 1rem", color: colors.muted, fontSize: "0.76rem" }}>Paperwork that belongs to the client, not to one visit. Photos and signed forms for a service go in that appointment's Report tab.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "0.7rem", alignItems: "start" }}>
            {DOCUMENT_CATEGORIES.map((category) => <ClientDocuments
              key={category.value}
              compact
              title={category.label}
              uploadLabel={category.uploadLabel}
              documents={(client.documents || []).filter((document) => (document.category || "OTHER") === category.value)}
              canUpload={canUploadDocuments}
              canRemove={canRemoveDocuments}
              onUpload={(file) => onUploadDocument(file, category.value)}
              onRemove={onRemoveDocument}
              onResolveUrl={onResolveDocumentUrl}
              emptyMessage="None uploaded yet."
            />)}
          </div>
        </div>
      </div>

      <ServiceReportPrinter request={printRequest} onDone={() => setPrintRequest(null)} onProblem={(text) => window.alert(text)} getAttachmentUrl={getAttachmentUrl} getSignatureUrl={getSignatureUrl} />

      {selectedHistory && <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 30, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.42)" }} onClick={() => setSelectedHistory(null)}>
        <section style={{ ...neutralCard, width: "min(100%, 680px)", maxHeight: "88vh", overflowY: "auto" }} onClick={(event) => event.stopPropagation()}>
          <ServiceReportSummary appointment={selectedHistory} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}><div><div style={{ color: colors.brand, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Service record</div><h2 style={{ margin: "0.3rem 0", color: colors.ink }}>{client.name}</h2><div style={{ color: colors.body, fontSize: "0.88rem", fontWeight: 700 }}>{formatDateTime(selectedHistory.scheduledAt)}</div><div style={{ color: colors.muted, fontSize: "0.82rem", marginTop: "0.2rem" }}>{selectedHistory.status} · {selectedHistory.pestConcern || client.pestConcern || "Pest concern not recorded"} · {selectedHistory.durationMinutes || 60} minutes</div></div><div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}><button type="button" onClick={() => setPrintRequest({ appointment: selectedHistory, client, technician: accounts.find((account) => account.id === selectedHistory.technicianId) || null })} style={{ ...secondaryButton, padding: "0.45rem 0.6rem", fontSize: "0.74rem" }}><Printer size={14} /> Service form PDF</button><button type="button" aria-label="Close service record" onClick={() => setSelectedHistory(null)} style={{ ...secondaryButton, padding: "0.45rem 0.65rem" }}><X size={16} /></button></div></div>
          <div style={{ display: "grid", gap: "0.9rem", marginTop: "1.25rem" }}><InfoBlock label="Client and service address" value={`${client.name}\n${client.address || "No address recorded."}`} /><InfoBlock label="Technician" value={accounts.find((account) => account.id === selectedHistory.technicianId)?.name || accounts.find((account) => account.id === selectedHistory.technicianId)?.username || "Unassigned"} /><InfoBlock label="Pest concern" value={selectedHistory.pestConcern || client.pestConcern || "Pest concern not recorded."} /><InfoBlock label="Appointment notes" value={selectedHistory.notes || "No notes recorded."} /><InfoBlock label="Inspection and treatment report" value={selectedHistory.report || "No report recorded."} /><InfoBlock label="Materials used" value={(selectedHistory.stockUsed || []).length ? selectedHistory.stockUsed.map((entry) => `${entry.name}: ${entry.amount} ${entry.unit}${entry.batchNumber ? ` (lot ${entry.batchNumber})` : ""}`).join("\n") : "No materials recorded."} />{(selectedHistory.signaturePath || selectedHistory.completionNote) && <div style={{ padding: "0.8rem", background: selectedHistory.signaturePath ? "#f0fdf4" : "#fff7ed", border: `1px solid ${selectedHistory.signaturePath ? "#bbf7d0" : "#fed7aa"}`, borderRadius: "8px" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Completion confirmation</div>{selectedHistory.signaturePath ? <><div style={{ marginTop: "0.5rem", background: "#fff", borderRadius: "6px", padding: "0.4rem" }}>{signatureUrl ? <img src={signatureUrl} alt="Customer signature" style={{ display: "block", maxWidth: "100%", maxHeight: "120px" }} /> : <span style={{ color: colors.muted, fontSize: "0.76rem" }}>Loading signature…</span>}</div><div style={{ marginTop: "0.4rem", color: "#166534", fontWeight: 700, fontSize: "0.8rem" }}>Signed by {selectedHistory.customerName || "the customer"}</div>{selectedHistory.signedAt && <div style={{ color: colors.muted, fontSize: "0.7rem" }}>{formatDateTime(selectedHistory.signedAt)}</div>}</> : <><div style={{ marginTop: "0.3rem", color: "#9a3412", fontWeight: 700, fontSize: "0.8rem" }}>Completed without a customer signature</div><div style={{ marginTop: "0.2rem", color: colors.body, fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>{selectedHistory.completionNote}</div></>}</div>}<div style={{ padding: "0.8rem", background: "#fffaf6", border: "1px solid #f3e0d2", borderRadius: "8px" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>This visit&apos;s photos and documents{(selectedHistory.attachments || []).length > 0 && ` (${selectedHistory.attachments.length})`}</div><HistoryFileList files={selectedHistory.attachments || []} onOpen={openHistoryAttachment} emptyMessage="No photos or documents were attached to this visit." /></div><div style={{ padding: "0.8rem", background: "#f8fafc", borderRadius: "8px" }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>General client documents{(client.documents || []).length > 0 && ` (${client.documents.length})`}</div><div style={{ marginTop: "0.2rem", color: colors.muted, fontSize: "0.7rem" }}>Client ID, contracts, and permits — not tied to this visit.</div><HistoryFileList files={client.documents || []} onOpen={openHistoryDocument} emptyMessage="No general client documents on file." /></div></div>
        </section>
      </div>}

      {isEditModalOpen && canEdit && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "1rem",
            backdropFilter: "blur(2px)",
          }}
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: "20px",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
              width: "100%",
              maxWidth: "720px",
              padding: "1.5rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>Client Details</div>
                <h3 style={{ margin: "0.25rem 0 0", color: "#0f172a", fontSize: "1.4rem" }}>Edit Profile</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                style={{
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "999px",
                  border: "1px solid #e2e8f0",
                  background: "#ffffff",
                  color: "#475569",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
                aria-label="Close edit profile modal"
              >
                <X size={18} />
              </button>
            </div>

            <ClientForm initialValues={client} onSubmit={async (values) => { const result = await onSave(values); if (result !== false) setIsEditModalOpen(false); }} submitLabel="Save Changes" />
          </div>
        </div>
      )}
    </div>
  );
}

export default ClientDetails;
