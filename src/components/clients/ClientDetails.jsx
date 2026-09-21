// Full client profile: read-only summary, edit form, and documents.
//
// Sprint AC (View Single Client Profile): "Detail view displays full client
// information, classification, and attached documents" and "Staff can
// navigate back to the list or edit the profile from this view." Back
// navigation was missing entirely — the old page imported only useParams,
// with no Link anywhere.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Eye, FileText, PencilLine, Printer, Trash2, X } from "lucide-react";
import ClientForm from "./ClientForm";
import ClientDocuments, { CATEGORY_TAGS } from "./ClientDocuments";
import ServiceReportPrinter from "../scheduling/ServiceReportPrinter";
import PageHeader from "../common/PageHeader";
import { useScheduling } from "../../context/SchedulingContext";
import useUsers from "../../hooks/useUsers";
import useInventory from "../../hooks/useInventory";
import { formatDate, formatDateTime, formatFileSize, formatTime, humanizeEnum } from "../../utils/formatters";
import { DOCUMENT_CATEGORIES } from "../../utils/constants";
import { colors, dangerButton, pageShell, primaryButton, secondaryButton } from "../../styles/theme";


function treatmentMethodLabel(value) {
  if (!value) return "";
  const str = typeof value === "object" ? (value.label || value.name || value.value || "") : String(value);
  if (!str) return "";
  return str.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}


function HistoryFileList({ files = [], onOpen, onResolveUrl, onRemove, emptyMessage }) {
  const [modalFile, setModalFile] = useState(null);
  const [modalUrl, setModalUrl] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [thumbUrls, setThumbUrls] = useState({});

  useEffect(() => {
    let active = true;
    if (!onResolveUrl) return;

    files.forEach((file) => {
      const isImage = Boolean(
        file.type?.startsWith("image/") ||
        /\.(jpe?g|png|webp|gif|svg)$/i.test(file.name || "")
      );
      if (isImage && !file.url && !file.previewUrl && !thumbUrls[file.id]) {
        onResolveUrl(file, { download: false })
          .then((res) => {
            if (active && res?.url) {
              setThumbUrls((prev) => ({ ...prev, [file.id]: res.url }));
            }
          })
          .catch(() => {});
      }
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, onResolveUrl]);

  if (files.length === 0) {
    return <div style={{ marginTop: "0.35rem", color: colors.muted, fontSize: "0.84rem", fontStyle: "italic" }}>{emptyMessage}</div>;
  }

  const handlePreview = async (file) => {
    const isImage = Boolean(
      file.type?.startsWith("image/") ||
      /\.(jpe?g|png|webp|gif|svg)$/i.test(file.name || "")
    );

    if (isImage) {
      setModalFile(file);
      const cached = thumbUrls[file.id] || file.url || file.previewUrl;
      if (cached) {
        setModalUrl(cached);
      } else if (onResolveUrl) {
        setModalUrl(null);
        const res = await onResolveUrl(file, { download: false });
        if (res?.url) {
          setModalUrl(res.url);
          setThumbUrls((prev) => ({ ...prev, [file.id]: res.url }));
        }
      }
    } else {
      await onOpen?.(file, false);
    }
  };

  const handleDownload = (file) => {
    onOpen?.(file, true);
  };

  const handleRemove = async (file) => {
    if (!onRemove) return;
    setBusyId(file.id);
    await onRemove(file);
    setBusyId(null);
  };

  return (
    <>
      <div className="mt-2.5">
        {files.map((file) => {
          const busy = busyId === file.id;
          const isImage = Boolean(file.type?.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(file.name || ""));
          const imgSrc = thumbUrls[file.id] || file.url || file.previewUrl;
          const fileTag = file.tag || (file.category && (CATEGORY_TAGS[file.category]?.label || file.category));

          return (
            <div
              key={file.id}
              className="flex items-center justify-between gap-3 p-2 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 transition-colors mb-2"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                padding: "0.5rem",
                backgroundColor: "#ffffff",
                borderRadius: "0.75rem",
                border: "1px solid rgba(226, 232, 240, 0.8)",
                marginBottom: "0.5rem",
                minWidth: 0,
                transition: "border-color 0.15s ease",
              }}
            >
              <div
                className="flex items-center gap-2.5 min-w-0 flex-1"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  minWidth: 0,
                  flex: "1 1 0%",
                }}
              >
                {/* Square Thumbnail Preview or Fallback */}
                {isImage ? (
                  <div
                    className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0 cursor-pointer relative group"
                    onClick={() => handlePreview(file)}
                    title="Click to preview"
                    style={{
                      width: "2.25rem",
                      height: "2.25rem",
                      borderRadius: "0.5rem",
                      overflow: "hidden",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#f1f5f9",
                      flexShrink: 0,
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    <img
                      src={imgSrc}
                      alt={file.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                ) : (
                  <div
                    className="w-9 h-9 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 text-slate-500"
                    style={{
                      width: "2.25rem",
                      height: "2.25rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#f8fafc",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: "#64748b",
                    }}
                  >
                    <FileText className="w-4 h-4" style={{ width: "1rem", height: "1rem" }} />
                  </div>
                )}

                {/* Tag, Filename, and Date */}
                <div
                  className="flex flex-col min-w-0"
                  style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
                >
                  <div
                    className="flex items-center gap-1.5 min-w-0"
                    style={{ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}
                  >
                    {fileTag && (
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
                        style={{
                          padding: "0.125rem 0.375rem",
                          fontSize: "0.625rem",
                          fontWeight: 700,
                          borderRadius: "0.25rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          backgroundColor: "#ecfdf5",
                          color: "#047857",
                          border: "1px solid #a7f3d0",
                          flexShrink: 0,
                        }}
                      >
                        {fileTag}
                      </span>
                    )}
                    <span
                      className="text-xs font-semibold text-slate-800 truncate"
                      title={file.name}
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "#1e293b",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.name}
                    </span>
                  </div>
                  <span
                    className="text-[10px] text-slate-400 mt-0.5 truncate"
                    style={{ fontSize: "0.625rem", color: "#94a3b8", marginTop: "0.125rem" }}
                  >
                    {file.size ? `${typeof file.size === "number" ? formatFileSize(file.size) : file.size} • ` : ""}
                    {file.date || (file.uploadedAt ? formatDateTime(file.uploadedAt) : "Attached")}
                  </span>
                </div>
              </div>

              {/* Right Side (Action Icon Buttons) */}
              <div
                className="flex items-center gap-1 shrink-0"
                style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}
              >
                <button
                  type="button"
                  title="Preview"
                  onClick={() => handlePreview(file)}
                  disabled={busy}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  style={{
                    padding: "0.375rem",
                    color: "#94a3b8",
                    backgroundColor: "transparent",
                    border: "none",
                    borderRadius: "0.5rem",
                    cursor: busy ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Eye className="w-3.5 h-3.5" style={{ width: "0.875rem", height: "0.875rem" }} />
                </button>
                <button
                  type="button"
                  title="Download"
                  onClick={() => handleDownload(file)}
                  disabled={busy}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  style={{
                    padding: "0.375rem",
                    color: "#94a3b8",
                    backgroundColor: "transparent",
                    border: "none",
                    borderRadius: "0.5rem",
                    cursor: busy ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Download className="w-3.5 h-3.5" style={{ width: "0.875rem", height: "0.875rem" }} />
                </button>
                {onRemove && (
                  <button
                    type="button"
                    title="Remove attachment"
                    onClick={() => handleRemove(file)}
                    disabled={busy}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    style={{
                      padding: "0.375rem",
                      color: "#94a3b8",
                      backgroundColor: "transparent",
                      border: "none",
                      borderRadius: "0.5rem",
                      cursor: busy ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ width: "0.875rem", height: "0.875rem" }} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modalFile && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setModalFile(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            backgroundColor: "rgba(15, 23, 42, 0.8)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col w-full"
            style={{
              position: "relative",
              maxWidth: "52rem",
              maxHeight: "90vh",
              backgroundColor: "#ffffff",
              borderRadius: "1rem",
              overflow: "hidden",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
              width: "100%",
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1rem",
                borderBottom: "1px solid #e2e8f0",
                backgroundColor: "#f8fafc",
              }}
            >
              <span
                className="text-xs font-bold text-slate-800 truncate"
                style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {modalFile.name}
              </span>
              <div className="flex items-center gap-2" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => onOpen?.(modalFile, true)}
                  title="Download"
                  className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                  style={{
                    padding: "0.375rem",
                    color: "#64748b",
                    backgroundColor: "transparent",
                    border: "none",
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  <Download className="w-4 h-4" style={{ width: "1rem", height: "1rem" }} />
                </button>
                <button
                  type="button"
                  onClick={() => setModalFile(null)}
                  title="Close"
                  className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                  style={{
                    padding: "0.375rem",
                    color: "#64748b",
                    backgroundColor: "transparent",
                    border: "none",
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  <X className="w-4 h-4" style={{ width: "1rem", height: "1rem" }} />
                </button>
              </div>
            </div>
            <div
              className="p-4 flex items-center justify-center overflow-auto min-h-[240px] bg-slate-950"
              style={{
                padding: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "auto",
                minHeight: "240px",
                backgroundColor: "#090d16",
              }}
            >
              {modalUrl ? (
                <img
                  src={modalUrl}
                  alt={modalFile.name}
                  className="max-h-[75vh] max-w-full object-contain rounded-md"
                  style={{ maxHeight: "75vh", maxWidth: "100%", objectFit: "contain", borderRadius: "0.375rem" }}
                />
              ) : (
                <div className="text-xs text-slate-400 animate-pulse" style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  Loading preview...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
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
  const { appointments, getAttachmentUrl, getSignatureUrl, removeAttachment } = useScheduling();
  const { staff, technicians } = useUsers();
  const { inventory } = useInventory();
  const accounts = [...staff, ...technicians];
  const serviceHistory = appointments
    .filter((appointment) => appointment.clientId === client.id && appointment.status === "Completed")
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  const [printRequest, setPrintRequest] = useState(null);
  const [signatureUrl, setSignatureUrl] = useState("");
  const [technicianSignatureUrl, setTechnicianSignatureUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!selectedHistory?.signaturePath) setSignatureUrl("");
    else getSignatureUrl(selectedHistory.signaturePath).then((result) => {
      if (!cancelled) setSignatureUrl(result?.url || "");
    });
    if (!selectedHistory?.technicianSignaturePath) setTechnicianSignatureUrl("");
    else getSignatureUrl(selectedHistory.technicianSignaturePath).then((result) => {
      if (!cancelled) setTechnicianSignatureUrl(result?.url || "");
    });
    return () => { cancelled = true; };
  }, [selectedHistory?.signaturePath, selectedHistory?.technicianSignaturePath, getSignatureUrl]);

  const openHistoryDocument = async (document, download = false) => {
    const result = await onResolveDocumentUrl(document, { download });
    if (result?.url) window.open(result.url, download ? "_self" : "_blank", "noopener,noreferrer");
  };
  const openHistoryAttachment = async (attachment, download = false) => {
    const result = await getAttachmentUrl(attachment, { download });
    if (result?.url) window.open(result.url, download ? "_self" : "_blank", "noopener,noreferrer");
  };

  const handleRemoveVisitAttachment = async (file) => {
    if (typeof window !== "undefined" && window.confirm) {
      const confirmed = window.confirm(`Are you sure you want to remove ${file.name || "this attachment"}?`);
      if (!confirmed) return;
    }
    const result = await removeAttachment({ ...file, appointmentId: file.appointmentId || selectedHistory?.id });
    if (result === true) {
      setSelectedHistory((prev) => prev ? {
        ...prev,
        attachments: (prev.attachments || []).filter((a) => a.id !== file.id),
      } : prev);
    }
  };
  const overviewFields = useMemo(
    () => [
      { label: "Client No.", value: client.reference || "—" },
      { label: "Classification", value: client.classification === "OTHER" && client.classificationOther ? client.classificationOther : humanizeEnum(client.classification) },
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
                padding: "0.65rem 0.9rem",
                fontSize: "0.82rem",
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
                    {appointment.status === "Completed" ? (
                      <span
                        className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-medium px-2.5 py-0.5 rounded-full text-xs inline-flex items-center gap-1"
                        style={{
                          background: "#ecfdf5",
                          color: "#047857",
                          border: "1px solid rgba(167, 243, 208, 0.8)",
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          padding: "0.15rem 0.55rem",
                          borderRadius: "9999px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" style={{ width: "0.375rem", height: "0.375rem", borderRadius: "9999px", background: "#10b981", display: "inline-block" }}></span>
                        {appointment.status}
                      </span>
                    ) : (
                      <span style={{ color: colors.brandInk, background: "#fef2f2", borderRadius: "999px", padding: "0.25rem 0.55rem", fontSize: "0.7rem", fontWeight: 800 }}>{appointment.status}</span>
                    )}
                  </div>
                  {(appointment.serviceType || appointment.serviceLocation) && <p style={{ margin: "0.4rem 0 0", color: colors.muted, fontSize: "0.76rem" }}>{[appointment.serviceType, appointment.serviceLocation].filter(Boolean).join(" • ")}</p>}
                  {appointment.notes && <p style={{ margin: "0.55rem 0 0", color: colors.body, fontSize: "0.84rem" }}>{appointment.notes}</p>}
                  {(appointment.report || appointment.treatmentPerformed || (appointment.treatmentMethods || []).length > 0) && <div style={{ marginTop: "0.65rem", paddingTop: "0.65rem", borderTop: "1px solid #f1f5f9" }}>
                    {appointment.report && <><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Inspection findings</div><div style={{ marginTop: "0.25rem", color: colors.body, fontSize: "0.84rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{appointment.report}</div></>}
                    {(appointment.treatmentPerformed || (appointment.treatmentMethods || []).length > 0) && <div style={{ marginTop: appointment.report ? "0.6rem" : 0 }}><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Treatment performed</div>{(appointment.treatmentMethods || []).length > 0 && <div style={{ marginTop: "0.25rem", color: colors.body, fontSize: "0.8rem" }}>{appointment.treatmentMethods.map(treatmentMethodLabel).join(" · ")}</div>}{appointment.treatmentPerformed && <div style={{ marginTop: "0.25rem", color: colors.body, fontSize: "0.84rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{appointment.treatmentPerformed}</div>}</div>}
                    {appointment.reportSubmittedAt && <div style={{ marginTop: "0.35rem", color: colors.muted, fontSize: "0.7rem" }}>Submitted {formatDateTime(appointment.reportSubmittedAt)}</div>}
                  </div>}
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

      {selectedHistory && (() => {
        const technician = accounts.find((a) => a.id === selectedHistory.technicianId);
        const technicianName = technician?.name || technician?.username || "Unassigned";
        const treatmentMethods = (selectedHistory.treatmentMethods || []).map(treatmentMethodLabel);

        return (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: "fixed", inset: 0, zIndex: 30, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.45)" }}
            onClick={() => setSelectedHistory(null)}
          >
            <section
              style={{ ...neutralCard, width: "min(100%, 660px)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Fixed Header ── */}
              <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexShrink: 0 }}>
                <div>
                  <div style={{ color: colors.brand, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>Service Record</div>
                  <h2 style={{ margin: "0.25rem 0 0", fontSize: "1.45rem", fontWeight: 700, color: colors.ink, lineHeight: 1.2 }}>{client.name}</h2>
                  <div style={{ marginTop: "0.4rem", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem", fontSize: "0.78rem", color: colors.muted }}>
                    <span>{formatDateTime(selectedHistory.scheduledAt)}</span>
                    <span>·</span>
                    {selectedHistory.status === "Completed" ? (
                      <span
                        className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-medium px-2.5 py-0.5 rounded-full text-xs inline-flex items-center gap-1"
                        style={{
                          background: "#ecfdf5",
                          color: "#047857",
                          border: "1px solid rgba(167, 243, 208, 0.8)",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          padding: "0.125rem 0.625rem",
                          borderRadius: "9999px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" style={{ width: "0.375rem", height: "0.375rem", borderRadius: "9999px", background: "#10b981", display: "inline-block" }}></span>
                        {selectedHistory.status}
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "0.1rem 0.55rem", borderRadius: "999px", fontSize: "0.68rem", fontWeight: 700, background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0" }}>{selectedHistory.status}</span>
                    )}
                    <span>·</span>
                    <span>{selectedHistory.serviceType || selectedHistory.pestConcern || client.pestConcern || "General Service"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setPrintRequest({ appointment: selectedHistory, client, technician: technician || null, inventory })}
                    style={{ ...secondaryButton, display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.75rem", fontSize: "0.74rem" }}
                  >
                    <Printer size={14} /> Service form PDF
                  </button>
                  <button
                    type="button"
                    aria-label="Close service record"
                    onClick={() => setSelectedHistory(null)}
                    style={{ ...secondaryButton, padding: "0.45rem 0.6rem" }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* ── Scrollable Body ── */}
              <div style={{ overflowY: "auto", padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

                {/* ── 1. Quick Metadata Top Row (4 micro-cards) ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.625rem", alignItems: "stretch" }}>
                  {/* Technician */}
                  <div style={{ padding: "0.625rem", background: "#f8fafc", border: "1px solid rgba(148,163,184,0.5)", borderRadius: "12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <span style={{ display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Technician</span>
                    <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#0f172a", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={technicianName}>
                      {technicianName}
                    </span>
                  </div>
                  {/* Pest Concern */}
                  <div style={{ padding: "0.625rem", background: "#f8fafc", border: "1px solid rgba(148,163,184,0.5)", borderRadius: "12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <span style={{ display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Pest Concern</span>
                    {(selectedHistory.pestConcern || client.pestConcern) ? (
                      <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#0f172a", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={selectedHistory.pestConcern || client.pestConcern}>
                        {selectedHistory.pestConcern || client.pestConcern}
                      </span>
                    ) : (
                      <span style={{ display: "block", fontSize: "0.72rem", color: "#94a3b8", fontStyle: "italic", marginTop: "0.25rem" }}>
                        Not recorded
                      </span>
                    )}
                  </div>
                  {/* Follow-Up Date */}
                  <div style={{ padding: "0.625rem", background: "#f8fafc", border: "1px solid rgba(148,163,184,0.5)", borderRadius: "12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <span style={{ display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Follow-Up Date</span>
                    {selectedHistory.followUpDate
                      ? <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#0f172a", marginTop: "0.25rem" }}>{selectedHistory.followUpDate}</span>
                      : <span style={{ display: "block", fontSize: "0.72rem", color: "#94a3b8", fontStyle: "italic", marginTop: "0.25rem" }}>No follow-up scheduled</span>
                    }
                  </div>
                  {/* Report Submitted */}
                  <div style={{ padding: "0.625rem", background: "#f8fafc", border: "1px solid rgba(148,163,184,0.5)", borderRadius: "12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <span style={{ display: "block", fontSize: "0.58rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#64748b", whiteSpace: "nowrap" }}>Report Submitted</span>
                    {selectedHistory.reportSubmittedAt ? (
                      <div style={{ marginTop: "0.25rem", lineHeight: 1.35 }}>
                        <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap" }}>
                          {formatDate(selectedHistory.reportSubmittedAt)}
                        </span>
                        <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 500, color: colors.muted, whiteSpace: "nowrap" }}>
                          {formatTime(selectedHistory.reportSubmittedAt)}
                        </span>
                      </div>
                    ) : (
                      <span style={{ display: "block", fontSize: "0.72rem", color: "#94a3b8", fontStyle: "italic", marginTop: "0.25rem" }}>
                        Not submitted
                      </span>
                    )}
                  </div>
                </div>

                {/* ── 2. Balanced 2-Column Section ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "start" }}>

                  {/* LEFT: Service Location + Notes + Findings */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>

                    {/* Service Location */}
                    <div style={{ paddingBottom: "0.9rem", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Service Location</div>
                      <div style={{ marginTop: "0.35rem", fontSize: "0.88rem", color: colors.body, lineHeight: 1.5 }}>
                        {selectedHistory.serviceLocation || client.address || <span style={{ color: colors.muted, fontStyle: "italic" }}>No address recorded.</span>}
                      </div>
                    </div>

                    {/* Appointment Notes */}
                    <div style={{ paddingTop: "0.9rem", paddingBottom: "0.9rem", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Appointment Notes</div>
                      <div style={{ marginTop: "0.3rem", fontSize: "0.84rem", color: colors.body, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                        {selectedHistory.notes || <span style={{ color: colors.muted, fontStyle: "italic" }}>No notes recorded.</span>}
                      </div>
                    </div>

                    {/* Inspection Findings */}
                    <div style={{ paddingTop: "0.9rem" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Inspection Findings</div>
                      <div style={{ marginTop: "0.3rem", fontSize: "0.84rem", color: colors.body, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                        {selectedHistory.report || <span style={{ color: colors.muted, fontStyle: "italic" }}>No findings recorded.</span>}
                      </div>
                    </div>

                  </div>

                  {/* RIGHT: Treatment + Materials + Recommendations */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0", borderLeft: "1px solid #f1f5f9", paddingLeft: "1rem" }}>

                    {/* Treatment Performed */}
                    <div style={{ paddingBottom: "0.9rem", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Treatment Performed</div>
                      <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {treatmentMethods.length > 0 ? treatmentMethods.map((method, idx) => (
                          <span key={idx} style={{ display: "inline-flex", padding: "0.2rem 0.55rem", fontSize: "0.72rem", fontWeight: 600, background: idx === 0 ? "#fef2f2" : "#f8fafc", color: idx === 0 ? "#991b1b" : "#475569", border: `1px solid ${idx === 0 ? "#fecaca" : "#e2e8f0"}`, borderRadius: "6px" }}>
                            {method}
                          </span>
                        )) : selectedHistory.treatmentPerformed ? (
                          <span style={{ fontSize: "0.84rem", color: colors.body }}>{selectedHistory.treatmentPerformed}</span>
                        ) : (
                          <span style={{ fontSize: "0.84rem", color: colors.muted, fontStyle: "italic" }}>No treatment recorded.</span>
                        )}
                      </div>
                    </div>

                    {/* Materials Used */}
                    {(selectedHistory.stockUsed || []).length > 0 && (
                      <div style={{ paddingTop: "0.9rem", paddingBottom: "0.9rem", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Materials Used</div>
                        <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                          {selectedHistory.stockUsed.map((item, idx) => (
                            <span key={idx} style={{ display: "inline-flex", alignItems: "center", padding: "0.2rem 0.55rem", fontSize: "0.72rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "6px", color: "#334155" }}>
                              {item.name}:<strong style={{ marginLeft: "0.25rem", fontWeight: 700, color: "#0f172a" }}>{item.amount} {item.unit}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    <div style={{ paddingTop: "0.9rem" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Recommendations</div>
                      <div style={{ marginTop: "0.3rem", fontSize: "0.84rem", lineHeight: 1.5 }}>
                        {selectedHistory.recommendations
                          ? <span style={{ color: colors.body }}>{selectedHistory.recommendations}</span>
                          : <span style={{ color: colors.muted, fontStyle: "italic" }}>No recommendations recorded.</span>
                        }
                      </div>
                    </div>

                  </div>
                </div>

                {/* Completion Confirmation */}
                {(selectedHistory.signaturePath || selectedHistory.technicianSignaturePath || selectedHistory.completionNote) && (
                  <div style={{ paddingTop: "1.1rem", paddingBottom: "1.1rem", borderBottom: "1px solid #f1f5f9", background: selectedHistory.signaturePath ? "#f0fdf4" : "#fff7ed", borderRadius: "8px", padding: "1rem", margin: "0.5rem 0" }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Completion Confirmation</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
                      <div>
                        <div style={{ color: "#64748b", fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Client signature</div>
                        {selectedHistory.signaturePath ? (
                          <>
                            <div style={{ marginTop: "0.35rem", background: "#fff", borderRadius: "6px", padding: "0.4rem", display: "inline-block" }}>
                              {signatureUrl
                                ? <img src={signatureUrl} alt="Customer signature" style={{ display: "block", maxWidth: "100%", maxHeight: "100px" }} />
                                : <span style={{ color: colors.muted, fontSize: "0.76rem" }}>Loading signature…</span>}
                            </div>
                            <div style={{ marginTop: "0.4rem", color: "#166534", fontWeight: 700, fontSize: "0.82rem" }}>Signed by {selectedHistory.customerName || "the customer"}</div>
                            {selectedHistory.signedAt && <div style={{ color: colors.muted, fontSize: "0.72rem" }}>{formatDateTime(selectedHistory.signedAt)}</div>}
                          </>
                        ) : (
                          <>
                            <div style={{ marginTop: "0.3rem", color: "#9a3412", fontWeight: 700, fontSize: "0.82rem" }}>Completed without a customer signature</div>
                            <div style={{ marginTop: "0.2rem", color: colors.body, fontSize: "0.84rem", whiteSpace: "pre-wrap" }}>{selectedHistory.completionNote}</div>
                          </>
                        )}
                      </div>
                      <div>
                        <div style={{ color: "#64748b", fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>Technician signature</div>
                        {selectedHistory.technicianSignaturePath ? (
                          <>
                            <div style={{ marginTop: "0.35rem", background: "#fff", borderRadius: "6px", padding: "0.4rem", display: "inline-block" }}>
                              {technicianSignatureUrl
                                ? <img src={technicianSignatureUrl} alt="Technician signature" style={{ display: "block", maxWidth: "100%", maxHeight: "100px" }} />
                                : <span style={{ color: colors.muted, fontSize: "0.76rem" }}>Loading signature…</span>}
                            </div>
                            <div style={{ marginTop: "0.4rem", color: "#166534", fontWeight: 700, fontSize: "0.82rem" }}>Signed by {accounts.find((account) => account.id === selectedHistory.technicianId)?.name || accounts.find((account) => account.id === selectedHistory.technicianId)?.username || "the technician"}</div>
                            {selectedHistory.technicianSignedAt && <div style={{ color: colors.muted, fontSize: "0.72rem" }}>{formatDateTime(selectedHistory.technicianSignedAt)}</div>}
                          </>
                        ) : (
                          <div style={{ marginTop: "0.3rem", color: colors.muted, fontSize: "0.82rem", fontStyle: "italic" }}>No technician signature on file.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* This visit's photos and documents */}
                <div style={{ paddingTop: "1.1rem", paddingBottom: "1.1rem", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>
                    This visit&apos;s photos and documents{(selectedHistory.attachments || []).length > 0 && ` (${selectedHistory.attachments.length})`}
                  </div>
                  <HistoryFileList
                    files={selectedHistory.attachments || []}
                    onOpen={openHistoryAttachment}
                    onResolveUrl={getAttachmentUrl}
                    onRemove={handleRemoveVisitAttachment}
                    emptyMessage="No photos or documents were attached to this visit."
                  />
                </div>

                {/* General client documents */}
                <div style={{ paddingTop: "1.1rem" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>
                    General client documents{(client.documents || []).length > 0 && ` (${client.documents.length})`}
                  </div>
                  <div style={{ marginTop: "0.2rem", color: colors.muted, fontSize: "0.72rem" }}>Client ID, contracts, and permits — not tied to this visit.</div>
                  <HistoryFileList
                    files={client.documents || []}
                    onOpen={openHistoryDocument}
                    onResolveUrl={onResolveDocumentUrl}
                    onRemove={canRemoveDocuments ? (doc) => onRemoveDocument?.(client.id, doc) : null}
                    emptyMessage="No general client documents on file."
                  />
                </div>

              </div>
            </section>
          </div>
        );
      })()}

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
