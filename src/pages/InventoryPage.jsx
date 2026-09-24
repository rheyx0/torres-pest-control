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
import { MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import useInventory from "../hooks/useInventory";
import useAuth from "../hooks/useAuth";
import { SUBSYSTEMS } from "../utils/permissions";
import { useToast } from "../context/ToastContext";
import { INVENTORY_STATUS } from "../services/inventoryService";
import { card, colors, primaryButton, secondaryButton, dangerButton, successButton } from "../styles/theme";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { formatInventoryQuantity } from "../utils/formatters";

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
const TODAY = () => new Date().toISOString().slice(0, 10);
const BRANCH_OPTIONS = [
  "Davao Main Service Branch",
  "Samal Service Branch",
  "Digos Service Branch",
  "Dumaguete Service Branch",
  "Panglao Service Branch",
  "Cebu Service Branch",
];
const DEFAULT_BRANCH = BRANCH_OPTIONS[0];
const HISTORY_BRANCH_OPTIONS = ["All Stations / Branches", ...BRANCH_OPTIONS];

function UnitField({ value, onChange, inlineCustom = false }) {
  const usesCustomUnit = value && !UNIT_OPTIONS.includes(value);

  return (
    <Field label="Unit *">
      <div style={usesCustomUnit && inlineCustom ? { display: "flex", gap: "0.5rem", minWidth: 0 } : undefined}>
        <select
          value={usesCustomUnit ? "OTHER" : value}
          onChange={(event) => onChange(event.target.value === "OTHER" ? "" : event.target.value)}
          style={usesCustomUnit && inlineCustom ? { ...inputStyle, width: "50%", minWidth: 0 } : inputStyle}
          required
        >
          {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          <option value="OTHER">Other</option>
        </select>
        {usesCustomUnit && (
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            style={usesCustomUnit && inlineCustom ? { ...inputStyle, width: "50%", minWidth: 0 } : { ...inputStyle, marginTop: "0.5rem" }}
            placeholder="e.g. box"
            required
            aria-label="Custom unit"
          />
        )}
      </div>
    </Field>
  );
}


/**
 * What each movement section shows.
 *
 * The three types record genuinely different things, so a single combined
 * table had to leave most cells as an em dash: a correction has no branch or
 * purchase order, and consumption has no unit cost of its own. Splitting the
 * history lets each section carry only the columns its rows actually fill.
 */
const HISTORY_SECTIONS = [
  { key: "IN", label: "Stock In", accent: "#166534", empty: "No stock has been received yet." },
  { key: "OUT", label: "Stock Out", accent: "#b91c1c", empty: "No stock has been used yet." },
  { key: "CORRECTION", label: "Correction", accent: "#7c3aed", empty: "No corrections have been recorded." },
];

const peso = (value) => `₱${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX_DISPLAY_STOCK = 10000000;
const formatCurrency = (value) => {
  const numericValue = parseFloat(value) || 0;
  const safeValue = Math.min(Math.max(numericValue, 0), 999999999);
  return `₱${safeValue.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatDisplayQuantity = (value, maximum = MAX_DISPLAY_STOCK) => {
  const numericValue = parseFloat(value);
  const safeValue = Number.isFinite(numericValue) ? Math.min(Math.max(numericValue, 0), maximum) : 0;
  return safeValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const compactNumber = (value) => {
  const numericValue = Number(value) || 0;
  if (!Number.isFinite(numericValue)) return "0";

  if (Math.abs(numericValue) >= 1000000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(numericValue);
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numericValue);
};

const compactCurrency = (value) => {
  const numericValue = Number(value) || 0;
  if (!Number.isFinite(numericValue)) return "₱0";
  return peso(numericValue);
};

const historyCellStyle = {
  display: "block",
  minWidth: 0,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const itemCell = (movement) => (
  <div style={{ minWidth: 0, maxWidth: "100%" }}>
    <div style={{ ...historyCellStyle, fontWeight: 700, color: "#111827" }} title={movement.itemName}>{movement.itemName}</div>
    {movement.itemUnit && <div style={{ ...historyCellStyle, fontSize: "0.76rem", color: "#6b7280" }} title={`Unit: ${movement.itemUnit}`}>Unit: {movement.itemUnit}</div>}
  </div>
);

const HISTORY_COLUMNS = {
  IN: {
    template: "110px 1.15fr 1.1fr 100px 110px 130px 1.1fr minmax(190px, 1.35fr) 1fr",
    minWidth: "1200px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#374151" }}>{new Date(m.movementDate).toLocaleDateString()}</span> },
      { label: "Item Name", render: itemCell },
      { label: "Supplier", render: (m) => <span title={m.supplier || "—"} style={{ ...historyCellStyle, color: "#475569" }}>{m.supplier || "—"}</span> },
      { label: "Qty In", render: (m) => <span title={`+${Math.abs(m.quantityDelta)}`} style={{ ...historyCellStyle, fontWeight: 600, color: "#047857" }}>+{compactNumber(Math.abs(m.quantityDelta))}</span> },
      { label: "Unit Cost", render: (m) => <span title={peso(m.unitCost)} style={{ ...historyCellStyle, color: "#475569" }}>{compactCurrency(m.unitCost)}</span> },
      { label: "Total Spent", render: (m) => <span title={peso(m.totalCost)} style={{ ...historyCellStyle, fontWeight: 700, color: "#047857" }}>{compactCurrency(m.totalCost)}</span> },
      { label: "PO / Reference", render: (m) => <span title={m.reference || "—"} style={{ ...historyCellStyle, color: "#1e293b", fontWeight: 600 }}>{m.reference || "—"}</span> },
      { label: "Branch / Origin", render: (m) => <span title={m.intakeBranchOrStation || "—"} style={{ ...historyCellStyle, whiteSpace: "normal", overflow: "visible", color: "#475569" }}>{m.intakeBranchOrStation || "—"}</span> },
      { label: "Recorded By", render: (m) => <span title={m.actor || "—"} style={{ ...historyCellStyle, color: "#64748b" }}>{m.actor || "—"}</span> },
    ],
  },
  OUT: {
    template: "110px 1.4fr 110px 130px 1.3fr 1fr",
    minWidth: "820px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#374151" }}>{new Date(m.movementDate).toLocaleDateString()}</span> },
      { label: "Item Name", render: itemCell },
      { label: "Qty Out", render: (m) => <span title={`-${Math.abs(m.quantityDelta)}`} style={{ ...historyCellStyle, fontWeight: 600, color: "#be123c" }}>-{compactNumber(Math.abs(m.quantityDelta))}</span> },
      // Derived from the item's current cost, not a figure recorded on the row,
      // so it is labelled as an estimate rather than presented as spend.
      { label: "Est. Value", render: (m) => <span title={peso(m.totalCost)} style={{ ...historyCellStyle, color: "#475569" }}>{compactCurrency(m.totalCost)}</span> },
      {
        label: "Used On",
        render: (m) => (
          <span title={m.appointmentId ? `Appointment ${String(m.appointmentId).slice(0, 8).toUpperCase()}` : (m.reference || "—")} style={{ ...historyCellStyle, color: "#1e293b", fontWeight: 600 }}>
            {m.appointmentId ? `Appointment ${String(m.appointmentId).slice(0, 8).toUpperCase()}` : (m.reference || "—")}
          </span>
        ),
      },
      { label: "Recorded By", render: (m) => <span title={m.actor || "—"} style={{ ...historyCellStyle, color: "#64748b" }}>{m.actor || "—"}</span> },
    ],
  },
  CORRECTION: {
    template: "110px 1.4fr 120px 1.6fr 1fr",
    minWidth: "760px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#374151" }}>{new Date(m.movementDate).toLocaleDateString()}</span> },
      { label: "Item Name", render: itemCell },
      {
        label: "Adjustment",
        render: (m) => (
          <span title={`${m.quantityDelta > 0 ? "+" : ""}${m.quantityDelta}`} style={{ ...historyCellStyle, fontWeight: 700, color: m.quantityDelta < 0 ? "#b91c1c" : "#166534" }}>
            {m.quantityDelta > 0 ? "+" : ""}{compactNumber(m.quantityDelta)}
          </span>
        ),
      },
      { label: "Reason", render: (m) => <span title={m.reference || "—"} style={{ ...historyCellStyle, color: "#1e293b", fontWeight: 600 }}>{m.reference || "—"}</span> },
      { label: "Recorded By", render: (m) => <span title={m.actor || "—"} style={{ ...historyCellStyle, color: "#64748b" }}>{m.actor || "—"}</span> },
    ],
  },
};

function InventoryPage() {
  const { can } = useAuth();

  const {
    inventory,
    addItem: onAddItem,
    restoreDemoInventory,
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
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [correctionItem, setCorrectionItem] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionMenuItemId, setActionMenuItemId] = useState(null);
  const [actionMenuDirection, setActionMenuDirection] = useState({});
  const [form, setForm] = useState(CREATE_FORM_DEFAULTS);
  const actionMenuRef = useRef(null);

  const supplierOptions = useMemo(() => {
    const suppliers = new Set(inventory.map((item) => item.supplier).filter(Boolean));
    return Array.from(suppliers).sort((a, b) => a.localeCompare(b));
  }, [inventory]);

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
  // History is split by movement type, so the old "Movement Type" filter became
  // the section itself. Each section shows only the columns its type records.
  const [historySection, setHistorySection] = useState("IN"); // "IN" | "OUT" | "CORRECTION"
  const [historyBranchFilter, setHistoryBranchFilter] = useState("ALL");
  const [historyDateFilter, setHistoryDateFilter] = useState("ALL");
  const [historySort, setHistorySort] = useState("DATE_DESC");

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

  const activeHistorySection = HISTORY_SECTIONS.find((section) => section.key === historySection) || HISTORY_SECTIONS[0];
  const activeHistoryColumns = HISTORY_COLUMNS[historySection] || HISTORY_COLUMNS.IN;

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

    result = result.filter((m) => (m.movementType || "IN") === historySection);

    if (historySection === "IN" && historyBranchFilter !== "ALL") {
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
  }, [movements, historySearch, historyItemFilter, historySection, historyBranchFilter, historyDateFilter, historySort]);

  useEffect(() => {
    if (tab === "history") refreshMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (selectedItem) refreshMovements();
  }, [selectedItem, refreshMovements]);

  const selectedItemIntakes = useMemo(
    () => movements
      .filter((movement) => movement.itemId === selectedItem?.id && (movement.movementType || "IN") === "IN")
      .slice(0, 5),
    [movements, selectedItem]
  );

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

  const handleBatchStockIn = async ({ receiptNumber, supplier, intakeBranchOrStation, date, lineItems }) => {
    const reference = receiptNumber.trim();
    const results = [];

    for (const lineItem of lineItems) {
      const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"}`.replace(/[xy]/g, (character) => {
            const randomValue = Math.random() * 16 | 0;
            const value = character === "x" ? randomValue : (randomValue & 0x3 | 0x8);
            return value.toString(16);
          });
      const result = await stockIn(lineItem.itemId, {
        amount: Number(lineItem.quantity),
        unitCost: Number(lineItem.unitCost),
        supplier,
        expiryDate: lineItem.expiryDate || null,
        date,
        reference,
        intakeBranchOrStation,
        idempotencyKey,
      });
      if (result !== true) {
        showError(typeof result === "string" ? result : "Could not complete the batch Stock In.");
        return false;
      }
      results.push(lineItem);
    }

    showSuccess(`Received ${results.length} inventory item${results.length === 1 ? "" : "s"} in batch.`);
    setIsBatchModalOpen(false);
    return true;
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setIsBatchModalOpen(true)}
              style={{
                background: "#ffffff",
                color: "#334155",
                border: "1px solid #cbd5e1",
                borderRadius: "10px",
                padding: "0.78rem 1.15rem",
                fontSize: "0.85rem",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
              }}
            >
              Stock In (Batch)
            </button>
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
          </div>
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
                    <Field label="Hazard Note">
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
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 35%) minmax(100px, 15%) minmax(120px, 20%) minmax(100px, 15%) minmax(120px, 15%)", gap: "0.75rem", padding: "0.9rem 1.5rem", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", minWidth: "200px" }}>Item Details</span>
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
                <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
                  <button type="button" onClick={async () => {
                    const result = await restoreDemoInventory();
                    if (result !== true) showError(typeof result === "string" ? result : "Could not restore inventory items.");
                    else showSuccess("Inventory items restored.");
                  }} style={{ background: "#7f1d1d", color: "#ffffff", border: "none", borderRadius: "8px", padding: "0.65rem 0.9rem", fontWeight: 700, cursor: "pointer" }}>
                    Restore inventory items
                  </button>
                  <button type="button" onClick={() => setOpenForm(true)} style={{ background: "#b91c1c", color: "#ffffff", border: "none", borderRadius: "8px", padding: "0.65rem 0.9rem", fontWeight: 700, cursor: "pointer" }}>
                    Add inventory item
                  </button>
                </div>
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
              const stockValue = formatInventoryQuantity(Number(item.quantity || 0));
              const stockText = `${stockValue} ${item.unit || ""}`.trim();
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
                    gridTemplateColumns: "minmax(0, 35%) minmax(100px, 15%) minmax(120px, 20%) minmax(100px, 15%) minmax(120px, 15%)",
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
                  <div style={{ minWidth: 0, maxWidth: "100%" }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.96rem", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.name}>{item.name}</div>
                    <div style={{ marginTop: "0.2rem", fontSize: "0.72rem", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.supplier || item.storageLocation || "Inventory item"}>
                      {item.supplier || item.storageLocation || "Inventory item"}
                    </div>
                  </div>

                  <div style={{ color: "#475569", fontSize: "0.9rem" }}>{typeLabel}</div>

                  <div style={{ color: isLowStock ? "#b91c1c" : "#0f172a", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }} title={`${item.quantity || 0}${item.unit || ""}`}>
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

              {historySection === "IN" && <Field label="Branch / Station">
                <select value={historyBranchFilter} onChange={(e) => setHistoryBranchFilter(e.target.value)} style={inputStyle}>
                  <option value="ALL">All Stations / Branches</option>
                  {HISTORY_BRANCH_OPTIONS.slice(1).map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </Field>}

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

          {/* Section tabs — one per movement type */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {HISTORY_SECTIONS.map((section) => {
              const active = historySection === section.key;
              const count = movements.filter((m) => (m.movementType || "IN") === section.key).length;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setHistorySection(section.key)}
                  aria-pressed={active}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.6rem 1rem",
                    borderRadius: "999px",
                    border: `1px solid ${active ? section.accent : "rgba(148, 163, 184, 0.35)"}`,
                    background: active ? section.accent : "#ffffff",
                    color: active ? "#ffffff" : "#475569",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  {section.label}
                  <span style={{
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    borderRadius: "999px",
                    padding: "0.1rem 0.45rem",
                    background: active ? "rgba(255,255,255,0.22)" : "#f1f5f9",
                    color: active ? "#ffffff" : "#64748b",
                  }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Records Table */}
          <div style={{ background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "18px", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.03)", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: activeHistoryColumns.template,
                  minWidth: activeHistoryColumns.minWidth,
                  gap: "0.75rem",
                  padding: "1rem 1.25rem",
                  background: "#f8fafc",
                  fontWeight: 700,
                  color: "#64748b",
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  minWidth: 0,
                }}
              >
                {activeHistoryColumns.columns.map((column) => <span key={column.label} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>{column.label}</span>)}
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
                  {activeHistorySection.empty}
                </div>
              )}

              {filteredAndSortedMovements.map((movement) => (
                <div
                  key={movement.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: activeHistoryColumns.template,
                    minWidth: activeHistoryColumns.minWidth,
                    gap: "0.75rem",
                    padding: "0.95rem 1.25rem",
                    borderTop: "1px solid #f1f5f9",
                    alignItems: "center",
                    fontSize: "0.9rem",
                    minWidth: 0,
                  }}
                >
                  {activeHistoryColumns.columns.map((column) => (
                    <div key={column.label} style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>{column.render(movement)}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedItem && <InventoryDetailModal item={selectedItem} intakes={selectedItemIntakes} onClose={() => setSelectedItem(null)} />}

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
          suppliers={supplierOptions}
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

      {isBatchModalOpen && (
        <BatchStockInModal
          items={inventory.filter((item) => item.status !== INVENTORY_STATUS.DISABLED)}
          suppliers={supplierOptions}
          onClose={() => setIsBatchModalOpen(false)}
          onSubmit={handleBatchStockIn}
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
    intakeBranchOrStation: item.intakeBranchOrStation || DEFAULT_BRANCH,
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
    if (!values.name.trim() || !values.unit.trim() || values.cost === "" || !values.intakeBranchOrStation) return;
    if (values.lastMaintenanceDate && values.nextMaintenanceDate && values.nextMaintenanceDate <= values.lastMaintenanceDate) {
      setValidationError("Next maintenance must be after the last maintenance date.");
      return;
    }
    setSaving(true);
    await onSave({ ...values, name: values.name.trim(), unit: values.unit.trim(), intakeBranchOrStation: values.intakeBranchOrStation });
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
              <option value="MATERIAL">Material / PPE</option>
            </select>
          </Field>
          <UnitField value={values.unit} inlineCustom onChange={(unit) => setValues((previous) => ({ ...previous, unit }))} />
          <Field label="Cost per Unit (₱) *">
            <input name="cost" type="number" min="0" step="0.01" value={values.cost} onChange={handleChange} style={inputStyle} required />
          </Field>
          <Field label="Default / Preferred Supplier (Optional)">
            <input name="supplier" value={values.supplier} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Branch *">
            <select name="intakeBranchOrStation" value={values.intakeBranchOrStation} onChange={handleChange} style={inputStyle} required>
              {BRANCH_OPTIONS.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
          </Field>
          <Field label="Storage Rack / Shelf (Optional)">
            <input name="storageLocation" value={values.storageLocation} onChange={handleChange} style={inputStyle} placeholder="e.g. Closet A, Shelf 2" />
          </Field>
                        <option value="MATERIAL">Material / PPE</option>
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
              <Field label="Hazard Note"><input name="hazardRating" value={values.hazardRating} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Standard Rate"><input name="standardRate" type="number" step="any" min="0" value={values.standardRate} onChange={handleChange} style={inputStyle} placeholder="10" /></Field>
              <Field label="Rate Unit"><input name="rateUnit" value={values.rateUnit} onChange={handleChange} style={inputStyle} placeholder="mL per 1 L water" /></Field>
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

function BatchStockInModal({ items, suppliers, onClose, onSubmit }) {
  const [receiptNumber, setReceiptNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [intakeBranchOrStation, setIntakeBranchOrStation] = useState(DEFAULT_BRANCH);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState([{ itemId: "", quantity: "", unitCost: "", expiryDate: "" }]);
  const [saving, setSaving] = useState(false);

  const updateLineItem = (index, field, value) => {
    setLineItems((previous) => previous.map((lineItem, lineIndex) => (
      lineIndex === index ? { ...lineItem, [field]: value } : lineItem
    )));
  };

  const handleAddRow = () => {
    setLineItems((previous) => [...previous, { itemId: "", quantity: "", unitCost: "", expiryDate: "" }]);
  };

  const handleRemoveRow = (index) => {
    setLineItems((previous) => previous.length === 1 ? previous : previous.filter((_, lineIndex) => lineIndex !== index));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!date || !supplier || !intakeBranchOrStation) return;
    if (lineItems.some((lineItem) => lineItem.expiryDate && lineItem.expiryDate < TODAY())) return;
    if (lineItems.some((lineItem) => !lineItem.itemId || !Number.isInteger(Number(lineItem.quantity)) || Number(lineItem.quantity) <= 0 || lineItem.unitCost === "" || Number(lineItem.unitCost) < 0)) return;

    setSaving(true);
    await onSubmit({ receiptNumber, supplier, intakeBranchOrStation: intakeBranchOrStation.trim(), date, lineItems });
    setSaving(false);
  };

  const totalShipmentCost = lineItems.reduce((total, lineItem) => total + (Number(lineItem.quantity) || 0) * (Number(lineItem.unitCost) || 0), 0);

  return (
    <ModalShell onClose={onClose} title="Stock In (Batch)" subtitle="Receive multiple inventory items from one delivery transaction." maxWidth="64rem">
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.35rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem" }}>
          <Field label="Date Received *">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={inputStyle} required autoFocus />
          </Field>
          <Field label="PO / Invoice / DR # (Optional)">
            <input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} style={inputStyle} placeholder="e.g. PO-1001, INV-8492" />
          </Field>
          <Field label="Supplier *">
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)} style={inputStyle} required>
              <option value="">Select supplier</option>
              {suppliers.map((supplierName) => <option key={supplierName} value={supplierName}>{supplierName}</option>)}
            </select>
          </Field>
          <Field label="Receiving Branch *">
            <select value={intakeBranchOrStation} onChange={(event) => setIntakeBranchOrStation(event.target.value)} style={inputStyle} required>
              {BRANCH_OPTIONS.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1.5fr) minmax(110px, 0.8fr) minmax(120px, 0.85fr) minmax(130px, 0.95fr) minmax(110px, 0.8fr) 2.5rem", gap: "0.65rem", padding: "0.75rem 1rem", background: "#f8fafc", color: "#475569", fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <span>Item / Chemical</span><span>Quantity</span><span>Unit Cost (₱)</span><span>Expiry Date</span><span style={{ textAlign: "right" }}>Row Total</span>
            <span aria-hidden="true" />
          </div>
          <div style={{ display: "grid", gap: "0.65rem", padding: "0.75rem 1rem" }}>
            {lineItems.map((lineItem, index) => (
              <div key={`batch-line-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1.5fr) minmax(110px, 0.8fr) minmax(120px, 0.85fr) minmax(130px, 0.95fr) minmax(110px, 0.8fr) 2.5rem", gap: "0.65rem", alignItems: "center" }}>
                <select
                  value={lineItem.itemId}
                  onChange={(event) => {
                    const selectedItem = items.find((item) => item.id === event.target.value);
                    setLineItems((previous) => previous.map((currentLineItem, lineIndex) => (
                      lineIndex === index
                        ? { ...currentLineItem, itemId: event.target.value, unitCost: selectedItem?.cost ?? "" }
                        : currentLineItem
                    )));
                  }}
                  style={inputStyle}
                  required
                  aria-label={`Item or chemical ${index + 1}`}
                >
                  <option value="">Select item</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
                </select>
                <div style={{ position: "relative" }}>
                  <input type="number" min="1" step="1" value={lineItem.quantity} onChange={(event) => updateLineItem(index, "quantity", event.target.value)} style={{ ...inputStyle, paddingRight: "2.8rem" }} placeholder="0" required aria-label={`Quantity ${index + 1}`} />
                  <span style={{ position: "absolute", top: "50%", right: "0.65rem", transform: "translateY(-50%)", color: "#64748b", fontSize: "0.75rem", fontWeight: 700 }}>{items.find((item) => item.id === lineItem.itemId)?.unit || "—"}</span>
                </div>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: "0.8rem", fontWeight: 700 }}>₱</span>
                  <input type="number" min="0" step="0.01" value={lineItem.unitCost} onChange={(event) => updateLineItem(index, "unitCost", event.target.value)} style={{ ...inputStyle, paddingLeft: "1.5rem" }} placeholder="0.00" required aria-label={`Unit cost ${index + 1}`} />
                </div>
                <input type="date" value={lineItem.expiryDate} min={TODAY()} onChange={(event) => updateLineItem(index, "expiryDate", event.target.value)} style={inputStyle} aria-label={`Expiry date ${index + 1}`} />
                <span style={{ color: "#0f172a", fontSize: "0.85rem", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>₱{((Number(lineItem.quantity) || 0) * (Number(lineItem.unitCost) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <button type="button" onClick={() => handleRemoveRow(index)} disabled={lineItems.length === 1} aria-label={`Remove line item ${index + 1}`} title="Remove item" style={{ display: "grid", placeItems: "center", width: "2.25rem", height: "2.25rem", border: "none", background: "transparent", color: lineItems.length === 1 ? "#cbd5e1" : "#94a3b8", cursor: lineItems.length === 1 ? "not-allowed" : "pointer", padding: 0 }}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
            <button type="button" onClick={handleAddRow} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", width: "fit-content", border: "none", background: "transparent", color: "#2563eb", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer", padding: "0.35rem 0" }}>
              <Plus size={15} /> Add another item
            </button>
          </div>
        </div>

        <div style={{ marginTop: "-0.35rem", padding: "0.875rem", borderRadius: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#64748b", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Shipment Value</span>
          <span style={{ color: "#0f172a", fontSize: "1.125rem", fontWeight: 800 }}>₱{totalShipmentCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", paddingTop: "1rem", borderTop: "1px solid #f1f5f9" }}>
          <button type="button" onClick={onClose} style={{ ...secondaryButton, borderRadius: "12px", padding: "0.625rem 1rem", borderColor: "#cbd5e1", fontSize: "0.875rem" }}>Cancel</button>
          <button
            type="submit"
            disabled={saving}
            style={{
              border: "none",
              background: "#7A1518",
              color: "#ffffff",
              fontWeight: 600,
              borderRadius: "12px",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.7 : 1,
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
            }}
          >
            {saving ? "Receiving…" : "Confirm Stock-In"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function StockInModal({ item, suppliers, onClose, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [unitCost, setUnitCost] = useState(item.cost !== undefined && item.cost !== null ? item.cost : "");
  const [supplier, setSupplier] = useState(item.supplier || "");
  const [expiryDate, setExpiryDate] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [intakeBranchOrStation, setIntakeBranchOrStation] = useState(
    BRANCH_OPTIONS.includes(item.intakeBranchOrStation) ? item.intakeBranchOrStation : DEFAULT_BRANCH
  );
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
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0 || !date || (expiryDate && expiryDate < TODAY())) return;
    if (!intakeBranchOrStation) return;
    setSaving(true);
    await onSubmit({
      amount: parsedAmount,
      unitCost: Number(unitCost) || 0,
      supplier,
      expiryDate,
      date,
      reference: reference.trim(),
      intakeBranchOrStation,
      idempotencyKey,
    });
    setSaving(false);
  };

  const currentStock = Number(item.quantity) || 0;
  const primaryStockInButtonStyle = {
    border: "none",
    background: "#7A1518",
    color: "#ffffff",
    fontWeight: 600,
    borderRadius: "12px",
    padding: "0.625rem 1.25rem",
    fontSize: "0.875rem",
    cursor: saving ? "default" : "pointer",
    opacity: saving ? 0.7 : 1,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  };

  return (
    <ModalShell onClose={onClose} title="Stock In" subtitle={`Item: ${item.name} • Current Stock: ${currentStock.toLocaleString()} ${item.unit}`}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <Field label="Unit Cost (₱) *" hint="Cost per unit for this delivery batch">
            <input
              type="number"
              min="0"
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              style={inputStyle}
              placeholder="0.00"
              required
              autoFocus
            />
          </Field>

          <Field label={`Quantity (${item.unit}) *`}>
            <input
              type="number"
              min="1"
              max="99999999"
              step="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={inputStyle}
              placeholder="0"
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

          <Field label="Date Received *">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} required />
          </Field>
          <Field label="Expiry Date (Optional)">
            <input type="date" value={expiryDate} min={TODAY()} onChange={(e) => setExpiryDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="PO / Invoice / DR # (Optional)" hint="Enter a purchase order, invoice, or delivery receipt number if available">
            <input value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} placeholder="e.g. PO-1001, INV-8492" />
          </Field>
          <Field label="Receiving Branch *" hint="Branch where the stock was received">
            <select value={intakeBranchOrStation} onChange={(e) => setIntakeBranchOrStation(e.target.value)} style={inputStyle} required>
              {BRANCH_OPTIONS.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
          </Field>
          <Field label="Supplier *">
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={inputStyle} required>
              <option value="">Select supplier</option>
              {suppliers.map((supplierName) => <option key={supplierName} value={supplierName}>{supplierName}</option>)}
            </select>
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
          <button type="submit" disabled={saving} style={primaryStockInButtonStyle}>
            {saving ? "Recording…" : "Confirm Stock-In"}
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

function InventoryDetailModal({ item, intakes, onClose }) {
  const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";
  const safeTotal = Math.min(
    (Number(item.quantity) || 0) * (Number(item.costPerUnit || item.cost_per_unit || item.cost) || 0),
    999999999
  );

  return (
    <ModalShell onClose={onClose} title={item.name} maxWidth="42rem">
      {/* Basic Information */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
          Basic Information
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "2rem", rowGap: "1rem" }}>
          <DetailRow label="Type" value={typeLabel} />
          <DetailRow label="Status" value={item.status === "DISABLED" ? "Disabled" : "Active"} />
          <DetailRow label="Quantity" value={`${formatDisplayQuantity(item.quantity)} ${item.unit}`} />
          {item.cost !== undefined && item.cost !== null ? <DetailRow label="Cost per Unit" value={formatCurrency(item.cost)} /> : null}
          {item.cost !== undefined && item.cost !== null && item.quantity ? <DetailRow label="Total Value" value={formatCurrency(safeTotal)} /> : null}
          {item.supplier && <DetailRow label="Latest Supplier" value={item.supplier} />}
          <DetailRow label="Reorder Level" value={item.reorderLevel ?? "—"} />
          <DetailRow label="Branch" value={<span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{item.intakeBranchOrStation || DEFAULT_BRANCH}</span>} />
        </div>
      </div>

      {/* Chemical-Specific Details */}
      {item.type === "CHEMICAL" && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Chemical Details
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "1.5rem", rowGap: "0.75rem" }}>
            <DetailRow label="Chemical Type" value={item.chemicalType} />
            {item.expirationDate && <DetailRow label="Nearest Expiry Date" value={new Date(item.expirationDate).toLocaleDateString()} />}
            {item.safetyLevel && (
              <DetailRow
                label="Safety Level"
                value={<span style={{ display: "inline-flex", alignItems: "center", padding: "0.125rem 0.5rem", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600, background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3" }}>{item.safetyLevel}</span>}
              />
            )}
              {item.hazardRating && <DetailRow label="Hazard Note" value={item.hazardRating} />}
            {item.standardRate !== "" && item.standardRate !== null && <DetailRow label="Standard Rate" value={`${item.standardRate} ${item.rateUnit || ""}`.trim()} />}
            {item.dateReceived && <DetailRow label="Last Restocked" value={new Date(item.dateReceived).toLocaleDateString()} />}
          </div>
        </div>
      )}

      {intakes.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Recent Intakes
          </h3>
          <div style={{ width: "100%", border: "1px solid rgba(226, 232, 240, 0.8)", borderRadius: "12px", overflow: "hidden", fontSize: "0.75rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.4fr 0.85fr 1fr", gap: "0.75rem", padding: "0.65rem 0.75rem", background: "#f8fafc", color: "#64748b", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <span>Date</span><span>Supplier</span><span style={{ textAlign: "right" }}>Qty Added</span><span style={{ textAlign: "right" }}>Unit Cost</span>
            </div>
            {intakes.map((intake) => (
              <div key={intake.id} style={{ display: "grid", gridTemplateColumns: "0.9fr 1.4fr 0.85fr 1fr", gap: "0.75rem", padding: "0.7rem 0.75rem", borderTop: "1px solid #f1f5f9", color: "#334155", alignItems: "center" }}>
                <span>{intake.movementDate ? new Date(intake.movementDate).toLocaleDateString() : "—"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={intake.supplier || "—"}>{intake.supplier || "—"}</span>
                <span style={{ textAlign: "right" }}>{formatDisplayQuantity(intake.amount, 999999)} {intake.itemUnit || item.unit}</span>
                <span style={{ textAlign: "right" }}>{formatCurrency(intake.unitCost)}</span>
              </div>
            ))}
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
    <div style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
        {label}
      </div>
      <div style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word", fontSize: "0.95rem", color: "#111827", fontWeight: 600 }}>
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
