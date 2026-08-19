import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clientClassificationOptions } from "../../data/mockData";

const emptyClientForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  source: "Walk-in",
  classification: "RESIDENTIAL",
  classificationOther: "",
};

function CreateClientPage({ onCreateClient }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyClientForm);

  const requiresOtherClassification = form.classification === "OTHER";

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const newClient = {
      ...form,
      id: `client-${Date.now()}`,
      classificationOther: requiresOtherClassification ? form.classificationOther : "",
      documents: [],
      history: { appointments: [], services: [], transactions: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onCreateClient?.(newClient);
    navigate("/clients");
  };

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.72rem" }}>
          Client Management
        </p>
        <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.2rem", color: "#0f172a", fontWeight: 800 }}>Create Client Profile</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "20px", padding: "1.5rem", boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <Field label="Client Name">
            <input aria-label="Client Name" name="name" value={form.name} onChange={handleFieldChange} style={inputStyle} />
          </Field>

          <Field label="Email">
            <input aria-label="Email" name="email" type="email" value={form.email} onChange={handleFieldChange} style={inputStyle} />
          </Field>

          <Field label="Phone">
            <input aria-label="Phone" name="phone" value={form.phone} onChange={handleFieldChange} style={inputStyle} />
          </Field>

          <Field label="Address">
            <textarea aria-label="Address" name="address" value={form.address} onChange={handleFieldChange} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </Field>

          <Field label="Source">
            <select aria-label="Source" name="source" value={form.source} onChange={handleFieldChange} style={inputStyle}>
              <option value="Walk-in">Walk-in</option>
              <option value="Referral">Referral</option>
            </select>
          </Field>

          <Field label="Classification">
            <select aria-label="Classification" name="classification" value={form.classification} onChange={handleFieldChange} style={inputStyle}>
              {clientClassificationOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </Field>

          {requiresOtherClassification && (
            <Field label="Please specify">
              <input aria-label="Please specify" name="classificationOther" value={form.classificationOther} onChange={handleFieldChange} style={inputStyle} placeholder="Please specify" />
            </Field>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button type="submit" style={{ border: "none", borderRadius: "12px", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", padding: "0.9rem 1.2rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)" }}>
            Save Client
          </button>
          <Link to="/clients" style={{ color: "#8b1e1e", textDecoration: "none", fontWeight: 700 }}>
            Back to Client Profiles
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: "0.5rem", color: "#374151", fontWeight: 700 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid #dfe4ea",
  borderRadius: "12px",
  padding: "0.8rem 0.9rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: "#111827",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

export default CreateClientPage;
