// Item Profile no longer sets Quantity — new items start at 0 stock, and the
// only thing that can move quantity afterward is Stock In (see
// InventoryContext.stockIn / services/inventoryService.stockIn), which also
// writes a row to the Stock Movement Log. That's why there's a "History" tab
// now alongside the item list: it's the same page, not a separate route.
//
// Item profiles are fully editable, except Quantity. Quantity is changed only
// through Stock In so it always has a matching movement-history record.
//
// Splitting this into components/inventory/* is still deferred (see the
// original note this replaced) — the file's just bigger now.

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import useInventory from "../hooks/useInventory";
import useAuth from "../hooks/useAuth";
import { SUBSYSTEMS } from "../utils/permissions";
import { useToast } from "../context/ToastContext";
import { INVENTORY_STATUS } from "../services/inventoryService";
import { card, colors, primaryButton, secondaryButton, dangerButton, successButton } from "../styles/theme";
import ConfirmDialog from "../components/common/ConfirmDialog";

const CREATE_FORM_DEFAULTS = {
  name: "",
  type: "CHEMICAL",
  unit: "L",
  cost: "",
  supplier: "",
  storageLocation: "",
  reorderLevel: "",
  chemicalType: "INSECTICIDE",
  expirationDate: "",
  safetyLevel: "",
  hazardRating: "",
  standardRate: "",
  rateUnit: "",
  rateNote: "",
  dateReceived: "",
  serialNumber: "",
  condition: "ACTIVE",
  lastMaintenanceDate: "",
  nextMaintenanceDate: "",
  manufacturer: "",
  model: "",
  materialCategory: "SUPPLIES",
  description: "",
};

const UNIT_OPTIONS = ["L", "mL", "kg", "g", "pcs", "boxes", "bottles", "sachets"];

function UnitField({ value, onChange }) {
  const usesCustomUnit = value && !UNIT_OPTIONS.includes(value);

  return (
    <Field label="Unit *">
      <select
        value={usesCustomUnit ? "OTHER" : value}
        onChange={(event) => onChange(event.target.value === "OTHER" ? "" : event.target.value)}
        style={inputStyle}
        required
      >
        {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        <option value="OTHER">Other</option>
      </select>
      {usesCustomUnit && (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...inputStyle, marginTop: "0.5rem" }}
          placeholder="Enter a unit"
          required
          aria-label="Custom unit"
        />
      )}
    </Field>
  );
}

function InventoryPage() {
  const { can } = useAuth();

  const {
    inventory,
    addItem: onAddItem,
    updateItem,
    setItemStatus,
    stockIn,
    stockCorrection,
    removeItem,
    loading,
    error,
    movements,
    movementsLoading,
    movementsError,
    refreshMovements,
  } = useInventory();
  const { showSuccess, showError } = useToast();

  const [tab, setTab] = useState("items"); // "items" | "history"
  const [openForm, setOpenForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [stockInItem, setStockInItem] = useState(null);
  const [correctionItem, setCorrectionItem] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionMenuItemId, setActionMenuItemId] = useState(null);
  const [actionMenuDirection, setActionMenuDirection] = useState({});
  const [form, setForm] = useState(CREATE_FORM_DEFAULTS);
  const actionMenuRef = useRef(null);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(event.target)) {
        setActionMenuItemId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // Inventory and history filtering states
  const [itemSearch, setItemSearch] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState("ALL");
  const [itemStatusFilter, setItemStatusFilter] = useState("ALL");
  const [itemStockFilter, setItemStockFilter] = useState("ALL");
  const [historySearch, setHistorySearch] = useState("");
  const [historyItemFilter, setHistoryItemFilter] = useState("ALL");
  const [historyMovementType, setHistoryMovementType] = useState("ALL");
  const [historyBranchFilter, setHistoryBranchFilter] = useState("ALL");
  const [historyDateFilter, setHistoryDateFilter] = useState("ALL");
  const [historySort, setHistorySort] = useState("DATE_DESC");

  const uniqueBranches = useMemo(() => {
    const set = new Set();
    movements.forEach((movement) => {
      if (movement.intakeBranchOrStation && movement.intakeBranchOrStation !== "—") set.add(movement.intakeBranchOrStation);
    });
    return Array.from(set).sort();
  }, [movements]);

  const uniqueItems = useMemo(() => {
    const map = new Map();
    movements.forEach((movement) => {
      if (movement.itemId && movement.itemName) map.set(movement.itemId, movement.itemName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [movements]);

  const filteredInventory = useMemo(() => {
    const terms = itemSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);

    return inventory.filter((item) => {
      const typeLabel = item.type === "CHEMICAL" ? "chemical" : item.type === "EQUIPMENT" ? "equipment" : "material";
      const isDisabled = item.status === INVENTORY_STATUS.DISABLED;
      const isOutOfStock = Number(item.quantity) <= 0;
      const isLowStock = isOutOfStock || (item.reorderLevel !== null && item.reorderLevel !== undefined && item.quantity <= item.reorderLevel);
      const text = `${item.name || ""} ${item.supplier || ""} ${item.unit || ""} ${item.storageLocation || ""} ${typeLabel} ${isDisabled ? "disabled inactive" : "active enabled"} ${isOutOfStock ? "out of stock empty" : isLowStock ? "low stock" : "healthy"}`.toLowerCase();

      if (terms.length > 0 && !terms.every((term) => text.includes(term))) return false;
      if (itemTypeFilter !== "ALL" && item.type !== itemTypeFilter) return false;
      if (itemStatusFilter === "ACTIVE" && isDisabled) return false;
      if (itemStatusFilter === "DISABLED" && !isDisabled) return false;
      if (itemStockFilter === "OUT" && !isOutOfStock) return false;
      if (itemStockFilter === "LOW" && !isLowStock) return false;
      if (itemStockFilter === "HEALTHY" && isLowStock) return false;
      return true;
    });
  }, [inventory, itemSearch, itemTypeFilter, itemStatusFilter, itemStockFilter]);

  const hasItemFilters = itemSearch || itemTypeFilter !== "ALL" || itemStatusFilter !== "ALL" || itemStockFilter !== "ALL";

  const clearItemFilters = () => {
    setItemSearch("");
    setItemTypeFilter("ALL");
    setItemStatusFilter("ALL");
    setItemStockFilter("ALL");
  };

  const filteredAndSortedMovements = useMemo(() => {
    let result = [...movements];

    const term = historySearch.trim().toLowerCase();
    if (term) {
      result = result.filter((m) => {
        const text = `${m.itemName || ""} ${m.reference || ""} ${m.intakeBranchOrStation || ""} ${m.actor || ""}`.toLowerCase();
        return text.includes(term);
      });
    }

    if (historyItemFilter !== "ALL") {
      result = result.filter((m) => m.itemId === historyItemFilter);
    }

    if (historyMovementType !== "ALL") {
      result = result.filter((m) => m.movementType === historyMovementType);
    }

    if (historyBranchFilter !== "ALL") {
      result = result.filter((m) => m.intakeBranchOrStation === historyBranchFilter);
    }

    if (historyDateFilter !== "ALL") {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (historyDateFilter === "TODAY") {
        result = result.filter((m) => m.movementDate === todayStr);
      } else if (historyDateFilter === "7DAYS") {
        const limit = new Date(Date.now() - 7 * 86400000);
        result = result.filter((m) => new Date(m.movementDate) >= limit);
      } else if (historyDateFilter === "30DAYS") {
        const limit = new Date(Date.now() - 30 * 86400000);
        result = result.filter((m) => new Date(m.movementDate) >= limit);
      }
    }

    result.sort((a, b) => {
      if (historySort === "DATE_ASC") return new Date(a.movementDate) - new Date(b.movementDate);
      if (historySort === "COST_DESC") return (b.totalCost || 0) - (a.totalCost || 0);
      if (historySort === "COST_ASC") return (a.totalCost || 0) - (b.totalCost || 0);
      if (historySort === "AMOUNT_DESC") return (b.amount || 0) - (a.amount || 0);
      if (historySort === "AMOUNT_ASC") return (a.amount || 0) - (b.amount || 0);
      if (historySort === "NAME_ASC") return (a.itemName || "").localeCompare(b.itemName || "");
      return new Date(b.movementDate) - new Date(a.movementDate);
    });

    return result;
  }, [movements, historySearch, historyItemFilter, historyMovementType, historyBranchFilter, historyDateFilter, historySort]);

  useEffect(() => {
    if (tab === "history") refreshMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleActionMenuToggle = (event, itemId) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const shouldOpenUp = bounds.bottom + 180 > window.innerHeight;
    setActionMenuDirection((previous) => ({ ...previous, [itemId]: shouldOpenUp ? "up" : "down" }));
    setActionMenuItemId((current) => (current === itemId ? null : itemId));
  };

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
      standardRate: "",
      rateUnit: "",
      rateNote: "",
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

  const handleSubmit = async (event) => {
    event.preventDefault();

    // No quantity here — items are created at 0 stock. id / createdAt /
    // updatedAt / status are generated by the database.
    const newItem = {
      name: form.name.trim(),
      type: form.type,
      unit: form.unit.trim(),
      cost: Number(form.cost),
      supplier: form.supplier || null,
      storageLocation: form.storageLocation || null,
      reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : null,
    };

    if (form.type === "CHEMICAL") {
      newItem.chemicalType = form.chemicalType;
      newItem.expirationDate = form.expirationDate || null;
      newItem.safetyLevel = form.safetyLevel || null;
      newItem.hazardRating = form.hazardRating || null;
      newItem.standardRate = form.standardRate || "";
      newItem.rateUnit = form.rateUnit || "";
      newItem.rateNote = form.rateNote || "";
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

    if (!newItem.name || !newItem.unit || Number.isNaN(newItem.cost)) return;

    const result = await onAddItem(newItem);
    if (result !== true) {
      showError(typeof result === "string" ? result : "Could not save the item.");
      return;
    }

    showSuccess(`${newItem.name} added to inventory. It starts at 0 stock — use Stock In to add quantity.`);
    setForm(CREATE_FORM_DEFAULTS);
    setOpenForm(false);
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "#7f1d1d", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.72rem", margin: 0 }}>
            Inventory
          </p>
          <h1 style={{ margin: "0.25rem 0 0", fontSize: "2.1rem", color: "#0f172a", lineHeight: 1.15 }}>
            Inventory Management
          </h1>
        </div>
        {tab === "items" && (
          <button
            type="button"
            onClick={() => setOpenForm((value) => !value)}
            style={{
              background: "#b91c1c",
              color: "#ffffff",
              border: "none",
              borderRadius: "10px",
              padding: "0.78rem 1.15rem",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 8px 22px rgba(185, 28, 28, 0.18)",
            }}
          >
            {openForm ? "Close Form" : "Add Inventory Item"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid #e2e8f0" }}>
        <TabButton active={tab === "items"} onClick={() => setTab("items")}>
          Items
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          Stock Movement History
        </TabButton>
      </div>

      {tab === "items" && (
        <>
          {openForm && (
            <form onSubmit={handleSubmit} style={{ ...card, marginBottom: "1.5rem" }}>
              <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
                <h3 style={{ color: "#111827", marginBottom: "1rem" }}>Basic Information</h3>
                <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>
                  New items start at 0 stock. Add quantity afterward with Stock In on the item's row.
                </p>
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
                  <UnitField value={form.unit} onChange={(unit) => setForm((previous) => ({ ...previous, unit }))} />
                  <Field label="Cost per Unit (₱) *">
                    <input name="cost" type="number" min="0" step="0.01" value={form.cost} onChange={handleChange} style={inputStyle} placeholder="0.00" required />
                  </Field>
                  <Field label="Supplier">
                    <input name="supplier" value={form.supplier} onChange={handleChange} style={inputStyle} placeholder="Supplier name" />
                  </Field>
                  <Field label="Storage Location">
                    <input name="storageLocation" value={form.storageLocation} onChange={handleChange} style={inputStyle} placeholder="e.g. Storage Room A" />
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
                    <Field label="Safety Level *">
                      <select name="safetyLevel" value={form.safetyLevel} onChange={handleChange} style={inputStyle} required>
                        <option value="">Select safety level</option>
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </Field>
                    <Field label="Hazard Rating">
                      <input name="hazardRating" value={form.hazardRating} onChange={handleChange} style={inputStyle} placeholder="Hazard description" />
                    </Field>
                    <Field label="Standard Rate">
                      <div style={{ display: "grid", gridTemplateColumns: "100px minmax(0, 1fr)", gap: "0.4rem" }}>
                        <input name="standardRate" type="number" step="any" min="0" value={form.standardRate} onChange={handleChange} style={inputStyle} placeholder="10" />
                        <input name="rateUnit" value={form.rateUnit} onChange={handleChange} style={inputStyle} placeholder="mL per 1 L water" />
                      </div>
                    </Field>
                    <Field label="Mixing Note">
                      <input name="rateNote" value={form.rateNote} onChange={handleChange} style={inputStyle} placeholder="e.g. 0.03% dilution" />
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
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 320px)", gap: "1rem" }}>
                    <Field label="Material Category *">
                      <select name="materialCategory" value={form.materialCategory} onChange={handleChange} style={inputStyle} required>
                        <option value="PROTECTIVE_GEAR">Protective Gear</option>
                        <option value="SUPPLIES">Supplies</option>
                        <option value="TOOLS_ACCESSORIES">Tools & Accessories</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </Field>
                  </div>
                  <div style={{ marginTop: "1rem" }}>
                    <Field label="Description">
                      <textarea name="description" value={form.description} onChange={handleChange} style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }} placeholder="Description of material" />
                    </Field>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem", gap: "0.5rem" }}>
                <button type="button" onClick={() => setOpenForm(false)} style={secondaryButton}>
                  Cancel
                </button>
                <button type="submit" style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "10px", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer" }}>
                  Add Item
                </button>
              </div>
            </form>
          )}

          <div style={{ maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
            <div style={{ background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "18px", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)", padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", gap: "0.9rem", alignItems: "end", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 260px", minWidth: "220px" }}>
                  <label style={{ display: "block", color: "#475569", fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.45rem" }}>
                    Search
                  </label>
                  <div style={{ position: "relative" }}>
                    <Search size={15} style={{ position: "absolute", left: "0.9rem", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                    <input
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Search items"
                      style={{ ...inputStyle, paddingLeft: "2.4rem" }}
                    />
                  </div>
                </div>

                <div style={{ flex: "0 0 170px" }}>
                  <label style={{ display: "block", color: "#475569", fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.45rem" }}>
                    Type
                  </label>
                  <select value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)} style={inputStyle}>
                    <option value="ALL">All Types</option>
                    <option value="CHEMICAL">Chemical</option>
                    <option value="EQUIPMENT">Equipment</option>
                    <option value="MATERIAL">Material</option>
                  </select>
                </div>

                <div style={{ flex: "0 0 170px" }}>
                  <label style={{ display: "block", color: "#475569", fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.45rem" }}>
                    Status
                  </label>
                  <select value={itemStatusFilter} onChange={(e) => setItemStatusFilter(e.target.value)} style={inputStyle}>
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="DISABLED">Disabled</option>
                  </select>
                </div>

                <div style={{ flex: "0 0 170px" }}>
                  <label style={{ display: "block", color: "#475569", fontSize: "0.75rem", fontWeight: 700, marginBottom: "0.45rem" }}>
                    Stock Level
                  </label>
                  <select value={itemStockFilter} onChange={(e) => setItemStockFilter(e.target.value)} style={inputStyle}>
                    <option value="ALL">All Stock Levels</option>
                    <option value="OUT">Out of Stock</option>
                    <option value="LOW">Low Stock</option>
                    <option value="HEALTHY">Healthy Stock</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={clearItemFilters}
                  disabled={!hasItemFilters}
                  style={{
                    ...secondaryButton,
                    padding: "0.72rem 0.9rem",
                    fontSize: "0.82rem",
                    minWidth: "120px",
                    opacity: hasItemFilters ? 1 : 0.55,
                  }}
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: "1200px", width: "100%", margin: "0 auto", background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "18px", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)", overflow: "visible", position: "relative", zIndex: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.5fr) 1fr 1.2fr 1fr 1.4fr", gap: "0.75rem", padding: "0.9rem 1.5rem", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>Item Details</span>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>Type</span>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Stock Level</span>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>Status</span>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Actions</span>
            </div>

            {error && (
              <div style={{ padding: "1.25rem", color: "#b91c1c", background: "#fef2f2" }}>
                Could not load inventory — {error}
              </div>
            )}

            {!error && loading && (
              <div style={{ padding: "1.25rem", color: "#6b7280" }}>Loading inventory…</div>
            )}

            {!error && !loading && inventory.length === 0 && (
              <div style={{ padding: "1.5rem", color: "#6b7280", display: "grid", gap: "0.75rem", justifyItems: "start" }}>
                <span>No inventory items yet. Add your first item to start tracking stock.</span>
                <button type="button" onClick={() => setOpenForm(true)} style={{ background: "#b91c1c", color: "#ffffff", border: "none", borderRadius: "8px", padding: "0.65rem 0.9rem", fontWeight: 700, cursor: "pointer" }}>
                  Add inventory item
                </button>
              </div>
            )}

            {!error && !loading && inventory.length > 0 && filteredInventory.length === 0 && (
              <div style={{ padding: "1.25rem", color: "#6b7280" }}>
                No inventory items match the current filters.
              </div>
            )}

            {filteredInventory.map((item) => {
              const isLowStock = Number(item.quantity) <= 0 || (item.reorderLevel !== null && item.reorderLevel !== undefined && item.quantity <= item.reorderLevel);
              const isDisabled = item.status === INVENTORY_STATUS.DISABLED;
              const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";
              const stockText = `${Number(item.quantity || 0).toLocaleString()} ${item.unit || ""}`.trim();
              const stockBadgeStyle = isDisabled
                ? { background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#475569" }
                : isLowStock
                  ? { background: "#fff7ed", border: "1px solid #fed7aa", color: "#b45309" }
                  : { background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#166534" };

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 2.5fr) 1fr 1.2fr 1fr 1.4fr",
                    gap: "0.75rem",
                    padding: "1rem",
                    borderTop: "1px solid #f1f5f9",
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "background-color 0.2s ease",
                    background: isDisabled ? "#f8fafc" : "#ffffff",
                    position: "relative",
                    zIndex: actionMenuItemId === item.id ? 60 : 1,
                    overflow: "visible",
                    isolation: "isolate",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.96rem" }}>{item.name}</div>
                    <div style={{ marginTop: "0.2rem", fontSize: "0.72rem", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.supplier || item.storageLocation || "Inventory item"}
                    </div>
                  </div>

                  <div style={{ color: "#475569", fontSize: "0.9rem" }}>{typeLabel}</div>

                  <div style={{ color: isLowStock ? "#b91c1c" : "#0f172a", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>
                    {stockText}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        borderRadius: "999px",
                        padding: "0.32rem 0.7rem",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        ...stockBadgeStyle,
                      }}
                    >
                      {isDisabled ? "Disabled" : isLowStock ? "Low Stock" : "Healthy"}
                    </span>
                  </div>

                  <div ref={actionMenuItemId === item.id ? actionMenuRef : null} style={{ display: "flex", gap: "0.45rem", alignItems: "center", justifyContent: "flex-end", overflow: "visible", position: "relative", zIndex: actionMenuItemId === item.id ? 200 : 1 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setStockInItem(item)}
                      style={{
                        ...secondaryButton,
                        padding: "0.42rem 0.72rem",
                        fontSize: "0.72rem",
                        border: "1px solid #cbd5e1",
                        background: "#ffffff",
                        color: "#334155",
                        borderRadius: "6px",
                        boxShadow: "none",
                      }}
                    >
                      Stock In
                    </button>

                    <div style={{ position: "relative", display: "inline-block", overflow: "visible", zIndex: actionMenuItemId === item.id ? 300 : 1 }}>
                      <button
                        type="button"
                        aria-label="More actions"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleActionMenuToggle(event, item.id);
                        }}
                        style={{
                          width: "2rem",
                          height: "2rem",
                          borderRadius: "9px",
                          border: "1px solid #e2e8f0",
                          background: "#ffffff",
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                          color: "#475569",
                          padding: "0.375rem",
                          position: "relative",
                          zIndex: 500,
                        }}
                      >
                        <MoreHorizontal size={15} />
                      </button>

                      {actionMenuItemId === item.id && (
                        <div
                          style={{
                            position: "absolute",
                            right: 0,
                            top: actionMenuDirection[item.id] === "up" ? "auto" : "calc(100% + 0.3rem)",
                            bottom: actionMenuDirection[item.id] === "up" ? "calc(100% + 0.3rem)" : "auto",
                            background: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "12px",
                            boxShadow: "0 18px 34px rgba(15, 23, 42, 0.16)",
                            minWidth: "170px",
                            padding: "0.35rem",
                            zIndex: 5000,
                            pointerEvents: "auto",
                          }}
                        >
                          <button type="button" onClick={() => { setActionMenuItemId(null); setEditItem(item); }} style={{ ...menuActionStyle, color: "#0f172a" }}>Edit</button>
                          {!isDisabled && <button type="button" onClick={() => { setActionMenuItemId(null); setCorrectionItem(item); }} style={{ ...menuActionStyle, color: "#7c3aed" }}>Correct Stock</button>}
                          <button type="button" onClick={() => { setActionMenuItemId(null); if (isDisabled) setItemStatus(item.id, INVENTORY_STATUS.ACTIVE).then((r) => handleStatusResult(r, showSuccess, showError, item.name, "enabled")); else setDisableTarget(item); }} style={{ ...menuActionStyle, color: isDisabled ? "#166534" : "#b91c1c" }}>
                            {isDisabled ? "Enable" : "Disable"}
                          </button>
                          <button type="button" onClick={() => { setActionMenuItemId(null); setDeleteTarget(item); }} style={{ ...menuActionStyle, color: "#7f1d1d" }}>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ padding: "0.75rem 1.5rem", borderTop: "1px solid #e2e8f0", background: "#f8fafc", color: "#64748b", fontSize: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Showing {filteredInventory.length} of {inventory.length} items</span>
            </div>
          </div>
        </>
      )}

      {tab === "history" && (
        <div style={{ maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
          {/* Filtering and Sorting Toolbar */}
          <div style={{ background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "18px", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)", padding: "1rem", marginBottom: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.85rem" }}>
              <Field label="Search Logs">
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Item, PO#, branch, actor…"
                  style={inputStyle}
                />
              </Field>

              <Field label="Filter by Item">
                <select value={historyItemFilter} onChange={(e) => setHistoryItemFilter(e.target.value)} style={inputStyle}>
                  <option value="ALL">All Items</option>
                  {uniqueItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Movement Type">
                <select value={historyMovementType} onChange={(e) => setHistoryMovementType(e.target.value)} style={inputStyle}>
                  <option value="ALL">All Movements</option>
                  <option value="IN">Stock In</option>
                  <option value="OUT">Stock Out</option>
                  <option value="CORRECTION">Corrections</option>
                </select>
              </Field>

              <Field label="Branch / Station">
                <select value={historyBranchFilter} onChange={(e) => setHistoryBranchFilter(e.target.value)} style={inputStyle}>
                  <option value="ALL">All Stations / Branches</option>
                  {uniqueBranches.map((br) => (
                    <option key={br} value={br}>
                      {br}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date Range">
                <select value={historyDateFilter} onChange={(e) => setHistoryDateFilter(e.target.value)} style={inputStyle}>
                  <option value="ALL">All Time</option>
                  <option value="TODAY">Today</option>
                  <option value="7DAYS">Last 7 Days</option>
                  <option value="30DAYS">Last 30 Days</option>
                </select>
              </Field>

              <Field label="Sort By">
                <select value={historySort} onChange={(e) => setHistorySort(e.target.value)} style={inputStyle}>
                  <option value="DATE_DESC">Date (Newest First)</option>
                  <option value="DATE_ASC">Date (Oldest First)</option>
                  <option value="COST_DESC">Capital Spent (Highest First)</option>
                  <option value="COST_ASC">Capital Spent (Lowest First)</option>
                  <option value="AMOUNT_DESC">Amount (Highest First)</option>
                  <option value="AMOUNT_ASC">Amount (Lowest First)</option>
                  <option value="NAME_ASC">Item Name (A to Z)</option>
                </select>
              </Field>
            </div>
          </div>

          {/* Records Table */}
          <div style={{ background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "18px", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1.2fr 100px 100px 110px 125px 1.1fr 1.1fr 1fr",
                  minWidth: "1040px",
                  gap: "0.75rem",
                  padding: "1rem 1.25rem",
                  background: "#f8fafc",
                  fontWeight: 700,
                  color: "#64748b",
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                <span>Date</span>
                <span>Item Name</span>
                <span>Movement</span>
                <span>Amount</span>
                <span>Unit Cost</span>
                <span>Total Spent</span>
                <span>PO / Reference</span>
                <span>Branch / Origin</span>
                <span>Recorded By</span>
              </div>
              {movementsError && (
                <div style={{ padding: "1.25rem", color: "#b91c1c", background: "#fef2f2" }}>
                  Could not load history — {movementsError}
                </div>
              )}

              {!movementsError && movementsLoading && (
                <div style={{ padding: "1.25rem", color: "#6b7280" }}>Loading history…</div>
              )}

              {!movementsError && !movementsLoading && filteredAndSortedMovements.length === 0 && (
                <div style={{ padding: "1.75rem", textAlign: "center", color: "#6b7280" }}>
                  No inventory movements match the current filters.
                </div>
              )}

              {filteredAndSortedMovements.map((movement) => (
                <div
                  key={movement.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1.2fr 100px 100px 110px 125px 1.1fr 1.1fr 1fr",
                    minWidth: "1040px",
                    gap: "0.75rem",
                    padding: "0.95rem 1.25rem",
                    borderTop: "1px solid #f1f5f9",
                    alignItems: "center",
                    fontSize: "0.9rem",
                  }}
                >
                  <div style={{ color: "#374151" }}>{new Date(movement.movementDate).toLocaleDateString()}</div>
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>{movement.itemName}</div>
                    {movement.itemUnit && <div style={{ fontSize: "0.76rem", color: "#6b7280" }}>Unit: {movement.itemUnit}</div>}
                  </div>
                  <div style={{ fontWeight: 800, color: movement.movementType === "OUT" ? "#b91c1c" : movement.movementType === "CORRECTION" ? "#7c3aed" : "#166534" }}>
                    {movement.movementType || "IN"}
                  </div>
                  <div style={{ fontWeight: 700, color: movement.quantityDelta < 0 ? "#b91c1c" : "#166534" }}>
                    {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}
                  </div>
                  <div style={{ color: "#475569" }}>
                    ₱{(movement.unitCost || 0).toFixed(2)}
                  </div>
                  <div style={{ fontWeight: 700, color: "#047857" }}>
                    ₱{(movement.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ color: "#1e293b", fontWeight: 600 }}>
                    {movement.reference || (movement.appointmentId ? `Appointment ${movement.appointmentId}` : "—")}
                  </div>
                  <div style={{ color: "#475569" }}>
                    {movement.intakeBranchOrStation || "—"}
                  </div>
                  <div style={{ color: "#64748b" }}>
                    {movement.actor || "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedItem && <InventoryDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />}

      {editItem && (
        <EditItemModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={async (values) => {
            const result = await updateItem(editItem.id, values);
            if (result !== true) {
              showError(typeof result === "string" ? result : "Could not update the item.");
              return false;
            }
            showSuccess(`${values.name} updated.`);
            setEditItem(null);
            return true;
          }}
        />
      )}

      {stockInItem && (
        <StockInModal
          item={stockInItem}
          onClose={() => setStockInItem(null)}
          onSubmit={async (values) => {
            const result = await stockIn(stockInItem.id, values);
            if (result !== true) {
              showError(typeof result === "string" ? result : "Could not record the Stock In.");
              return false;
            }
            showSuccess(`Added ${values.amount} ${stockInItem.unit} to ${stockInItem.name}.`);
            setStockInItem(null);
            return true;
          }}
        />
      )}

      {correctionItem && (
        <StockCorrectionModal
          item={correctionItem}
          onClose={() => setCorrectionItem(null)}
          onSubmit={async (values) => {
            const result = await stockCorrection(correctionItem.id, values.delta, values.reason);
            if (result !== true) {
              showError(typeof result === "string" ? result : "Could not record the correction.");
              return;
            }
            showSuccess(`Recorded a stock correction for ${correctionItem.name}.`);
            setCorrectionItem(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!disableTarget}
        title="Disable this item?"
        message={
          disableTarget
            ? `"${disableTarget.name}" will be greyed out and Stock In will be blocked until you re-enable it. Its current quantity and history stay intact — nothing is deleted.`
            : ""
        }
        confirmLabel="Disable"
        tone="danger"
        onConfirm={async () => {
          const target = disableTarget;
          setDisableTarget(null);
          const result = await setItemStatus(target.id, INVENTORY_STATUS.DISABLED);
          if (result !== true) {
            showError(typeof result === "string" ? result : "Could not disable the item.");
            return;
          }
          showSuccess(`${target.name} disabled.`);
        }}
        onCancel={() => setDisableTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this item?"
        message={
          deleteTarget
            ? `"${deleteTarget.name}" will be permanently removed from inventory. This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          const target = deleteTarget;
          setDeleteTarget(null);
          const result = await removeItem(target.id);
          if (result !== true) {
            showError(typeof result === "string" ? result : "Could not delete the item.");
            return;
          }
          showSuccess(`${target.name} deleted.`);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

async function handleStatusResult(result, showSuccess, showError, name, verb) {
  if (result !== true) {
    showError(typeof result === "string" ? result : `Could not update ${name}.`);
    return;
  }
  showSuccess(`${name} ${verb}.`);
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "none",
        padding: "0.75rem 0.25rem",
        marginBottom: "-2px",
        borderBottom: active ? `3px solid ${colors.brandLight}` : "3px solid transparent",
        color: active ? colors.brandInk : "#6b7280",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: "0.95rem",
      }}
    >
      {children}
    </button>
  );
}

function EditItemModal({ item, onClose, onSave }) {
  const [values, setValues] = useState({
    ...CREATE_FORM_DEFAULTS,
    name: item.name || "",
    type: item.type || "CHEMICAL",
    unit: item.unit || "",
    cost: item.cost ?? "",
    supplier: item.supplier || "",
    storageLocation: item.storageLocation || "",
    reorderLevel: item.reorderLevel ?? "",
    chemicalType: item.chemicalType || "INSECTICIDE",
    expirationDate: item.expirationDate || "",
    safetyLevel: item.safetyLevel || "",
    hazardRating: item.hazardRating || "",
    standardRate: item.standardRate === 0 || item.standardRate ? String(item.standardRate) : "",
    rateUnit: item.rateUnit || "",
    rateNote: item.rateNote || "",
    dateReceived: item.dateReceived || "",
    serialNumber: item.serialNumber || "",
    condition: item.condition || "ACTIVE",
    lastMaintenanceDate: item.lastMaintenanceDate || "",
    nextMaintenanceDate: item.nextMaintenanceDate || "",
    manufacturer: item.manufacturer || "",
    model: item.model || "",
    materialCategory: item.materialCategory || "SUPPLIES",
    description: item.description || "",
  });
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValidationError("");
    setValues((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!values.name.trim() || !values.unit.trim() || values.cost === "") return;
    if (values.lastMaintenanceDate && values.nextMaintenanceDate && values.nextMaintenanceDate <= values.lastMaintenanceDate) {
      setValidationError("Next maintenance must be after the last maintenance date.");
      return;
    }
    setSaving(true);
    await onSave({ ...values, name: values.name.trim(), unit: values.unit.trim() });
    setSaving(false);
  };

  return (
    <ModalShell onClose={onClose} title={`Edit "${item.name}"`} maxWidth="42rem">
      <form onSubmit={handleSubmit}>
        <p style={{ margin: "0 0 1.25rem", color: "#6b7280", fontSize: "0.85rem" }}>
          Update this item's details here. Quantity stays protected and can only be changed through Stock In, which records every adjustment in history.
        </p>
        {validationError && <p style={{ margin: "0 0 1rem", color: "#b91c1c", fontSize: "0.85rem", fontWeight: 700 }}>{validationError}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          <Field label="Item Name *">
            <input name="name" value={values.name} onChange={handleChange} style={inputStyle} required />
          </Field>
          <Field label="Type *">
            <select name="type" value={values.type} disabled style={{ ...inputStyle, background: "#f3f4f6", cursor: "not-allowed" }} title="Type is fixed after creation to preserve the item's stock history.">
              <option value="CHEMICAL">Chemical</option>
              <option value="EQUIPMENT">Equipment</option>
              <option value="MATERIAL">Material</option>
            </select>
          </Field>
          <UnitField value={values.unit} onChange={(unit) => setValues((previous) => ({ ...previous, unit }))} />
          <Field label="Cost per Unit (₱) *">
            <input name="cost" type="number" min="0" step="0.01" value={values.cost} onChange={handleChange} style={inputStyle} required />
          </Field>
          <Field label="Supplier">
            <input name="supplier" value={values.supplier} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Storage Location">
            <input name="storageLocation" value={values.storageLocation} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Reorder Level">
            <input name="reorderLevel" type="number" min="0" step="0.1" value={values.reorderLevel} onChange={handleChange} style={inputStyle} />
          </Field>
        </div>

        {values.type === "CHEMICAL" && (
          <section style={editSectionStyle}>
            <h3 style={editSectionHeadingStyle}>Chemical Details</h3>
            <div style={editGridStyle}>
              <Field label="Chemical Type *">
                <select name="chemicalType" value={values.chemicalType} onChange={handleChange} style={inputStyle} required>
                  <option value="INSECTICIDE">Insecticide</option><option value="FUNGICIDE">Fungicide</option><option value="RODENTICIDE">Rodenticide</option><option value="HERBICIDE">Herbicide</option><option value="FUMIGANT">Fumigant</option><option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="Expiration Date"><input name="expirationDate" type="date" value={values.expirationDate} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Safety Level *">
                <select name="safetyLevel" value={values.safetyLevel} onChange={handleChange} style={inputStyle} required>
                  <option value="">Select safety level</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </Field>
              <Field label="Hazard Rating"><input name="hazardRating" value={values.hazardRating} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Standard Rate"><input name="standardRate" type="number" step="any" min="0" value={values.standardRate} onChange={handleChange} style={inputStyle} placeholder="10" /></Field>
              <Field label="Rate Unit"><input name="rateUnit" value={values.rateUnit} onChange={handleChange} style={inputStyle} placeholder="mL per 1 L water" /></Field>
              <Field label="Mixing Note"><input name="rateNote" value={values.rateNote} onChange={handleChange} style={inputStyle} placeholder="0.03% dilution" /></Field>
              <Field label="Date Received"><input name="dateReceived" type="date" value={values.dateReceived} onChange={handleChange} style={inputStyle} /></Field>
            </div>
          </section>
        )}

        {values.type === "EQUIPMENT" && (
          <section style={editSectionStyle}>
            <h3 style={editSectionHeadingStyle}>Equipment Details</h3>
            <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>After servicing equipment, set Last Maintenance to the service date and schedule its Next Maintenance date.</p>
            <div style={editGridStyle}>
              <Field label="Serial Number"><input name="serialNumber" value={values.serialNumber} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Condition *"><select name="condition" value={values.condition} onChange={handleChange} style={inputStyle} required><option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="DAMAGED">Damaged</option><option value="INACTIVE">Inactive</option></select></Field>
              <Field label="Manufacturer"><input name="manufacturer" value={values.manufacturer} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Model"><input name="model" value={values.model} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Last Maintenance Date"><input name="lastMaintenanceDate" type="date" value={values.lastMaintenanceDate} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Next Maintenance Date"><input name="nextMaintenanceDate" type="date" value={values.nextMaintenanceDate} onChange={handleChange} style={inputStyle} /></Field>
            </div>
          </section>
        )}

        {values.type === "MATERIAL" && (
          <section style={editSectionStyle}>
            <h3 style={editSectionHeadingStyle}>Material Details</h3>
            <Field label="Material Category *"><select name="materialCategory" value={values.materialCategory} onChange={handleChange} style={inputStyle} required><option value="PROTECTIVE_GEAR">Protective Gear</option><option value="SUPPLIES">Supplies</option><option value="TOOLS_ACCESSORIES">Tools & Accessories</option><option value="OTHER">Other</option></select></Field>
            <div style={{ marginTop: "1rem" }}><Field label="Description"><textarea name="description" value={values.description} onChange={handleChange} style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }} /></Field></div>
          </section>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem", gap: "0.5rem" }}>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={buttonWhen(saving)}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function StockInModal({ item, onClose, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [unitCost, setUnitCost] = useState(item.cost !== undefined && item.cost !== null ? item.cost : "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [intakeBranchOrStation, setIntakeBranchOrStation] = useState(item.intakeBranchOrStation || "");
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const [saving, setSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const numericCost = Number(unitCost) || 0;
  const totalCapitalSpent = numericAmount * numericCost;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0 || !date) return;
    if (!reference.trim() || !intakeBranchOrStation.trim()) return;
    setSaving(true);
    await onSubmit({
      amount: parsedAmount,
      unitCost: Number(unitCost) || 0,
      date,
      reference: reference.trim(),
      intakeBranchOrStation: intakeBranchOrStation.trim(),
      idempotencyKey,
    });
    setSaving(false);
  };

  return (
    <ModalShell onClose={onClose} title="Stock In" subtitle={`Item: ${item.name} • Current Stock: ${item.quantity} ${item.unit}`}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <Field label={`Amount (${item.unit}) *`}>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={inputStyle}
              placeholder="0"
              required
              autoFocus
            />
          </Field>

          <Field label={`Purchase Cost per Unit (₱) *`} hint="Unit price paid for this delivery batch">
            <input
              type="number"
              min="0"
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              style={inputStyle}
              placeholder="0.00"
              required
            />
          </Field>

          <div
            style={{
              padding: "0.9rem 1rem",
              background: "#f8fafc",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <div>
              <div style={{ color: "#475569", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Total Cost
              </div>
              <div style={{ color: "#64748b", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                Qty × Cost per unit
              </div>
            </div>
            <div style={{ color: "#0f172a", fontSize: "1rem", fontWeight: 800, textAlign: "right" }}>
              ₱{totalCapitalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <Field label="Date *">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} required />
          </Field>
          <Field label="PO / Supplier Invoice Reference *" hint="Enter the Purchase Order (PO) or invoice number">
            <input value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} placeholder="PO-1001, Invoice #, delivery note" required />
          </Field>
          <Field label="Intake Branch / Station *" hint="Station or warehouse where items were received">
            <input value={intakeBranchOrStation} onChange={(e) => setIntakeBranchOrStation(e.target.value)} style={inputStyle} placeholder="e.g. Main Warehouse, Pasig Station" required />
          </Field>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.75rem", paddingTop: "1rem", borderTop: "1px solid #f1f5f9" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#334155",
              borderRadius: "10px",
              padding: "0.65rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            style={{
              border: "none",
              background: "#7f1d1d",
              color: "#ffffff",
              borderRadius: "10px",
              padding: "0.65rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.7 : 1,
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
            }}
          >
            {saving ? "Recording…" : "Submit"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function StockCorrectionModal({ item, onClose, onSubmit }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const parsedDelta = Number(delta);
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0 || !reason.trim()) return;
    setSaving(true);
    await onSubmit({ delta: parsedDelta, reason: reason.trim() });
    setSaving(false);
  };

  return (
    <ModalShell onClose={onClose} title="Correct Stock" subtitle={`Item: ${item.name} • Current Stock: ${item.quantity} ${item.unit}`}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        <Field label={`Adjustment (${item.unit}) *`} hint="Use a positive number to add stock or a negative number to remove stock.">
          <input type="number" step="1" value={delta} onChange={(event) => setDelta(event.target.value)} style={inputStyle} placeholder="e.g. -2 or 5" required autoFocus />
        </Field>
        <Field label="Reason *">
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} style={{ ...inputStyle, minHeight: "90px", resize: "vertical" }} placeholder="Explain the physical count or discrepancy" required />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem" }}><button type="button" onClick={onClose} style={secondaryButton}>Cancel</button><button type="submit" disabled={saving} style={buttonWhen(saving)}>{saving ? "Recording…" : "Record correction"}</button></div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, subtitle, onClose, children, maxWidth = "28rem" }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
          padding: "1.5rem",
          maxWidth,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.35rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "#0f172a", fontSize: "1.125rem", fontWeight: 800 }}>{title}</h2>
            {subtitle && <p style={{ margin: "0.35rem 0 0", color: "#64748b", fontSize: "0.72rem", lineHeight: 1.4 }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            type="button"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "999px",
              width: "2rem",
              height: "2rem",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: "#475569",
            }}
            aria-label="Close stock in modal"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function InventoryDetailModal({ item, onClose }) {
  const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";

  return (
    <ModalShell onClose={onClose} title={item.name}>
      {/* Basic Information */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
          Basic Information
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <DetailRow label="Type" value={typeLabel} />
          <DetailRow label="Status" value={item.status === "DISABLED" ? "Disabled" : "Active"} />
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
            {item.standardRate !== "" && item.standardRate !== null && <DetailRow label="Standard Rate" value={`${item.standardRate} ${item.rateUnit || ""}`.trim()} />}
            {item.rateNote && <DetailRow label="Mixing Note" value={item.rateNote} />}
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
            <DetailRow label="Material Category" value={formatMaterialCategory(item.materialCategory)} />
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
    </ModalShell>
  );
}

function formatMaterialCategory(category) {
  return category
    ? category
        .toLowerCase()
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : "";
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

function buttonWhen(disabled, base = primaryButton, extra = {}) {
  return { ...base, ...extra, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
}

const actionButtonSize = {
  padding: "0.45rem 0.7rem",
  fontSize: "0.8rem",
  borderRadius: "8px",
};

const actionButtonStyle = {
  ...secondaryButton,
  ...actionButtonSize,
};

const menuActionStyle = {
  width: "100%",
  border: "none",
  background: "#ffffff",
  textAlign: "left",
  padding: "0.6rem 0.7rem",
  borderRadius: "8px",
  fontWeight: 600,
  cursor: "pointer",
  opacity: 1,
};

const inputStyle = {
  width: "100%",
  border: "1px solid #d9d9d9",
  borderRadius: "10px",
  padding: "0.72rem 0.8rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: "#111827",
};

const editSectionStyle = {
  marginTop: "1.5rem",
  paddingTop: "1.25rem",
  borderTop: "1px solid #e5e7eb",
};

const editSectionHeadingStyle = {
  margin: "0 0 1rem",
  color: "#374151",
  fontSize: "1rem",
};

const editGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "1rem",
};

export default InventoryPage;
