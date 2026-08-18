import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { clientClassificationOptions } from "../data/mockData";

const allowedFileTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
];

function formatFileSize(size) {
  if (!size) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function ClientDetailPage({ clients, onUpdateClient, onAddDocument, onRemoveDocument }) {
  const { id } = useParams();
  const client = clients.find((item) => item.id === id);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    source: "Walk-in",
    classification: "RESIDENTIAL",
    classificationOther: "",
  });

  const [uploadMessage, setUploadMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    if (client) {
      setForm({
        name: client.name || "",
        phone: client.phone || "",
        email: client.email || "",
        address: client.address || "",
        source: client.source || "Walk-in",
        classification: client.classification || "RESIDENTIAL",
        classificationOther: client.classificationOther || "",
      });
    }
  }, [client]);

  const requiresOtherClassification = useMemo(
    () => form.classification === "OTHER",
    [form.classification]
  );

  if (!client) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", background: "#fff", borderRadius: "16px", padding: "2rem", border: "1px solid #f0f0f0" }}>
        Client not found.
      </div>
    );
  }

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSave = (event) => {
    event.preventDefault();
    const updatedClient = {
      ...client,
      ...form,
      phone: form.phone,
      classification: form.classification,
      classificationOther: requiresOtherClassification ? form.classificationOther : "",
      updatedAt: new Date().toISOString(),
    };

    onUpdateClient(client.id, updatedClient);
    setSaveStatus("Client profile updated successfully.");
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isAllowedType = allowedFileTypes.includes(file.type) || file.name.toLowerCase().endsWith(".pdf") || file.name.toLowerCase().endsWith(".doc") || file.name.toLowerCase().endsWith(".docx") || file.name.toLowerCase().endsWith(".png") || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");
    const isAllowedSize = file.size <= 2 * 1024 * 1024;

    if (!isAllowedType) {
      setUploadMessage("Only PDF, DOC, DOCX, JPG, and PNG files are allowed.");
      event.target.value = "";
      return;
    }

    if (!isAllowedSize) {
      setUploadMessage("File exceeds the 2MB upload limit.");
      event.target.value = "";
      return;
    }

    const newDocument = {
      id: `doc-${Date.now()}`,
      name: file.name,
      type: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      url: URL.createObjectURL(file),
    };

    onAddDocument(client.id, newDocument);
    setUploadMessage(`Uploaded ${file.name} successfully.`);
    event.target.value = "";
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.75rem" }}>
          Client Profile
        </p>
        <h1 style={{ margin: "0.2rem 0 0", fontSize: "2rem", color: "#111827" }}>{client.name}</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #ebebeb", padding: "1.5rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "1rem", color: "#111827" }}>Attached Documents</h2>

          <div style={{ marginBottom: "1rem", border: "1px dashed #d6d6d6", borderRadius: "12px", padding: "1rem", background: "#fafafa" }}>
            <label style={{ display: "inline-block", background: "#8b1e1e", color: "#fff", borderRadius: "10px", padding: "0.72rem 1rem", fontWeight: 700, cursor: "pointer" }}>
              Upload file
              <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
            <div style={{ marginTop: "0.8rem", color: "#6b7280", fontSize: "0.86rem" }}>
              Accepts PDF, DOC, DOCX, JPG, and PNG files up to 2MB.
            </div>
            {uploadMessage && <div style={{ marginTop: "0.75rem", color: uploadMessage.includes("successfully") ? "#1f7a5f" : "#8b1e1e", fontWeight: 600 }}>{uploadMessage}</div>}
          </div>

          {client.documents?.length ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {client.documents.map((document) => (
                <div key={document.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", border: "1px solid #efefef", borderRadius: "12px", padding: "0.9rem 1rem", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>{document.name}</div>
                    <div style={{ color: "#6b7280", fontSize: "0.8rem", marginTop: "0.15rem" }}>
                      {new Date(document.uploadedAt).toLocaleDateString()} • {formatFileSize(document.size)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <a href={document.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", background: "#f3f4f6", color: "#111827", borderRadius: "8px", padding: "0.5rem 0.7rem", fontWeight: 600 }}>
                      Preview
                    </a>
                    <a href={document.url} download={document.name} style={{ textDecoration: "none", background: "#e5e7eb", color: "#111827", borderRadius: "8px", padding: "0.5rem 0.7rem", fontWeight: 600 }}>
                      Download
                    </a>
                    <button type="button" onClick={() => onRemoveDocument(client.id, document.id)} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: "8px", padding: "0.5rem 0.7rem", fontWeight: 700, cursor: "pointer" }}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "1.25rem", borderRadius: "12px", background: "#fafafa", color: "#6b7280" }}>No documents attached yet.</div>
          )}
        </div>

        <form onSubmit={handleSave} style={{ background: "#fff", borderRadius: "16px", border: "1px solid #ebebeb", padding: "1.5rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "1rem", color: "#111827" }}>Client Information</h2>

          <div style={{ display: "grid", gap: "1rem" }}>
            <Field label="Client Name">
              <input name="name" value={form.name} onChange={handleFieldChange} style={inputStyle} />
            </Field>
            <Field label="Phone">
              <input name="phone" value={form.phone} onChange={handleFieldChange} style={inputStyle} />
            </Field>
            <Field label="Email Address">
              <input name="email" type="email" value={form.email} onChange={handleFieldChange} style={inputStyle} />
            </Field>
            <Field label="Address">
              <textarea name="address" value={form.address} onChange={handleFieldChange} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
            <Field label="Source">
              <select name="source" value={form.source} onChange={handleFieldChange} style={inputStyle}>
                <option value="Walk-in">Walk-in</option>
                <option value="Referral">Referral</option>
              </select>
            </Field>
            <Field label="Classification">
              <select name="classification" value={form.classification} onChange={handleFieldChange} style={inputStyle}>
                {clientClassificationOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </Field>
            {requiresOtherClassification && (
              <Field label="Please specify">
                <input name="classificationOther" value={form.classificationOther} onChange={handleFieldChange} style={inputStyle} placeholder="Please specify" />
              </Field>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
            <button type="submit" style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "10px", padding: "0.8rem 1.1rem", fontWeight: 700, cursor: "pointer" }}>
              Save Changes
            </button>
            {saveStatus && <span style={{ color: "#1f7a5f", fontWeight: 600 }}>{saveStatus}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: "0.45rem", color: "#374151", fontWeight: 700 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid #d9d9d9",
  borderRadius: "10px",
  padding: "0.72rem 0.8rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: "#111827",
};

export default ClientDetailPage;
