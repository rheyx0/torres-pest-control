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

import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Trash2, UploadCloud } from "lucide-react";
import EmptyState from "../common/EmptyState";
import ImagePreviewModal, { isImageFile } from "../common/ImagePreviewModal";
import { validateDocument } from "../../utils/validators";
import { formatDate, formatFileSize } from "../../utils/formatters";
import { colors } from "../../styles/theme";

// Report files carry a category (migration 029). OTHER is deliberately absent —
// an untyped file shows no pill, which is also how pre-029 rows render.
export const CATEGORY_TAGS = {
  BEFORE: { label: "Before", background: "#faf0e2", color: "#a06a24" },
  AFTER: { label: "After", background: "#dcfce7", color: "#4a6b4a" },
  INSPECTION: { label: "Inspection", background: "#e0f2fe", color: "#075985" },
  SIGNED_FORM: { label: "Signed", background: "#e0e7ff", color: "#3730a3" },
  TREATMENT_PROOF: { label: "Proof", background: "#fae8ff", color: "#86198f" },
  CLIENT_ID: { label: "Valid ID", background: "#e0f2fe", color: "#075985" },
  CONTRACT: { label: "Contract", background: "#e0e7ff", color: "#3730a3" },
  PROPERTY: { label: "Property", background: "#dcfce7", color: "#4a6b4a" },
  PERMIT: { label: "Permit", background: "#faf0e2", color: "#a06a24" },
};

export function CategoryTag({ category }) {
  const tag = CATEGORY_TAGS[category];
  if (!tag) return null;

  return (
    <span
      style={{
        background: tag.background,
        color: tag.color,
        borderRadius: "3.75px",
        padding: "0.15rem 0.4rem",
        fontSize: "0.63rem",
        fontWeight: 500,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        flex: "none",
      }}
    >
      {tag.label}
    </span>
  );
}

export function FileThumbnail({ file, onResolveUrl, onPreview }) {
  const [src, setSrc] = useState(file.url || file.previewUrl || null);
  const isImage = isImageFile(file);
  // Callers may hand a fresh copy of the same file each render (a renamed
  // contract, say); only a different file should mint a new signed URL.
  const fileKey = `${file.id || ""}|${file.path || file.storagePath || ""}|${file.url || file.previewUrl || ""}`;
  const fileRef = useRef(file);
  fileRef.current = file;

  useEffect(() => {
    const file = fileRef.current;
    let active = true;
    if (file.url || file.previewUrl) {
      setSrc(file.url || file.previewUrl);
      return;
    }
    if (isImage && onResolveUrl) {
      Promise.resolve(onResolveUrl(file, { download: false }))
        .then((result) => {
          if (active && result?.url) {
            setSrc(result.url);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [fileKey, isImage, onResolveUrl]);

  if (!isImage) {
    return (
      <div
        className="w-9 h-9 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 text-slate-500"
        style={{
          width: "2.25rem",
          height: "2.25rem",
          borderRadius: "0.5rem",
          border: "1px solid #efe9e0",
          backgroundColor: "#efe9e0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "#96897b",
        }}
      >
        <FileText className="w-4 h-4" style={{ width: "1rem", height: "1rem" }} />
      </div>
    );
  }

  return (
    <div
      onClick={onPreview}
      className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0 relative group cursor-pointer"
      title="Click to preview"
      style={{
        width: "2.25rem",
        height: "2.25rem",
        borderRadius: "0.5rem",
        overflow: "hidden",
        border: "1px solid #efe9e0",
        backgroundColor: "#efe9e0",
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
      }}
    >
      <img
        src={src || file.url || file.previewUrl}
        alt={file.name || "Attachment preview"}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}

function ClientDocuments({
  documents = [],
  canUpload = false,
  canRemove = false,
  onUpload,
  onRemove,
  onResolveUrl,
  onPreview,
  title = "Attached Documents",
  hint = "PDF, DOCX, PNG up to 2MB",
  accept = ".pdf,.doc,.docx,.png,.jpg,.jpeg",
  validate = validateDocument,
  emptyMessage = "No documents attached yet.",
  compact = false,
  variant = null,
  uploadLabel = "Upload file",
}) {
  const [message, setMessage] = useState(null); // { text, tone }
  const [busyId, setBusyId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [modalFile, setModalFile] = useState(null);
  const [modalUrl, setModalUrl] = useState(null);
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

    // Only downloads and non-images reach this now — images go to the
    // lightbox. Signed URLs expire, so navigate immediately rather than
    // rendering a link.
    window.open(url, download ? "_self" : "_blank", "noopener,noreferrer");
  };

  const handlePreview = async (document) => {
    if (onPreview) {
      onPreview(document);
      return;
    }
    if (isImageFile(document)) {
      setModalFile(document);
      if (document.url || document.previewUrl) {
        setModalUrl(document.url || document.previewUrl);
      } else if (onResolveUrl) {
        setModalUrl(null);
        const res = await onResolveUrl(document, { download: false });
        if (res?.url) {
          setModalUrl(res.url);
        }
      }
    } else {
      await handleOpen(document, false);
    }
  };

  const handleRemove = async (document) => {
    setBusyId(document.id);
    const result = await onRemove?.(document);
    setBusyId(null);
    if (result !== true) {
      setMessage({ text: typeof result === "string" ? result : "Delete failed.", tone: "error" });
    }
  };

  // Quiet, loam-edged buttons: Preview and Download are everyday actions and
  // shouldn't read as coloured calls to action (Download used to be light blue).
  const actionStyle = (background, color, disabled, borderColor = "#c7bcaf") => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    background,
    color,
    border: `1px solid ${borderColor}`,
    borderRadius: "3.75px",
    padding: compact ? "0.35rem 0.5rem" : "0.5rem 0.7rem",
    fontSize: compact ? "0.7rem" : "inherit",
    fontWeight: 500,
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
        fontWeight: 500,
        fontSize: compact ? "0.72rem" : "0.8rem",
      }}
    >
      {message.text}
    </div>
  );

  const closePreview = () => {
    setModalFile(null);
    setModalUrl(null);
  };

  // Rendered by every layout below. Previously only the tile layout carried a
  // lightbox, so Preview in the compact and roomy layouts — the ones the
  // Client Profile and Scheduling document tabs use — fell through to
  // window.open() and threw the photo into a new tab.
  const imagePreview = (
    <ImagePreviewModal
      file={modalFile}
      url={modalUrl}
      onClose={closePreview}
      onDownload={(file) => handleOpen(file, true)}
    />
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
          border: "1px solid #efe9e0",
          borderRadius: compact ? "9px" : "12px",
          padding: compact ? "0.5rem 0.6rem" : "0.9rem 1rem",
          alignItems: "center",
          flexWrap: "wrap",
          background: "#ffffff",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 160px", display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <FileThumbnail file={document} onResolveUrl={onResolveUrl} onPreview={() => handlePreview(document)} />
          <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              minWidth: 0,
              fontWeight: 500,
              fontSize: compact ? "0.78rem" : "inherit",
              color: colors.body,
            }}
          >
            {!compact && <CategoryTag category={document.category} />}
            {/* One line; a long name ends in "…" and shows in full on hover. */}
            <span title={document.name} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {document.name}
            </span>
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
        </div>

        <div style={{ display: "flex", gap: compact ? "0.3rem" : "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => handlePreview(document)}
            disabled={busy}
            style={actionStyle("#ffffff", colors.ink, busy)}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => handleOpen(document, true)}
            disabled={busy}
            style={actionStyle("#ffffff", colors.ink, busy)}
          >
            Download
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={() => handleRemove(document)}
              disabled={busy}
              aria-label={`Delete ${document.name}`}
              style={actionStyle("#f9ecea", "#9a2d24", busy, "rgba(154, 45, 36, 0.35)")}
            >
              <Trash2 size={compact ? 12 : 14} />
              {!compact && " Delete"}
            </button>
          )}
        </div>
      </div>
    );
  });

  // Compact upload tile grid mode — used by the Report tab attachments grid.
  if (variant === "tile") {
    return (
      <div
        {...dragHandlers}
        className="p-3.5 bg-slate-50/60 border border-slate-200/80 rounded-2xl flex flex-col justify-between overflow-hidden transition-colors"
        style={{
          padding: "0.875rem",
          backgroundColor: isDragging ? "#fff1f2" : "rgba(248, 250, 252, 0.6)",
          border: `1px solid ${isDragging ? "#ef4444" : "rgba(226, 232, 240, 0.8)"}`,
          borderRadius: "1rem",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          minWidth: 0,
          overflow: "hidden",
          transition: "background-color 0.15s ease, border-color 0.15s ease",
        }}
      >
        <div style={{ width: "100%", minWidth: 0 }}>
          {/* Category Header & Upload Action */}
          <div
            className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60 mb-2"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              paddingBottom: "0.5rem",
              borderBottom: "1px solid rgba(226, 232, 240, 0.6)",
              marginBottom: "0.5rem",
              minWidth: 0,
            }}
          >
            <span
              className="text-xs font-bold text-slate-800 flex items-center gap-1.5 truncate"
              style={{
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "#1e293b",
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                minWidth: 0,
              }}
            >
              <span className="truncate" title={title}>{title}</span>
              <span
                className="text-[11px] font-normal text-slate-400 shrink-0"
                style={{ fontSize: "0.6875rem", fontWeight: 400, color: "#96897b" }}
              >
                ({documents.length})
              </span>
            </span>

            {canUpload && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors shrink-0"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.6875rem",
                  fontWeight: 500,
                  color: "#50463c",
                  backgroundColor: "#ffffff",
                  border: "1px solid #efe9e0",
                  borderRadius: "0.5rem",
                  boxShadow: "none",
                  cursor: uploading ? "default" : "pointer",
                  opacity: uploading ? 0.6 : 1,
                  flexShrink: 0,
                }}
              >
                <UploadCloud
                  className="w-3 h-3 text-slate-400"
                  style={{ width: "0.75rem", height: "0.75rem", color: "#96897b" }}
                />
                <span>{uploading ? "..." : "Upload"}</span>
              </button>
            )}
          </div>

          {/* Sleek File Item Rows */}
          {documents.length === 0 ? (
            <div
              className="text-[11px] text-slate-400 italic py-2 text-center"
              style={{ fontSize: "0.6875rem", color: "#96897b", fontStyle: "italic", padding: "0.5rem 0", textAlign: "center" }}
            >
              {emptyMessage}
            </div>
          ) : (
            <div className="w-full" style={{ width: "100%", minWidth: 0 }}>
              {documents.map((file) => {
                const busy = busyId === file.id;

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
                      {/* Thumbnail or Fallback */}
                      <FileThumbnail
                        file={file}
                        onResolveUrl={onResolveUrl}
                        onPreview={() => handlePreview(file)}
                      />
                      <div
                        className="flex flex-col min-w-0"
                        style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
                      >
                        <span
                          className="text-xs font-semibold text-slate-800 truncate"
                          title={file.name}
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            color: "#1e293b",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {file.name}
                        </span>
                        <span
                          className="text-[10px] text-slate-400 truncate"
                          style={{ fontSize: "0.625rem", color: "#96897b" }}
                        >
                          {file.size ? `${typeof file.size === "number" ? formatFileSize(file.size) : file.size} • ` : ""}
                          {file.uploadedAt ? formatDate(file.uploadedAt) : "Attached"}
                        </span>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-1 shrink-0"
                      style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}
                    >
                      <button
                        type="button"
                        title="Preview"
                        onClick={() => handlePreview(file)}
                        disabled={busy}
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                        style={{
                          padding: "0.25rem",
                          color: "#96897b",
                          backgroundColor: "transparent",
                          border: "none",
                          borderRadius: "0.375rem",
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
                        onClick={() => handleOpen(file, true)}
                        disabled={busy}
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                        style={{
                          padding: "0.25rem",
                          color: "#96897b",
                          backgroundColor: "transparent",
                          border: "none",
                          borderRadius: "0.375rem",
                          cursor: busy ? "default" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Download className="w-3.5 h-3.5" style={{ width: "0.875rem", height: "0.875rem" }} />
                      </button>
                      {canRemove && (
                        <button
                          type="button"
                          title={`Remove ${file.name}`}
                          onClick={() => handleRemove(file)}
                          disabled={busy}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          style={{
                            padding: "0.25rem",
                            color: "#96897b",
                            backgroundColor: "transparent",
                            border: "none",
                            borderRadius: "0.375rem",
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
          )}
        </div>

        {fileInput}
        {statusMessage}

        {imagePreview}
      </div>
    );
  }

  // One file type, one section, one upload button — used by the Report tab.
  if (compact) {
    return (
      <section
        {...dragHandlers}
        style={{
          border: `1px solid ${isDragging ? "#7f1d1d" : "#e7dede"}`,
          borderRadius: "3.75px",
          padding: "0.65rem 0.8rem",
          minWidth: 0,
          height: "100%",
          boxSizing: "border-box",
          background: isDragging ? "#fcfaf1" : "#ffffff",
          transition: "border-color 0.2s ease, background-color 0.2s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: documents.length ? "0.55rem" : "0.3rem",
          }}
        >
          <h3 style={{ margin: 0, minWidth: 0, color: colors.body, fontSize: "0.82rem", fontWeight: 500 }}>
            {title}{" "}
            <span style={{ color: colors.muted, fontWeight: 500, fontSize: "0.74rem" }}>
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
                background: "#fcfaf1",
                color: colors.brandInk,
                border: "1px solid #f0d7d7",
                borderRadius: "3.75px",
                padding: "0.4rem 0.6rem",
                flexShrink: 0,
                whiteSpace: "nowrap",
                fontSize: "0.72rem",
                fontWeight: 500,
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
        {imagePreview}
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
              border: `2px dashed ${isDragging ? "#7f1d1d" : "#efe9e0"}`,
              borderRadius: "7.5px",
              padding: "1.5rem 1rem",
              background: isDragging ? "#fcfaf1" : "#efe9e0",
              color: "#50463c",
              textAlign: "center",
              cursor: uploading ? "default" : "pointer",
              transition: "border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease",
              opacity: uploading ? 0.7 : 1,
              boxShadow: isDragging ? "0 0 0 3px rgba(127, 17, 17, 0.08)" : "none",
            }}
          >
            <UploadCloud size={26} color="#96897b" />
            <div>
              <div style={{ fontWeight: 500, color: "#211b15" }}>Click to upload or drag and drop</div>
              <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: "#96897b" }}>{hint}</div>
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

      {imagePreview}
    </div>
  );
}

export default ClientDocuments;
