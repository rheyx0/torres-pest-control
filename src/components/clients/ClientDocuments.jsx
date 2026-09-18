// Upload and manage attached files, for two different owners:
//
//   - a client (contracts, IDs, permits) — the roomy default layout
//   - one appointment's service report — the `compact` layout, rendered once
//     per file type so before pictures, after pictures and signed forms each
//     get their own section and their own upload button
//
// Sprint ACs covered:
//   - "Staff can upload documents (e.g., PDF, image) and attach them"
//   - "Staff can view, download, or delete uploaded documents"
//   - "System validates file type/size before upload"
//   - "Uploaded documents are listed under the client's profile"
//
// Files go to a private Storage bucket. Because the bucket is private there is
// no permanent URL to store — Preview and Download mint a short-lived signed
// URL when clicked. That replaces the old URL.createObjectURL approach, where
// the "URL" was a pointer into this tab's memory that died on reload.

import { useRef, useState } from "react";
import { Trash2, UploadCloud } from "lucide-react";
import EmptyState from "../common/EmptyState";
import { validateDocument } from "../../utils/validators";
import { formatDate, formatFileSize } from "../../utils/formatters";
import { colors } from "../../styles/theme";

// Report files carry a category (migration 029). OTHER is deliberately absent —
// an untyped file shows no pill, which is also how pre-029 rows render.
const CATEGORY_TAGS = {
  BEFORE: { label: "Before", background: "#fef3c7", color: "#92400e" },
  AFTER: { label: "After", background: "#dcfce7", color: "#166534" },
  INSPECTION: { label: "Inspection", background: "#e0f2fe", color: "#075985" },
  SIGNED_FORM: { label: "Signed", background: "#e0e7ff", color: "#3730a3" },
  TREATMENT_PROOF: { label: "Proof", background: "#fae8ff", color: "#86198f" },
  CLIENT_ID: { label: "Valid ID", background: "#e0f2fe", color: "#075985" },
  CONTRACT: { label: "Contract", background: "#e0e7ff", color: "#3730a3" },
  PROPERTY: { label: "Property", background: "#dcfce7", color: "#166534" },
  PERMIT: { label: "Permit", background: "#fef3c7", color: "#92400e" },
};

export function CategoryTag({ category }) {
  const tag = CATEGORY_TAGS[category];
  if (!tag) return null;

  return (
    <span
      style={{
        background: tag.background,
        color: tag.color,
        borderRadius: "5px",
        padding: "0.15rem 0.4rem",
        fontSize: "0.63rem",
        fontWeight: 800,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        flex: "none",
      }}
    >
      {tag.label}
    </span>
  );
}

function ClientDocuments({
  documents = [],
  canUpload = false,
  canRemove = false,
  onUpload,
  onRemove,
  onResolveUrl,
  title = "Attached Documents",
  hint = "PDF, DOCX, PNG up to 2MB",
  accept = ".pdf,.doc,.docx,.png,.jpg,.jpeg",
  validate = validateDocument,
  emptyMessage = "No documents attached yet.",
  compact = false,
  uploadLabel = "Upload file",
}) {
  const [message, setMessage] = useState(null); // { text, tone }
  const [busyId, setBusyId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const processFile = async (file) => {
    if (!file) return;

    // Client-side gate. Storage also enforces size and MIME type server-side,
    // so bypassing this doesn't get a bad file into the bucket.
    const validationError = validate(file);
    if (validationError) {
      setMessage({ text: validationError, tone: "error" });
      return;
    }

    setUploading(true);
    setMessage(null);
    const result = await onUpload?.(file);
    setUploading(false);

    setMessage(
      result === true
        ? { text: `Uploaded ${file.name}.`, tone: "success" }
        : { text: typeof result === "string" ? result : "Upload failed.", tone: "error" }
    );
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await processFile(file);
    event.target.value = "";
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    await processFile(file);
  };

  const dragHandlers = {
    onDragOver: (event) => {
      event.preventDefault();
      if (!uploading) setIsDragging(true);
    },
    onDragEnter: (event) => {
      event.preventDefault();
      if (!uploading) setIsDragging(true);
    },
    onDragLeave: (event) => {
      event.preventDefault();
      setIsDragging(false);
    },
    onDrop: handleDrop,
  };

  const handleOpen = async (document, download) => {
    setBusyId(document.id);
    const { url, error } = await onResolveUrl(document, { download });
    setBusyId(null);

    if (error) {
      setMessage({ text: error, tone: "error" });
      return;
    }

    // Signed URLs expire, so navigate immediately rather than rendering a link.
    window.open(url, download ? "_self" : "_blank", "noopener,noreferrer");
  };

  const handleRemove = async (document) => {
    setBusyId(document.id);
    const result = await onRemove?.(document);
    setBusyId(null);
    if (result !== true) {
      setMessage({ text: typeof result === "string" ? result : "Delete failed.", tone: "error" });
    }
  };

  const actionStyle = (background, color, disabled) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    background,
    color,
    border: "none",
    borderRadius: "8px",
    padding: compact ? "0.35rem 0.5rem" : "0.5rem 0.7rem",
    fontSize: compact ? "0.7rem" : "inherit",
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  });

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      onChange={handleFileUpload}
      disabled={uploading}
      style={{ display: "none" }}
    />
  );

  const statusMessage = message && (
    <div
      role="status"
      style={{
        marginTop: compact ? "0.45rem" : "0.75rem",
        color: message.tone === "success" ? colors.success : colors.danger,
        fontWeight: 600,
        fontSize: compact ? "0.72rem" : "0.8rem",
      }}
    >
      {message.text}
    </div>
  );

  const fileList = documents.map((document) => {
    const busy = busyId === document.id;

    return (
      <div
        key={document.id}
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: compact ? "0.5rem" : "1rem",
          border: "1px solid #e2e8f0",
          borderRadius: compact ? "9px" : "12px",
          padding: compact ? "0.5rem 0.6rem" : "0.9rem 1rem",
          alignItems: "center",
          flexWrap: "wrap",
          background: "#ffffff",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              flexWrap: "wrap",
              fontWeight: 700,
              fontSize: compact ? "0.78rem" : "inherit",
              color: colors.body,
            }}
          >
            {!compact && <CategoryTag category={document.category} />}
            {document.name}
          </div>
          <div
            style={{
              color: colors.muted,
              fontSize: compact ? "0.68rem" : "0.78rem",
              marginTop: "0.2rem",
            }}
          >
            {formatDate(document.uploadedAt)} • {formatFileSize(document.size)}
          </div>
        </div>

        <div style={{ display: "flex", gap: compact ? "0.3rem" : "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => handleOpen(document, false)}
            disabled={busy}
            style={actionStyle("#f8fafc", colors.body, busy)}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => handleOpen(document, true)}
            disabled={busy}
            style={actionStyle("#eef2ff", colors.body, busy)}
          >
            Download
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={() => handleRemove(document)}
              disabled={busy}
              aria-label={`Delete ${document.name}`}
              style={actionStyle("#fee2e2", "#991b1b", busy)}
            >
              <Trash2 size={compact ? 12 : 14} />
              {!compact && " Delete"}
            </button>
          )}
        </div>
      </div>
    );
  });

  // One file type, one section, one upload button — used by the Report tab.
  if (compact) {
    return (
      <section
        {...dragHandlers}
        style={{
          border: `1px solid ${isDragging ? "#7f1d1d" : "#e7dede"}`,
          borderRadius: "12px",
          padding: "0.65rem 0.8rem",
          background: isDragging ? "#fff7f7" : "#ffffff",
          transition: "border-color 0.2s ease, background-color 0.2s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginBottom: documents.length ? "0.55rem" : "0.3rem",
          }}
        >
          <h3 style={{ margin: 0, color: colors.body, fontSize: "0.82rem", fontWeight: 800 }}>
            {title}{" "}
            <span style={{ color: colors.muted, fontWeight: 600, fontSize: "0.74rem" }}>
              ({documents.length})
            </span>
          </h3>

          {canUpload && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                background: "#fff5f5",
                color: colors.brandInk,
                border: "1px solid #f0d7d7",
                borderRadius: "8px",
                padding: "0.4rem 0.6rem",
                fontSize: "0.72rem",
                fontWeight: 700,
                cursor: uploading ? "default" : "pointer",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              <UploadCloud size={13} /> {uploading ? "Uploading..." : uploadLabel}
            </button>
          )}
          {fileInput}
        </div>

        {documents.length === 0 ? (
          <div style={{ color: colors.muted, fontSize: "0.72rem", opacity: 0.85 }}>{emptyMessage}</div>
        ) : (
          <div style={{ display: "grid", gap: "0.45rem" }}>{fileList}</div>
        )}

        {statusMessage}
      </section>
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: "1rem", color: colors.body, fontSize: "1.05rem" }}>{title}</h2>

      {canUpload && (
        <div style={{ marginBottom: "1rem" }}>
          <label
            onClick={() => inputRef.current?.click()}
            {...dragHandlers}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.65rem",
              width: "100%",
              border: `2px dashed ${isDragging ? "#7f1d1d" : "#dfe4ea"}`,
              borderRadius: "16px",
              padding: "1.5rem 1rem",
              background: isDragging ? "#fff7f7" : "#f8fafc",
              color: "#475569",
              textAlign: "center",
              cursor: uploading ? "default" : "pointer",
              transition: "border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease",
              opacity: uploading ? 0.7 : 1,
              boxShadow: isDragging ? "0 0 0 3px rgba(127, 17, 17, 0.08)" : "none",
            }}
          >
            <UploadCloud size={26} color="#64748b" />
            <div>
              <div style={{ fontWeight: 700, color: "#0f172a" }}>Click to upload or drag and drop</div>
              <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: "#64748b" }}>{hint}</div>
            </div>
            {fileInput}
          </label>
          {statusMessage}
        </div>
      )}

      {documents.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>{fileList}</div>
      )}
    </div>
  );
}

export default ClientDocuments;
