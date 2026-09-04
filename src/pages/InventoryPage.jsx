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

import { useEffect, useMemo, useState } from "react";
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
  dateReceived: "",
  serialNumber: "",
  condition: "ACTIVE",
  lastMaintenanceDate: "",
  nextMaintenanceDate: "",
  manufacturer: "",
  model: "",
  materialCategory: "SUPPLIES",
  description: "",
  purchaseUnit: "",
  usageUnit: "",
  conversionMultiplier: "1",
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
  const canCreate = can(SUBSYSTEMS.INVENTORY, "create");
  const canEdit = can(SUBSYSTEMS.INVENTORY, "edit");

  const {
    inventory,
    addItem: onAddItem,
    updateItem,
    setItemStatus,
    stockIn,
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
  const [disableTarget, setDisableTarget] = useState(null);
  const [form, setForm] = useState(CREATE_FORM_DEFAULTS);

  // History filtering and sorting states
  const [historySearch, setHistorySearch] = useState("");
  const [historyItemFilter, setHistoryItemFilter] = useState("ALL");
  const [historyBranchFilter, setHistoryBranchFilter] = useState("ALL");
  const [historyDateFilter, setHistoryDateFilter] = useState("ALL");
  const [historySort, setHistorySort] = useState("DATE_DESC");

  const uniqueBranches = useMemo(() => {
    const set = new Set();
    movements.forEach((m) => {
      if (m.intakeBranchOrStation && m.intakeBranchOrStation !== "—") set.add(m.intakeBranchOrStation);
    });
    return Array.from(set).sort();
  }, [movements]);

  const uniqueItems = useMemo(() => {
    const map = new Map();
    movements.forEach((m) => {
      if (m.itemId && m.itemName) map.set(m.itemId, m.itemName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [movements]);

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
  }, [movements, historySearch, historyItemFilter, historyBranchFilter, historyDateFilter, historySort]);

  const totalCapitalSpent = useMemo(() => {
    return filteredAndSortedMovements.reduce((sum, m) => sum + (m.totalCost || 0), 0);
  }, [filteredAndSortedMovements]);

  const totalUnitsReceived = useMemo(() => {
    return filteredAndSortedMovements.reduce((sum, m) => sum + (m.amount || 0), 0);
  }, [filteredAndSortedMovements]);

  useEffect(() => {
    if (tab === "history") refreshMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
          <p style={{ color: colors.brandInk, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.75rem" }}>
            Inventory
          </p>
          <h1 style={{ margin: "0.2rem 0 0", fontSize: "2rem", color: "#111827" }}>Item Profile</h1>
        </div>
        {tab === "items" && (
          <button type="button" onClick={() => setOpenForm((value) => !value)} style={primaryButton}>
            {openForm ? "Close Form" : "Add Inventory Item"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", borderBottom: `2px solid #f0f0f0` }}>
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
                  <Field label="Purchase Unit">
                    <input name="purchaseUnit" value={form.purchaseUnit} onChange={handleChange} style={inputStyle} placeholder="e.g. 5-gallon jug" />
                  </Field>
                  <Field label="Usage Unit">
                    <input name="usageUnit" value={form.usageUnit} onChange={handleChange} style={inputStyle} placeholder="e.g. mL" />
                  </Field>
                  <Field label="Usage Units per Purchase Unit">
                    <input name="conversionMultiplier" type="number" min="0.000001" step="any" value={form.conversionMultiplier} onChange={handleChange} style={inputStyle} required />
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

          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.1fr 0.7fr 0.9fr 1fr 1.6fr", gap: "0.75rem", padding: "1rem 1.25rem", background: "#fafafa", fontWeight: 700, color: "#374151" }}>
              <span>Item Name</span>
              <span>Type</span>
              <span>Unit</span>
              <span>Quantity</span>
              <span>Info</span>
              <span>Actions</span>
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
              <div style={{ padding: "1.25rem", color: "#6b7280" }}>
                No inventory items yet. Add one using the form above.
              </div>
            )}

            {inventory.map((item) => {
              const isLowStock = item.reorderLevel && item.quantity <= item.reorderLevel;
              const isDisabled = item.status === INVENTORY_STATUS.DISABLED;
              const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1.1fr 0.7fr 0.9fr 1fr 1.6fr",
                    gap: "0.75rem",
                    padding: "1rem 1.25rem",
                    borderTop: "1px solid #f1f1f1",
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "background-color 0.2s",
                    opacity: isDisabled ? 0.55 : 1,
                    background: isDisabled ? "#fafafa" : "transparent",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDisabled ? "#f3f4f6" : "#f9f9f9")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDisabled ? "#fafafa" : "transparent")}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>
                      {item.name}
                      {isDisabled && (
                        <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Disabled
                        </span>
                      )}
                    </div>
                    {item.supplier && <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{item.supplier}</div>}
                  </div>
                  <div style={{ color: "#374151" }}>{typeLabel}</div>
                  <div style={{ color: "#374151" }}>{item.unit}</div>
                  <div style={{ fontWeight: 700, color: isLowStock ? "#b91c1c" : "#111827" }}>{item.quantity}</div>
                  <div>
                    {isDisabled ? (
                      <span style={{ background: "#f3f4f6", color: "#4b5563", borderRadius: "999px", padding: "0.35rem 0.7rem", fontSize: "0.75rem", fontWeight: 700 }}>
                        Disabled
                      </span>
                    ) : isLowStock ? (
                      <span style={{ background: "#fee2e2", color: "#991b1b", borderRadius: "999px", padding: "0.35rem 0.7rem", fontSize: "0.75rem", fontWeight: 700 }}>
                        Low Stock
                      </span>
                    ) : (
                      <span style={{ background: "#dcfce7", color: "#166534", borderRadius: "999px", padding: "0.35rem 0.7rem", fontSize: "0.75rem", fontWeight: 700 }}>
                        Healthy
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => setEditItem(item)} style={actionButtonStyle}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => !isDisabled && setStockInItem(item)}
                      style={buttonWhen(isDisabled, successButton, actionButtonSize)}
                      title={isDisabled ? "Enable this item to add stock" : "Record a Stock In"}
                    >
                      Stock In
                    </button>
                    {isDisabled ? (
                      <button type="button" onClick={() => setItemStatus(item.id, INVENTORY_STATUS.ACTIVE).then((r) => handleStatusResult(r, showSuccess, showError, item.name, "enabled"))} style={{ ...actionButtonStyle }}>
                        Enable
                      </button>
                    ) : (
                      <button type="button" onClick={() => setDisableTarget(item)} style={{ ...dangerButton, ...actionButtonSize }}>
                        Disable
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "history" && (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          {/* Filtering and Sorting Toolbar */}
          <div style={{ ...card, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
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
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1.4fr 100px 110px 130px 1.1fr 1.1fr 1fr",
                  minWidth: "920px",
                  gap: "0.75rem",
                  padding: "1rem 1.25rem",
                  background: "#fafafa",
                  fontWeight: 700,
                  color: "#374151",
                  fontSize: "0.85rem",
                }}
              >
                <span>Date</span>
                <span>Item Name</span>
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
                  No Stock In records match the current filters.
                </div>
              )}

              {filteredAndSortedMovements.map((movement) => (
                <div
                  key={movement.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1.4fr 100px 110px 130px 1.1fr 1.1fr 1fr",
                    minWidth: "920px",
                    gap: "0.75rem",
                    padding: "0.95rem 1.25rem",
                    borderTop: "1px solid #f1f1f1",
                    alignItems: "center",
                    fontSize: "0.9rem",
                  }}
                >
                  <div style={{ color: "#374151" }}>{new Date(movement.movementDate).toLocaleDateString()}</div>
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>{movement.itemName}</div>
                    {movement.itemUnit && <div style={{ fontSize: "0.76rem", color: "#6b7280" }}>Unit: {movement.itemUnit}</div>}
                  </div>
                  <div style={{ fontWeight: 700, color: "#166534" }}>
                    +{movement.amount}
                  </div>
                  <div style={{ color: "#475569" }}>
                    ₱{(movement.unitCost || 0).toFixed(2)}
                  </div>
                  <div style={{ fontWeight: 700, color: "#047857" }}>
                    ₱{(movement.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ color: "#1e293b", fontWeight: 600 }}>
                    {movement.reference || "—"}
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
    <ModalShell onClose={onClose} title={`Edit "${item.name}"`}>
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
              <Field label="Safety Level"><input name="safetyLevel" value={values.safetyLevel} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Hazard Rating"><input name="hazardRating" value={values.hazardRating} onChange={handleChange} style={inputStyle} /></Field>
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
    <ModalShell onClose={onClose} title={`Stock In — ${item.name}`}>
      <form onSubmit={handleSubmit}>
        <p style={{ margin: "0 0 1.25rem", color: "#6b7280", fontSize: "0.85rem" }}>
          Current stock: <strong>{item.quantity} {item.unit}</strong>. Record received delivery and purchase costs.
        </p>
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
              padding: "0.85rem 1.1rem",
              background: "#f0fdf4",
              borderRadius: "10px",
              border: "1px solid #bbf7d0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ color: "#166534", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Total Capital Spent
              </div>
              <div style={{ color: "#15803d", fontSize: "0.8rem", marginTop: "0.15rem" }}>
                {numericAmount} {item.unit} × ₱{numericCost.toFixed(2)}
              </div>
            </div>
            <div style={{ color: "#14532d", fontSize: "1.35rem", fontWeight: 800 }}>
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

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem", gap: "0.5rem" }}>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={buttonWhen(saving, successButton)}>
            {saving ? "Recording…" : "Add Stock & Record Cost"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
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
          background: "linear-gradient(180deg, #ffffff 0%, #fff8f8 100%)",
          border: `2px solid ${colors.brandLight}`,
          borderRadius: "16px",
          padding: "2rem",
          maxWidth: "480px",
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
          <h2 style={{ margin: 0, color: colors.brandInk, fontSize: "1.25rem" }}>{title}</h2>
          <button onClick={onClose} type="button" style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#6b7280" }}>
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
