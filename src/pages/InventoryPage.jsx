import { useState } from "react";

function InventoryPage({ inventory, onAddItem }) {
  const [openForm, setOpenForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [form, setForm] = useState({
    name: "",
    type: "CHEMICAL",
    quantity: "",
    unit: "L",
    cost: "",
    supplier: "",
    reorderLevel: "",
    chemicalType: "INSECTICIDE",
    expirationDate: "",
    safetyLevel: "",
    hazardRating: "",
    dateReceived: "",
    serialNumber: "",
    condition: "ACTIVE",
    lastMaintenanceDate: "",
    nextMaintenanceDate: "",
    manufacturer: "",
    model: "",
    materialCategory: "SUPPLIES",
    description: "",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleTypeChange = (event) => {
    const newType = event.target.value;
    setForm((previous) => ({
      ...previous,
      type: newType,
      chemicalType: "INSECTICIDE",
      expirationDate: "",
      safetyLevel: "",
      hazardRating: "",
      dateReceived: "",
      serialNumber: "",
      condition: "ACTIVE",
      lastMaintenanceDate: "",
      nextMaintenanceDate: "",
      manufacturer: "",
      model: "",
      materialCategory: "SUPPLIES",
      description: "",
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const newItem = {
      id: `item-${Date.now()}`,
      name: form.name.trim(),
      type: form.type,
      quantity: Number(form.quantity),
      unit: form.unit,
      cost: Number(form.cost),
      supplier: form.supplier || null,
      reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (form.type === "CHEMICAL") {
      newItem.chemicalType = form.chemicalType;
      newItem.expirationDate = form.expirationDate || null;
      newItem.safetyLevel = form.safetyLevel || null;
      newItem.hazardRating = form.hazardRating || null;
      newItem.dateReceived = form.dateReceived || null;
    } else if (form.type === "EQUIPMENT") {
      newItem.serialNumber = form.serialNumber || null;
      newItem.condition = form.condition;
      newItem.lastMaintenanceDate = form.lastMaintenanceDate || null;
      newItem.nextMaintenanceDate = form.nextMaintenanceDate || null;
      newItem.manufacturer = form.manufacturer || null;
      newItem.model = form.model || null;
    } else if (form.type === "MATERIAL") {
      newItem.materialCategory = form.materialCategory;
      newItem.description = form.description || null;
    }

    if (!newItem.name || Number.isNaN(newItem.quantity) || Number.isNaN(newItem.cost)) return;

    onAddItem(newItem);
    setForm({
      name: "",
      type: "CHEMICAL",
      quantity: "",
      unit: "L",
      cost: "",
      supplier: "",
      reorderLevel: "",
      chemicalType: "INSECTICIDE",
      expirationDate: "",
      safetyLevel: "",
      hazardRating: "",
      dateReceived: "",
      serialNumber: "",
      condition: "ACTIVE",
      lastMaintenanceDate: "",
      nextMaintenanceDate: "",
      manufacturer: "",
      model: "",
      materialCategory: "SUPPLIES",
      description: "",
    });
    setOpenForm(false);
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "#8b1e1e", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.75rem" }}>
            Inventory
          </p>
          <h1 style={{ margin: "0.2rem 0 0", fontSize: "2rem", color: "#111827" }}>Item Profile</h1>
        </div>
        <button type="button" onClick={() => setOpenForm((value) => !value)} style={{ border: "none", borderRadius: "10px", background: "#8b1e1e", color: "#fff", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer" }}>
          {openForm ? "Close Form" : "Add Inventory Item"}
        </button>
      </div>

      {openForm && (
        <form onSubmit={handleSubmit} style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: "16px", padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
            <h3 style={{ color: "#111827", marginBottom: "1rem" }}>Basic Information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <Field label="Item Name *">
                <input name="name" value={form.name} onChange={handleChange} style={inputStyle} placeholder="Enter item name" required />
              </Field>
              <Field label="Type *">
                <select name="type" value={form.type} onChange={handleTypeChange} style={inputStyle} required>
                  <option value="CHEMICAL">Chemical</option>
                  <option value="EQUIPMENT">Equipment</option>
                  <option value="MATERIAL">Material</option>
                </select>
              </Field>
              <Field label="Quantity *">
                <input name="quantity" type="number" min="0" step="0.1" value={form.quantity} onChange={handleChange} style={inputStyle} placeholder="0" required />
              </Field>
              <Field label="Unit *">
                <input name="unit" value={form.unit} onChange={handleChange} style={inputStyle} placeholder="L, kg, pcs, etc." required />
              </Field>
              <Field label="Cost per Unit (₱) *">
                <input name="cost" type="number" min="0" step="0.01" value={form.cost} onChange={handleChange} style={inputStyle} placeholder="0.00" required />
              </Field>
              <Field label="Supplier">
                <input name="supplier" value={form.supplier} onChange={handleChange} style={inputStyle} placeholder="Supplier name" />
              </Field>
              <Field label="Reorder Level">
                <input name="reorderLevel" type="number" min="0" step="0.1" value={form.reorderLevel} onChange={handleChange} style={inputStyle} placeholder="0" />
              </Field>
            </div>
          </div>

          {form.type === "CHEMICAL" && (
            <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
              <h3 style={{ color: "#111827", marginBottom: "1rem" }}>Chemical Details</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <Field label="Chemical Type *">
                  <select name="chemicalType" value={form.chemicalType} onChange={handleChange} style={inputStyle} required>
                    <option value="INSECTICIDE">Insecticide</option>
                    <option value="FUNGICIDE">Fungicide</option>
                    <option value="RODENTICIDE">Rodenticide</option>
                    <option value="HERBICIDE">Herbicide</option>
                    <option value="FUMIGANT">Fumigant</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>
                <Field label="Expiration Date">
                  <input name="expirationDate" type="date" value={form.expirationDate} onChange={handleChange} style={inputStyle} />
                </Field>
                <Field label="Safety Level">
                  <input name="safetyLevel" value={form.safetyLevel} onChange={handleChange} style={inputStyle} placeholder="Low, Medium, High" />
                </Field>
                <Field label="Hazard Rating">
                  <input name="hazardRating" value={form.hazardRating} onChange={handleChange} style={inputStyle} placeholder="Hazard description" />
                </Field>
                <Field label="Date Received">
                  <input name="dateReceived" type="date" value={form.dateReceived} onChange={handleChange} style={inputStyle} />
                </Field>
              </div>
            </div>
          )}

          {form.type === "EQUIPMENT" && (
            <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
              <h3 style={{ color: "#111827", marginBottom: "1rem" }}>Equipment Details</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <Field label="Serial Number">
                  <input name="serialNumber" value={form.serialNumber} onChange={handleChange} style={inputStyle} placeholder="Serial number" />
                </Field>
                <Field label="Condition *">
                  <select name="condition" value={form.condition} onChange={handleChange} style={inputStyle} required>
                    <option value="ACTIVE">Active</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </Field>
                <Field label="Manufacturer">
                  <input name="manufacturer" value={form.manufacturer} onChange={handleChange} style={inputStyle} placeholder="Manufacturer name" />
                </Field>
                <Field label="Model">
                  <input name="model" value={form.model} onChange={handleChange} style={inputStyle} placeholder="Model name/number" />
                </Field>
                <Field label="Last Maintenance Date">
                  <input name="lastMaintenanceDate" type="date" value={form.lastMaintenanceDate} onChange={handleChange} style={inputStyle} />
                </Field>
                <Field label="Next Maintenance Date">
                  <input name="nextMaintenanceDate" type="date" value={form.nextMaintenanceDate} onChange={handleChange} style={inputStyle} />
                </Field>
              </div>
            </div>
          )}

          {form.type === "MATERIAL" && (
            <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
              <h3 style={{ color: "#111827", marginBottom: "1rem" }}>Material Details</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <Field label="Material Category *">
                  <select name="materialCategory" value={form.materialCategory} onChange={handleChange} style={inputStyle} required>
                    <option value="PROTECTIVE_GEAR">Protective Gear</option>
                    <option value="SUPPLIES">Supplies</option>
                    <option value="TOOLS_ACCESSORIES">Tools & Accessories</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>
                <Field label="Description" style={{ gridColumn: "1 / -1" }}>
                  <textarea name="description" value={form.description} onChange={handleChange} style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }} placeholder="Description of material" />
                </Field>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem", gap: "0.5rem" }}>
            <button type="button" onClick={() => setOpenForm(false)} style={{ background: "#e5e7eb", color: "#374151", border: "none", borderRadius: "10px", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "10px", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer" }}>
              Add Item
            </button>
          </div>
        </form>
      )}

      <div style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: "16px", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 0.8fr 1fr 1.2fr", gap: "0.75rem", padding: "1rem 1.25rem", background: "#fafafa", fontWeight: 700, color: "#374151" }}>
          <span>Item Name</span>
          <span>Type</span>
          <span>Unit</span>
          <span>Quantity</span>
          <span>Info</span>
        </div>

        {inventory.map((item) => {
          const isLowStock = item.reorderLevel && item.quantity <= item.reorderLevel;
          const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";

          return (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1.2fr 0.8fr 1fr 1.2fr",
                gap: "0.75rem",
                padding: "1rem 1.25rem",
                borderTop: "1px solid #f1f1f1",
                alignItems: "center",
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9f9f9")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <div>
                <div style={{ fontWeight: 700, color: "#111827" }}>{item.name}</div>
                {item.supplier && <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{item.supplier}</div>}
              </div>
              <div style={{ color: "#374151" }}>{typeLabel}</div>
              <div style={{ color: "#374151" }}>{item.unit}</div>
              <div style={{ fontWeight: 700, color: isLowStock ? "#b91c1c" : "#111827" }}>{item.quantity}</div>
              <div>
                {isLowStock ? (
                  <span style={{ background: "#fee2e2", color: "#991b1b", borderRadius: "999px", padding: "0.35rem 0.7rem", fontSize: "0.75rem", fontWeight: 700 }}>
                    Low Stock
                  </span>
                ) : (
                  <span style={{ background: "#dcfce7", color: "#166534", borderRadius: "999px", padding: "0.35rem 0.7rem", fontSize: "0.75rem", fontWeight: 700 }}>
                    Healthy
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail View Modal */}
      {selectedItem && <InventoryDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
}

function InventoryDetailModal({ item, onClose }) {
  const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "16px",
          padding: "2rem",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
          <h2 style={{ margin: 0, color: "#111827" }}>{item.name}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#6b7280" }}>
            ✕
          </button>
        </div>

        {/* Basic Information */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Basic Information
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <DetailRow label="Type" value={typeLabel} />
            <DetailRow label="Quantity" value={`${item.quantity} ${item.unit}`} />
            {item.cost !== undefined && item.cost !== null ? <DetailRow label="Cost per Unit" value={`₱${Number(item.cost).toFixed(2)}`} /> : null}
            {item.cost !== undefined && item.cost !== null && item.quantity ? <DetailRow label="Total Value" value={`₱${(item.quantity * Number(item.cost)).toFixed(2)}`} /> : null}
            {item.supplier && <DetailRow label="Supplier" value={item.supplier} />}
            {item.reorderLevel && <DetailRow label="Reorder Level" value={item.reorderLevel} />}
          </div>
        </div>

        {/* Chemical-Specific Details */}
        {item.type === "CHEMICAL" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
              Chemical Details
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <DetailRow label="Chemical Type" value={item.chemicalType} />
              {item.expirationDate && <DetailRow label="Expiration Date" value={new Date(item.expirationDate).toLocaleDateString()} />}
              {item.safetyLevel && <DetailRow label="Safety Level" value={item.safetyLevel} />}
              {item.hazardRating && <DetailRow label="Hazard Rating" value={item.hazardRating} />}
              {item.dateReceived && <DetailRow label="Date Received" value={new Date(item.dateReceived).toLocaleDateString()} />}
            </div>
          </div>
        )}

        {/* Equipment-Specific Details */}
        {item.type === "EQUIPMENT" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
              Equipment Details
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              {item.serialNumber && <DetailRow label="Serial Number" value={item.serialNumber} />}
              <DetailRow label="Condition" value={item.condition} />
              {item.manufacturer && <DetailRow label="Manufacturer" value={item.manufacturer} />}
              {item.model && <DetailRow label="Model" value={item.model} />}
              {item.lastMaintenanceDate && <DetailRow label="Last Maintenance" value={new Date(item.lastMaintenanceDate).toLocaleDateString()} />}
              {item.nextMaintenanceDate && <DetailRow label="Next Maintenance" value={new Date(item.nextMaintenanceDate).toLocaleDateString()} />}
            </div>
          </div>
        )}

        {/* Material-Specific Details */}
        {item.type === "MATERIAL" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
              Material Details
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1rem" }}>
              <DetailRow label="Material Category" value={item.materialCategory} />
              {item.description && <DetailRow label="Description" value={item.description} />}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #f0f0f0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.85rem", color: "#6b7280" }}>
            <div>
              <div style={{ fontWeight: 700, color: "#374151" }}>Created</div>
              {new Date(item.createdAt).toLocaleDateString()}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#374151" }}>Last Updated</div>
              {new Date(item.updatedAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem", gap: "0.5rem" }}>
          <button onClick={onClose} style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "10px", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", color: "#111827", fontWeight: 600 }}>
        {value || "—"}
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

export default InventoryPage;
