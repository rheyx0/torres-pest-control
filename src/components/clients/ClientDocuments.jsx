// Upload and manage a client's attached documents.
//
// Sprint ACs covered:
//   - "Staff can upload documents (e.g., PDF, image) and attach them"
//   - "Staff can view, download, or delete uploaded documents"
//   - "System validates file type/size before upload"
//   - "Uploaded documents are listed under the client's profile"
//
// Files now go to the private `client-documents` Storage bucket. Because the
// bucket is private there is no permanent URL to store — Preview and Download
// mint a short-lived signed URL when clicked. That replaces the old
// URL.createObjectURL approach, where the "URL" was a pointer into this tab's
// memory that died on reload.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import EmptyState from "../common/EmptyState";
import { validateDocument } from "../../utils/validators";
import { formatDate, formatFileSize } from "../../utils/formatters";
import { colors } from "../../styles/theme";

function ClientDocuments({ documents = [], canUpload = false, canRemove = false, onUpload, onRemove, onResolveUrl }) {
  const [message, setMessage] = useState(null); // { text, tone }
  const [busyId, setBusyId] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Client-side gate. Storage also enforces size and MIME type server-side,
    // so bypassing this doesn't get a bad file into the bucket.
    const validationError = validateDocument(file);
    if (validationError) {
      setMessage({ text: validationError, tone: "error" });
      event.target.value = "";
      return;
    }

    setUploading(true);
    setMessage(null);
    const result = await onUpload?.(file);
    setUploading(false);
    event.target.value = "";

    setMessage(
      result === true
        ? { text: `Uploaded ${file.name}.`, tone: "success" }
        : { text: typeof result === "string" ? result : "Upload failed.", tone: "error" }
    );
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
    padding: "0.5rem 0.7rem",
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  });

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: "1rem", color: colors.body }}>Attached Documents</h2>

      {canUpload && (
        <div
          style={{
            marginBottom: "1rem",
            border: "1px dashed #d6d6d6",
            borderRadius: "12px",
            padding: "1rem",
            background: "#fafafa",
          }}
        >
          <label
            style={{
              display: "inline-block",
              background: colors.brandInk,
              color: "#fff",
              borderRadius: "10px",
              padding: "0.72rem 1rem",
              fontWeight: 700,
              cursor: uploading ? "default" : "pointer",
              opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? "Uploading…" : "Upload file"}
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={handleFileUpload}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
          <div style={{ marginTop: "0.8rem", color: colors.muted, fontSize: "0.86rem" }}>
            Accepts PDF, DOC, DOCX, JPG, and PNG files up to 2MB.
          </div>
          {message && (
            <div
              role="status"
              style={{
                marginTop: "0.75rem",
                color: message.tone === "success" ? colors.success : colors.danger,
                fontWeight: 600,
              }}
            >
              {message.text}
            </div>
          )}
        </div>
      )}

      {documents.length === 0 ? (
        <EmptyState message="No documents attached yet." />
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {documents.map((document) => {
            const busy = busyId === document.id;

            return (
              <div
                key={document.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  border: "1px solid #efefef",
                  borderRadius: "12px",
                  padding: "0.9rem 1rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: colors.body }}>{document.name}</div>
                  <div style={{ color: colors.muted, fontSize: "0.8rem", marginTop: "0.15rem" }}>
                    {formatDate(document.uploadedAt)} • {formatFileSize(document.size)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => handleOpen(document, false)}
                    disabled={busy}
                    style={actionStyle("#f3f4f6", colors.body, busy)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpen(document, true)}
                    disabled={busy}
                    style={actionStyle("#e5e7eb", colors.body, busy)}
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
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ClientDocuments;
