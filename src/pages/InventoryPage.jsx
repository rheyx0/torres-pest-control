import { useState } from "react";

function InventoryPage({ inventory, onAddItem }) {
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "Chemical",
    unit: "L",
    stock: "",
    lowStockThreshold: "",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const newItem = {
      id: `item-${Date.now()}`,
      name: form.name.trim(),
      category: form.category,
      unit: form.unit,
      stock: Number(form.stock),
      lowStockThreshold: Number(form.lowStockThreshold),
    };

    if (!newItem.name || Number.isNaN(newItem.stock) || Number.isNaN(newItem.lowStockThreshold)) return;

    onAddItem(newItem);
    setForm({ name: "", category: "Chemical", unit: "L", stock: "", lowStockThreshold: "" });
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
            <Field label="Item Name">
              <input name="name" value={form.name} onChange={handleChange} style={inputStyle} />
            </Field>
            <Field label="Category">
              <select name="category" value={form.category} onChange={handleChange} style={inputStyle}>
                <option value="Chemical">Chemical</option>
                <option value="Material">Material</option>
                <option value="Equipment">Equipment</option>
              </select>
            </Field>
            <Field label="Unit">
              <input name="unit" value={form.unit} onChange={handleChange} style={inputStyle} />
            </Field>
            <Field label="Stock Level">
              <input name="stock" type="number" min="0" value={form.stock} onChange={handleChange} style={inputStyle} />
            </Field>
            <Field label="Low Stock Threshold">
              <input name="lowStockThreshold" type="number" min="0" value={form.lowStockThreshold} onChange={handleChange} style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button type="submit" style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "10px", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer" }}>
              Add Item
            </button>
          </div>
        </form>
      )}

      <div style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: "16px", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1.2fr 0.9fr 1fr 1fr", gap: "0.75rem", padding: "1rem 1.25rem", background: "#fafafa", fontWeight: 700, color: "#374151" }}>
          <span>Item Name</span>
          <span>Category</span>
          <span>Unit</span>
          <span>Stock</span>
          <span>Status</span>
        </div>

        {inventory.map((item) => {
          const isLowStock = Number(item.stock) <= Number(item.lowStockThreshold);

          return (
            <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2.2fr 1.2fr 0.9fr 1fr 1fr", gap: "0.75rem", padding: "1rem 1.25rem", borderTop: "1px solid #f1f1f1", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, color: "#111827" }}>{item.name}</div>
              </div>
              <div style={{ color: "#374151" }}>{item.category}</div>
              <div style={{ color: "#374151" }}>{item.unit}</div>
              <div style={{ fontWeight: 700, color: isLowStock ? "#b91c1c" : "#111827" }}>{item.stock}</div>
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
