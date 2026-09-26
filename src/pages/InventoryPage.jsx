// Item Profile no longer sets Quantity — new items start at 0 stock, and
// quantity only ever moves through a logged movement: Stock In (a whole
// delivery at once, see InventoryContext.stockInMany), Stock Out (to a
// technician, or written off as missing or damaged — stockOutManual), the
// appointment stock-out in Scheduling, and a counted correction. That's why
// there's a "History" tab alongside the item list: it's the same page, not a
// separate route.
//
// Item profiles are fully editable, except Quantity, so a stock level can
// never exist without a movement row that explains it.
//
// Splitting this into components/inventory/* is still deferred (see the
// original note this replaced) — the file's just bigger now.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FlaskConical, MoreHorizontal, Package, PackagePlus, Plus, Search, Wrench } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import useInventory from "../hooks/useInventory";
import useNow from "../hooks/useNow";
import Button from "../components/ui/Button";
import SegmentedControl from "../components/ui/SegmentedControl";
import StatusPill from "../components/ui/StatusPill";
import { SUBSYSTEMS } from "../utils/permissions";
import { inventoryAlerts, isBelowReorder, isExpiringSoon, isMaintenanceOverdue, itemValue, sortByUrgency, watchFor } from "../utils/inventoryWatch";
import useUsers from "../hooks/useUsers";
import { useScheduling } from "../context/SchedulingContext";
import { useToast } from "../context/ToastContext";
import { appointmentReference } from "../utils/scheduling";
import { INVENTORY_STATUS } from "../services/inventoryService";
import { ACCOUNT_STATUS, LIMITS, RETURN_REASONS, RETURN_REASON_LABELS, STOCK_OUT_REASONS, STOCK_OUT_REASON_LABELS } from "../utils/constants";
import { checkoutOf, heldByItem, openCheckouts } from "../utils/custody";
import { usableBatches } from "../utils/batches";
import BatchSelect from "../components/inventory/BatchSelect";
import BatchList from "../components/inventory/BatchList";
import { crewOf } from "../utils/scheduling";
import { todayISO, validateMoney, validateMovementDate, validateQuantity } from "../utils/validators";
import { LOSS_REASONS, REASON_FILTERS, countByReason, describeLosses, filterByReason, reasonOf, recentLossesByItem, summarizeLosses } from "../utils/stockMovements";
import {
  conversionFactor,
  convertAmount,
  convertibleUnits,
  describeConversion,
  normalizeUnit,
  UNIT_LABELS,
} from "../utils/units";
import { card, colors, primaryButton, secondaryButton } from "../styles/theme";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { formatDate, formatPeso } from "../utils/formatters";
import { isPlausibleItem, isPlausibleMovement } from "../utils/dashboardMetrics";

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


/**
 * What each movement section shows.
 *
 * The three types record genuinely different things, so a single combined
 * table had to leave most cells as an em dash: a correction has no branch or
 * purchase order, and consumption has no unit cost of its own. Splitting the
 * history lets each section carry only the columns its rows actually fill.
 */
const HISTORY_SECTIONS = [
  { key: "IN", label: "Stock In", accent: "#4a6b4a", empty: "No stock has been received yet." },
  { key: "OUT", label: "Stock Out", accent: "#9a2d24", empty: "No stock has been used yet." },
  { key: "RETURN", label: "Returns", accent: "#334e7a", empty: "No checked-out stock has been returned." },
  { key: "CORRECTION", label: "Correction", accent: "#7c3aed", empty: "No corrections have been recorded." },
];

const shortDay = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }) : "");

const peso = (value) => formatPeso(value);

// A movement from before the limits with a figure the system could not accept
// today (migration 058) shows no cost rather than an impossible one.
const movementPeso = (movement, value) => (isPlausibleMovement(movement) ? peso(value) : "—");

// Missing and damaged are the reasons someone has to chase, so they are the
// two that carry colour; routine reasons stay quiet.
const REASON_TONES = {
  MISSING: { background: "#faf0e2", border: "1px solid #fed7aa", color: "#b45309" },
  DAMAGED: { background: "#f9ecea", border: "1px solid #f5c2bd", color: "#9a2d24" },
  TECHNICIAN_CHECKOUT: { background: "#eef2f8", border: "1px solid #c7d4e8", color: "#334e7a" },
  EXPIRED: { background: "#f9ecea", border: "1px solid #f5c2bd", color: "#7f1d1d" },
  APPOINTMENT: { background: "#f4f1ec", border: "1px solid #efe9e0", color: "#50463c" },
};

function ReasonBadge({ reason }) {
  if (!reason) return <span style={{ color: "#96897b" }}>—</span>;
  return (
    <span
      data-reason={reason}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        borderRadius: "999px",
        padding: "0.22rem 0.6rem",
        fontSize: "0.74rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...(REASON_TONES[reason] || REASON_TONES.APPOINTMENT),
      }}
    >
      {LOSS_REASONS.includes(reason) && <AlertTriangle size={12} aria-hidden="true" />}
      {STOCK_OUT_REASON_LABELS[reason] || reason}
    </span>
  );
}

// The chemical batch a movement moved (migration 055): its lot (or system
// reference) and expiry, read from the batch so a corrected lot shows, else
// the lot recorded on the row.
const batchCell = (m, context = {}) => {
  const batch = m.batchId ? context.batchById?.(m.batchId) : null;
  if (!batch && !m.batchNumber) return <span style={{ color: "#96897b" }}>—</span>;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "#211b15", fontWeight: 500, overflowWrap: "anywhere" }}>{batch ? batch.lotNumber || "No lot" : m.batchNumber}</div>
      {batch && (
        <div style={{ color: "#96897b", fontSize: "0.74rem" }}>
          {batch.reference}{batch.expirationDate ? ` · exp ${formatDate(batch.expirationDate)}` : ""}
        </div>
      )}
    </div>
  );
};

const itemCell = (movement) => (
  <div>
    <div style={{ fontWeight: 500, color: "#211b15" }}>{movement.itemName}</div>
    {movement.itemUnit && <div style={{ fontSize: "0.76rem", color: "#96897b" }}>Unit: {movement.itemUnit}</div>}
  </div>
);

const HISTORY_COLUMNS = {
  IN: {
    template: "110px 1.2fr 1fr 110px 120px 110px 130px 1.1fr 1.1fr 1fr",
    minWidth: "1240px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#50463c" }}>{formatDate(m.movementDate)}</span> },
      { label: "Item Name", render: itemCell },
      { label: "Batch", render: batchCell },
      { label: "Qty In", render: (m) => <span style={{ fontWeight: 500, color: "#4a6b4a" }}>+{Math.abs(m.quantityDelta)}</span> },
      // What the delivery note said, when it was not the tracking unit. Keeping
      // both figures is what makes a converted intake auditable against the note.
      {
        label: "Received As",
        render: (m) => (
          <span style={{ color: "#50463c" }}>
            {m.enteredAmount !== null && m.enteredUnit ? `${m.enteredAmount} ${m.enteredUnit}` : "—"}
          </span>
        ),
      },
      { label: "Unit Cost", render: (m) => <span style={{ color: "#50463c" }}>{movementPeso(m, m.unitCost)}</span> },
      { label: "Total Spent", render: (m) => <span style={{ fontWeight: 500, color: "#4a6b4a" }}>{movementPeso(m, m.totalCost)}</span> },
      { label: "PO / Reference", render: (m) => <span style={{ color: "#1e293b", fontWeight: 500 }}>{m.reference || "—"}</span> },
      { label: "Branch / Origin", render: (m) => <span style={{ color: "#50463c" }}>{m.intakeBranchOrStation || "—"}</span> },
      { label: "Recorded By", render: (m) => <span style={{ color: "#96897b" }}>{m.actor || "—"}</span> },
    ],
  },
  OUT: {
    template: "110px 1.4fr 110px 1fr 130px 1.2fr 1.3fr 1fr",
    minWidth: "1100px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#50463c" }}>{formatDate(m.movementDate)}</span> },
      { label: "Item Name", render: itemCell },
      // The amount, not quantity_delta: materials drawn from a checkout move
      // nothing on the shelf (delta 0) but were still used (migration 054).
      { label: "Qty Out", render: (m) => <span style={{ fontWeight: 500, color: "#9a2d24" }}>-{Math.abs(m.amount)}</span> },
      { label: "Batch", render: batchCell },
      // Derived from the item's current cost, not a figure recorded on the row,
      // so it is labelled as an estimate rather than presented as spend.
      { label: "Est. Value", render: (m) => <span style={{ color: "#50463c" }}>{movementPeso(m, m.totalCost)}</span> },
      // Reason and destination are two questions, so they are two columns:
      // "why did this leave" and "where did it go".
      { label: "Reason", render: (m) => <ReasonBadge reason={reasonOf(m)} /> },
      {
        label: "Used On / Issued To",
        render: (m, context = {}) => {
          const technician = m.technicianId ? context.technicianName?.(m.technicianId) : "";
          const visitLabel = (id) => (context.appointmentLabel ? context.appointmentLabel(id) : appointmentReference({ id }));
          // Which checkout a visit's materials came out of (migration 054).
          const source = context.checkoutOf?.(m);
          const sourceTechnician = source?.technicianId ? context.technicianName?.(source.technicianId) : "";
          return (
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#50463c" }}>
                {m.appointmentId
                  ? `Visit ${visitLabel(m.appointmentId)}`
                  : technician
                    ? `Checked out to ${technician}${m.forAppointmentId ? ` for ${visitLabel(m.forAppointmentId)}` : ""}`
                    : (m.reference || "—")}
              </div>
              {source && (
                <div style={{ color: "#334e7a", fontSize: "0.76rem", marginTop: "0.15rem" }}>
                  From {sourceTechnician ? `${sourceTechnician}'s` : "a"} checkout of {shortDay(source.movementDate)}, not the shelf
                </div>
              )}
              {m.note && <div style={{ color: "#96897b", fontSize: "0.76rem", marginTop: "0.15rem", overflowWrap: "anywhere" }}>{m.note}</div>}
            </div>
          );
        },
      },
      { label: "Recorded By", render: (m) => <span style={{ color: "#96897b" }}>{m.actor || "—"}</span> },
    ],
  },
  RETURN: {
    template: "110px 1.3fr 100px 1fr 170px 1.5fr 1fr",
    minWidth: "1020px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#50463c" }}>{formatDate(m.movementDate)}</span> },
      { label: "Item Name", render: itemCell },
      { label: "Qty Back", render: (m) => <span style={{ fontWeight: 500, color: "#4a6b4a" }}>+{Math.abs(m.amount)}</span> },
      { label: "Batch", render: batchCell },
      { label: "Reason", render: (m) => <span style={{ color: "#1e293b", fontWeight: 500 }}>{RETURN_REASON_LABELS[m.returnReason] || "—"}</span> },
      {
        label: "From / Visit",
        render: (m, context = {}) => {
          const technician = m.technicianId ? context.technicianName?.(m.technicianId) : "";
          const source = context.checkoutOf?.(m);
          return (
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#50463c" }}>
                {technician || "A technician"}{source ? `, checked out ${shortDay(source.movementDate)}` : ""}
              </div>
              {m.forAppointmentId && (
                <div style={{ color: "#96897b", fontSize: "0.76rem", marginTop: "0.15rem" }}>
                  Visit {context.appointmentLabel ? context.appointmentLabel(m.forAppointmentId) : appointmentReference({ id: m.forAppointmentId })}
                </div>
              )}
              {m.note && <div style={{ color: "#96897b", fontSize: "0.76rem", marginTop: "0.15rem", overflowWrap: "anywhere" }}>{m.note}</div>}
            </div>
          );
        },
      },
      { label: "Recorded By", render: (m) => <span style={{ color: "#96897b" }}>{m.actor || "—"}</span> },
    ],
  },
  CORRECTION: {
    template: "110px 1.4fr 120px 1.6fr 1fr",
    minWidth: "760px",
    columns: [
      { label: "Date", render: (m) => <span style={{ color: "#50463c" }}>{formatDate(m.movementDate)}</span> },
      { label: "Item Name", render: itemCell },
      {
        label: "Adjustment",
        render: (m) => (
          <span style={{ fontWeight: 500, color: m.quantityDelta < 0 ? "#9a2d24" : "#4a6b4a" }}>
            {m.quantityDelta > 0 ? "+" : ""}{m.quantityDelta}
          </span>
        ),
      },
      { label: "Reason", render: (m) => <span style={{ color: "#1e293b", fontWeight: 500 }}>{m.reference || "—"}</span> },
      { label: "Recorded By", render: (m) => <span style={{ color: "#96897b" }}>{m.actor || "—"}</span> },
    ],
  },
};

function InventoryPage() {
  const {
    inventory,
    addItem: onAddItem,
    updateItem,
    setItemStatus,
    stockInMany,
    stockOutManual,
    returnCheckout,
    stockCorrection,
    removeItem,
    loading,
    error,
    movements,
    movementsLoading,
    movementsError,
    refreshMovements,
    batches = [],
    writeOffBatch,
    updateBatch,
    splitBatch,
  } = useInventory();
  const { technicians } = useUsers();
  const { appointments } = useScheduling();
  const { showSuccess, showError } = useToast();

  const [tab, setTab] = useState("items"); // "items" | "custody" | "history"
  const { can } = useAuth();
  // Receiving and reordering stock is an inventory write: admins only, per
  // the permission matrix (staff and technicians read inventory).
  const canManageStock = can(SUBSYSTEMS.INVENTORY, "create");
  const now = useNow(60 * 60 * 1000);
  const [openForm, setOpenForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  // A Stock In is a delivery note, not an item: the modal opens for the whole
  // delivery and `stockInSeedItemId` only pre-fills its first line when the
  // user came in from a specific row.
  const [stockInOpen, setStockInOpen] = useState(false);
  const [stockInSeedItemId, setStockInSeedItemId] = useState("");
  const [stockOutItem, setStockOutItem] = useState(null);
  const [correctionItem, setCorrectionItem] = useState(null);
  // An open checkout being returned: { checkout, remaining }.
  const [returnTarget, setReturnTarget] = useState(null);
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
  // The top bar's search links an item here as ?q=<name>.
  const [searchParams] = useSearchParams();
  const [itemSearch, setItemSearch] = useState(() => searchParams.get("q") || "");
  useEffect(() => {
    const requested = searchParams.get("q");
    if (requested !== null) setItemSearch(requested);
  }, [searchParams]);
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
  // Stock Out only: which reason, and for checkouts which technician.
  const [historyReasonFilter, setHistoryReasonFilter] = useState("ALL");
  const [historyTechnicianFilter, setHistoryTechnicianFilter] = useState("ALL");

  const technicianName = useCallback(
    (id) => {
      const account = technicians.find((entry) => entry.id === id);
      return account ? account.name || account.username : "";
    },
    [technicians]
  );

  // "TPC-V-00042" for the Stock Out history's Used On column.
  const appointmentLabel = useCallback(
    (id) => appointmentReference(appointments.find((entry) => entry.id === id) || { id }),
    [appointments]
  );

  // Missing/damaged per item over the last 30 days, for the list badge.
  const recentLosses = useMemo(() => recentLossesByItem(movements), [movements]);

  // Stock technicians have checked out and not yet used or returned (migration 054).
  const outWithTechnicians = useMemo(() => openCheckouts(movements), [movements]);
  const heldPerItem = useMemo(() => heldByItem(movements), [movements]);
  const sourceCheckout = useCallback((movement) => checkoutOf(movement, movements), [movements]);
  // Chemical batches by id, for the history's Batch column (migration 055).
  const batchMap = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);
  const batchById = useCallback((id) => batchMap.get(id) || null, [batchMap]);

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
      if (itemStockFilter === "LOW" && !isBelowReorder(item)) return false;
      if (itemStockFilter === "HEALTHY" && isLowStock) return false;
      if (itemStockFilter === "EXPIRING" && !isExpiringSoon(item, now)) return false;
      if (itemStockFilter === "MAINTENANCE" && !isMaintenanceOverdue(item, now)) return false;
      if (itemStockFilter === "LOSSES" && !recentLosses.has(item.id)) return false;
      return true;
    });
  }, [inventory, itemSearch, itemTypeFilter, itemStatusFilter, itemStockFilter, recentLosses, now]);

  const alerts = useMemo(() => inventoryAlerts(inventory, now, recentLosses), [inventory, now, recentLosses]);
  const stockValue = useMemo(
    () => inventory.filter((item) => item.status !== INVENTORY_STATUS.DISABLED && isPlausibleItem(item)).reduce((sum, item) => sum + itemValue(item), 0),
    [inventory]
  );

  const hasItemFilters = itemSearch || itemTypeFilter !== "ALL" || itemStatusFilter !== "ALL" || itemStockFilter !== "ALL";

  const clearItemFilters = () => {
    setItemSearch("");
    setItemTypeFilter("ALL");
    setItemStatusFilter("ALL");
    setItemStockFilter("ALL");
  };

  const activeHistorySection = HISTORY_SECTIONS.find((section) => section.key === historySection) || HISTORY_SECTIONS[0];
  const activeHistoryColumns = HISTORY_COLUMNS[historySection] || HISTORY_COLUMNS.IN;

  // Stage 1: every filter except the Stock Out reason. The reason chips count
  // against this, so each chip says what choosing it would show.
  const sectionMovements = useMemo(() => {
    let result = movements.filter((m) => (m.movementType || "IN") === historySection);

    const term = historySearch.trim().toLowerCase();
    if (term) {
      result = result.filter((m) => {
        const reasonLabel = STOCK_OUT_REASON_LABELS[reasonOf(m)] || "";
        const technician = m.technicianId ? technicianName(m.technicianId) : "";
        const visit = m.appointmentId ? appointmentLabel(m.appointmentId) : "";
        // Lot and batch reference, so a recall ("lot L24-0917") finds every use.
        const batch = m.batchId ? batchById(m.batchId) : null;
        const batchText = `${m.batchNumber || ""} ${batch?.lotNumber || ""} ${batch?.reference || ""}`;
        const text = `${m.itemName || ""} ${m.reference || ""} ${m.intakeBranchOrStation || ""} ${m.actor || ""} ${m.note || ""} ${reasonLabel} ${technician} ${visit} ${batchText}`.toLowerCase();
        return text.includes(term);
      });
    }

    if (historyItemFilter !== "ALL") {
      result = result.filter((m) => m.itemId === historyItemFilter);
    }

    if (historySection === "IN" && historyBranchFilter !== "ALL") {
      result = result.filter((m) => m.intakeBranchOrStation === historyBranchFilter);
    }

    if (historyDateFilter !== "ALL") {
      const todayStr = todayISO();
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
    return result;
  }, [movements, historySearch, historyItemFilter, historySection, historyBranchFilter, historyDateFilter, technicianName, appointmentLabel, batchById]);

  const reasonCounts = useMemo(() => countByReason(sectionMovements), [sectionMovements]);
  const lossSummary = useMemo(() => summarizeLosses(sectionMovements), [sectionMovements]);

  // Stage 2: the reason (Stock Out only), then the sort.
  const filteredAndSortedMovements = useMemo(() => {
    const result = historySection === "OUT"
      ? filterByReason(sectionMovements, { reason: historyReasonFilter, technicianId: historyTechnicianFilter })
      : [...sectionMovements];

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
  }, [sectionMovements, historySection, historySort, historyReasonFilter, historyTechnicianFilter]);

  // Loaded on the items tab too: the missing/damaged badge on each item reads
  // the movement log.
  useEffect(() => {
    refreshMovements();
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
      // No expiry here: it is printed on each delivery, so Stock In sets it.
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
    const limitError =
      validateMoney(form.cost, { max: LIMITS.MAX_UNIT_COST, label: "Cost per unit" }) ||
      (newItem.reorderLevel !== null && newItem.reorderLevel > LIMITS.MAX_MOVEMENT_QTY
        ? `Reorder level cannot be more than ${LIMITS.MAX_MOVEMENT_QTY.toLocaleString()}.`
        : null);
    if (limitError) {
      showError(limitError);
      return;
    }

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
      <div style={{ marginBottom: "18px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: "11.5px", letterSpacing: "0.09em", textTransform: "uppercase", color: "#50463c" }}>Operations</p>
          <h1 style={{ margin: "4px 0 0", fontSize: "30px", lineHeight: 1.2, letterSpacing: "-0.33px" }}>Inventory</h1>
          <p style={{ margin: "4px 0 0", color: "#50463c" }}>
            {inventory.length} {inventory.length === 1 ? "item" : "items"} · {formatPeso(stockValue, { decimals: 0 })} on hand
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button variant="quiet" onClick={() => setTab(tab === "history" ? "items" : "history")}>
            {tab === "history" ? "Items" : "Stock history"}
          </Button>
          {canManageStock && (
            <Button variant="secondary" icon={<Plus size={15} />} onClick={() => { setTab("items"); setOpenForm((value) => !value); }}>
              {openForm ? "Close form" : "Add item"}
            </Button>
          )}
          {canManageStock && (
            <Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => { setStockInSeedItemId(""); setStockInOpen(true); }}>
              Receive delivery
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid #efe9e0" }}>
        <TabButton active={tab === "items"} onClick={() => setTab("items")}>
          Items
        </TabButton>
        <TabButton active={tab === "custody"} onClick={() => setTab("custody")}>
          With technicians{outWithTechnicians.length ? ` (${outWithTechnicians.length})` : ""}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          Stock history
        </TabButton>
      </div>

      {tab === "items" && (
        <>
          {openForm && (
            <form onSubmit={handleSubmit} style={{ ...card, marginBottom: "1.5rem" }}>
              <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
                <h3 style={{ color: "#211b15", marginBottom: "1rem" }}>Basic Information</h3>
                <p style={{ margin: "0 0 1rem", color: "#96897b", fontSize: "0.85rem" }}>
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
                    <input name="cost" type="number" min="0" max={LIMITS.MAX_UNIT_COST} step="0.01" value={form.cost} onChange={handleChange} style={inputStyle} placeholder="0.00" required />
                  </Field>
                  <Field label="Supplier">
                    <input name="supplier" value={form.supplier} onChange={handleChange} style={inputStyle} placeholder="Supplier name" />
                  </Field>
                  <Field label="Storage Location">
                    <input name="storageLocation" value={form.storageLocation} onChange={handleChange} style={inputStyle} placeholder="e.g. Storage Room A" />
                  </Field>
                  <Field label="Reorder Level">
                    <input name="reorderLevel" type="number" min="0" max={LIMITS.MAX_MOVEMENT_QTY} step="0.1" value={form.reorderLevel} onChange={handleChange} style={inputStyle} placeholder="0" />
                  </Field>
                </div>
              </div>

              {form.type === "CHEMICAL" && (
                <div style={{ marginBottom: "1.5rem", borderBottom: "2px solid #f0f0f0", paddingBottom: "1rem" }}>
                  <h3 style={{ color: "#211b15", marginBottom: "1rem" }}>Chemical Details</h3>
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
                  <h3 style={{ color: "#211b15", marginBottom: "1rem" }}>Equipment Details</h3>
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
                  <h3 style={{ color: "#211b15", marginBottom: "1rem" }}>Material Details</h3>
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
                <button type="submit" style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "3.75px", padding: "0.8rem 1rem", fontWeight: 500, cursor: "pointer" }}>
                  Add Item
                </button>
              </div>
            </form>
          )}

          {/* The four alert cards double as filters: click one to see just
              those items, click it again to see everything. */}
          <div role="group" aria-label="Stock alerts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            {[
              { key: "LOW", count: alerts.low, label: "Below reorder level", Icon: Package, tone: "danger" },
              { key: "EXPIRING", count: alerts.expiring, label: "Expires within 30 days", Icon: FlaskConical, tone: "danger" },
              { key: "MAINTENANCE", count: alerts.maintenance, label: "Maintenance overdue", Icon: Wrench, tone: "warning" },
              { key: "LOSSES", count: alerts.losses, label: "Missing / damaged this month", Icon: AlertTriangle, tone: "neutral" },
            ].map(({ key, count, label, Icon, tone }) => {
              const selected = itemStockFilter === key;
              const tile = tone === "danger" ? { background: "#f9ecea", color: "#9a2d24" } : tone === "warning" ? { background: "#faf0e2", color: "#9a6420" } : { background: "#efe9e0", color: "#50463c" };
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setItemStockFilter(selected ? "ALL" : key)}
                  className="ui-interactive"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "14px 16px",
                    textAlign: "left",
                    background: "#ffffff",
                    border: `1px solid ${selected ? "#7f1111" : "#e6dfd3"}`,
                    boxShadow: "none",
                    borderRadius: "7.5px",
                    cursor: "pointer",
                  }}
                >
                  <span aria-hidden="true" style={{ width: "34px", height: "34px", borderRadius: "4px", display: "grid", placeItems: "center", flexShrink: 0, ...(count ? tile : { background: "#efe9e0", color: "#8a7d70" }) }}>
                    <Icon size={17} strokeWidth={1.6} />
                  </span>
                  <span>
                    <span style={{ display: "block", fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 500, fontSize: "24px", lineHeight: 1.1, color: "#211b15" }}>{count}</span>
                    <span style={{ display: "block", fontSize: "13px", color: "#50463c" }}>{label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ width: "100%", background: "#ffffff", border: "1px solid #e6dfd3", borderRadius: "7.5px", boxShadow: "none", overflow: "visible", position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "14px 18px", borderBottom: "1px solid #e6dfd3" }}>
              <div style={{ position: "relative", flex: "1 1 240px", maxWidth: "380px" }}>
                <Search size={15} aria-hidden="true" style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: "#8a7d70" }} />
                <input
                  aria-label="Search items"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search items"
                  style={{ ...inputStyle, paddingLeft: "34px" }}
                />
              </div>
              <SegmentedControl
                ariaLabel="Item type"
                size="sm"
                value={itemTypeFilter}
                onChange={setItemTypeFilter}
                options={[
                  { value: "ALL", label: "All" },
                  { value: "CHEMICAL", label: "Chemicals" },
                  { value: "EQUIPMENT", label: "Equipment" },
                  { value: "MATERIAL", label: "Materials" },
                ]}
              />
              <select aria-label="Item status" value={itemStatusFilter} onChange={(e) => setItemStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: "13px" }}>
                <option value="ALL">Active and disabled</option>
                <option value="ACTIVE">Active only</option>
                <option value="DISABLED">Disabled only</option>
              </select>
              <Button size="sm" variant="quiet" onClick={clearItemFilters} disabled={!hasItemFilters}>
                Clear filters
              </Button>
              <span style={{ marginLeft: "auto", color: "#8a7d70", fontSize: "12.5px" }}>Sorted by urgency</span>
            </div>

            <div className="inventory-scroll">
            <div className="inventory-row inventory-head" style={{ background: "#faf7ee", borderBottom: "1px solid #e6dfd3" }}>
              {["Item", "Type", "On hand", "Watch", "Location", "Value", ""].map((label, index) => (
                <span key={label || "actions"} style={{ fontSize: "11px", fontWeight: 500, color: "#8a7d70", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: index === 2 || index === 5 ? "right" : "left" }}>
                  {label || <span className="visually-hidden">Actions</span>}
                </span>
              ))}
            </div>

            {error && (
              <div style={{ padding: "1.25rem", color: "#9a2d24", background: "#f9ecea" }}>
                Could not load inventory — {error}
              </div>
            )}

            {!error && loading && (
              <div style={{ padding: "1.25rem", color: "#96897b" }}>Loading inventory…</div>
            )}

            {!error && !loading && inventory.length === 0 && (
              <div style={{ padding: "1.5rem", color: "#96897b", display: "grid", gap: "0.75rem", justifyItems: "start" }}>
                <span>No inventory items yet. Add your first item to start tracking stock.</span>
                <button type="button" onClick={() => setOpenForm(true)} style={{ background: "#9a2d24", color: "#ffffff", border: "none", borderRadius: "3.75px", padding: "0.65rem 0.9rem", fontWeight: 500, cursor: "pointer" }}>
                  Add inventory item
                </button>
              </div>
            )}

            {!error && !loading && inventory.length > 0 && filteredInventory.length === 0 && (
              <div style={{ padding: "1.25rem", color: "#96897b" }}>
                No inventory items match the current filters.
              </div>
            )}

            {sortByUrgency(filteredInventory, now, recentLosses).map((item) => {
              const isDisabled = item.status === INVENTORY_STATUS.DISABLED;
              const low = isBelowReorder(item);
              const watch = watchFor(item, now);
              const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";
              const quantity = Number(item.quantity || 0);
              const reorder = item.reorderLevel === null || item.reorderLevel === undefined || item.reorderLevel === "" ? null : Number(item.reorderLevel);
              // The bar is on-hand against twice the reorder level: full means
              // comfortably stocked, a short red bar means reorder.
              const fill = reorder ? Math.min(1, quantity / (reorder * 2)) : quantity > 0 ? 1 : 0;
              const detail = [item.supplier, item.type === "EQUIPMENT" ? item.serialNumber : item.chemicalType || item.materialCategory].filter(Boolean).join(" · ");
              const losses = recentLosses.get(item.id);
              const withTechnicians = heldPerItem.get(item.id) || 0;

              return (
                <div
                  key={item.id}
                  className="inventory-row"
                  onClick={() => setSelectedItem(item)}
                  style={{
                    borderTop: "1px solid #e6dfd3",
                    cursor: "pointer",
                    background: isDisabled ? "#f6f2ea" : low ? "#fffcf8" : "#ffffff",
                    opacity: isDisabled ? 0.75 : 1,
                    position: "relative",
                    zIndex: actionMenuItemId === item.id ? 60 : 1,
                    overflow: "visible",
                    isolation: "isolate",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: "#211b15" }}>{item.name}</div>
                    <div style={{ fontSize: "12px", color: "#8a7d70", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {[
                        detail || null,
                        withTechnicians ? `${withTechnicians} ${item.unit || ""} with technicians`.replace("  ", " ") : null,
                        losses ? describeLosses(losses) : null,
                        isDisabled ? "Disabled" : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>

                  <div style={{ color: "#211b15" }}>{typeLabel}</div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", whiteSpace: "nowrap" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      <b style={{ fontWeight: 600 }}>{quantity.toLocaleString()}</b>
                      {reorder !== null && low ? <span style={{ color: "#50463c" }}> / {reorder}</span> : null} {item.unit || ""}
                    </span>
                    <span aria-hidden="true" style={{ width: "72px", height: "4px", borderRadius: "2px", background: "#efe9e0", overflow: "hidden", flexShrink: 0 }}>
                      <span style={{ display: "block", height: "100%", width: `${fill * 100}%`, background: low ? "#9a2d24" : "#50463c" }} />
                    </span>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    {watch.pill ? <StatusPill tone={watch.tone}>{watch.label}</StatusPill> : <span style={{ color: "#8a7d70", fontSize: "13px" }}>{watch.label}</span>}
                  </div>

                  <div style={{ color: "#211b15", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.storageLocation || "—"}</div>

                  <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#211b15" }}>{isPlausibleItem(item) ? formatPeso(itemValue(item), { decimals: 0 }) : "—"}</div>

                  <div ref={actionMenuItemId === item.id ? actionMenuRef : null} style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "flex-end", overflow: "visible", position: "relative", zIndex: actionMenuItemId === item.id ? 200 : 1 }} onClick={(e) => e.stopPropagation()}>
                    {low && canManageStock && (
                      <Button size="sm" variant="secondary" onClick={() => { setStockInSeedItemId(item.id); setStockInOpen(true); }}>
                        Reorder
                      </Button>
                    )}
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
                          borderRadius: "3.75px",
                          border: "1px solid #efe9e0",
                          background: "#ffffff",
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                          color: "#50463c",
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
                            border: "1px solid #efe9e0",
                            borderRadius: "3.75px",
                            boxShadow: "none",
                            minWidth: "170px",
                            padding: "0.35rem",
                            zIndex: 5000,
                            pointerEvents: "auto",
                          }}
                        >
                          {!isDisabled && <button type="button" onClick={() => { setActionMenuItemId(null); setStockInSeedItemId(item.id); setStockInOpen(true); }} style={{ ...menuActionStyle, color: "#211b15" }}>Stock In</button>}
                          <button type="button" onClick={() => { setActionMenuItemId(null); setEditItem(item); }} style={{ ...menuActionStyle, color: "#211b15" }}>Edit</button>
                          {!isDisabled && <button type="button" onClick={() => { setActionMenuItemId(null); setStockOutItem(item); }} style={{ ...menuActionStyle, color: "#9a2d24" }}>Stock Out</button>}
                          {!isDisabled && <button type="button" onClick={() => { setActionMenuItemId(null); setCorrectionItem(item); }} style={{ ...menuActionStyle, color: "#211b15" }}>Correct Stock</button>}
                          <button type="button" onClick={() => { setActionMenuItemId(null); if (isDisabled) setItemStatus(item.id, INVENTORY_STATUS.ACTIVE).then((r) => handleStatusResult(r, showSuccess, showError, item.name, "enabled")); else setDisableTarget(item); }} style={{ ...menuActionStyle, color: isDisabled ? "#4a6b4a" : "#9a2d24" }}>
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
            </div>
            <div style={{ padding: "10px 18px", borderTop: "1px solid #e6dfd3", color: "#8a7d70", fontSize: "12.5px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Showing {filteredInventory.length} of {inventory.length} items</span>
            </div>
          </div>
        </>
      )}

      {tab === "custody" && (
        <CustodyList
          entries={outWithTechnicians}
          technicianName={technicianName}
          appointmentLabel={appointmentLabel}
          canManage={canManageStock}
          loading={movementsLoading}
          error={movementsError}
          onReturn={setReturnTarget}
        />
      )}

      {tab === "history" && (
        <div style={{ maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
          {/* Filtering and Sorting Toolbar */}
          <div style={{ background: "#ffffff", border: "1px solid #efe9e0", borderRadius: "7.5px", boxShadow: "none", padding: "1rem", marginBottom: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.85rem" }}>
              <Field label="Search Logs">
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Item, PO#, lot no., reason, technician, note…"
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
                  {uniqueBranches.map((br) => (
                    <option key={br} value={br}>
                      {br}
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
                    border: `1px solid ${active ? section.accent : "#efe9e0"}`,
                    background: active ? section.accent : "#ffffff",
                    color: active ? "#ffffff" : "#50463c",
                    fontWeight: 500,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  {section.label}
                  <span style={{
                    fontSize: "0.72rem",
                    fontWeight: 500,
                    borderRadius: "999px",
                    padding: "0.1rem 0.45rem",
                    background: active ? "rgba(255,255,255,0.22)" : "#efe9e0",
                    color: active ? "#ffffff" : "#96897b",
                  }}>{count}</span>
                </button>
              );
            })}
          </div>

          {historySection === "OUT" && (
            <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
              <div role="group" aria-label="Filter stock-outs by reason" style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", alignItems: "center" }}>
                {REASON_FILTERS.map((option) => {
                  const active = historyReasonFilter === option.value;
                  const tone = REASON_TONES[option.value];
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setHistoryReasonFilter(option.value); setHistoryTechnicianFilter("ALL"); }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "0.4rem",
                        padding: "0.42rem 0.8rem",
                        borderRadius: "999px",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        border: active ? `1px solid ${tone?.color || "#50463c"}` : "1px solid #efe9e0",
                        background: active ? (tone?.background || "#efe9e0") : "#ffffff",
                        color: active ? (tone?.color || "#211b15") : "#50463c",
                      }}
                    >
                      {LOSS_REASONS.includes(option.value) && <AlertTriangle size={12} aria-hidden="true" />}
                      {option.label}
                      <span style={{ fontSize: "0.72rem", color: "#96897b" }}>{reasonCounts[option.value] ?? 0}</span>
                    </button>
                  );
                })}
                {historyReasonFilter === "TECHNICIAN_CHECKOUT" && (
                  <select
                    aria-label="Checked out to"
                    value={historyTechnicianFilter}
                    onChange={(event) => setHistoryTechnicianFilter(event.target.value)}
                    style={{ ...inputStyle, width: "auto", minWidth: "200px", padding: "0.45rem 0.6rem", fontSize: "0.8rem" }}
                  >
                    <option value="ALL">All technicians</option>
                    {technicians.map((account) => (
                      <option key={account.id} value={account.id}>{account.name || account.username}</option>
                    ))}
                  </select>
                )}
              </div>

              <div data-testid="loss-summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem" }}>
                {LOSS_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => { setHistoryReasonFilter(reason); setHistoryTechnicianFilter("ALL"); }}
                    style={{
                      textAlign: "left",
                      padding: "0.75rem 0.9rem",
                      borderRadius: "7.5px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      ...REASON_TONES[reason],
                    }}
                  >
                    <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>
                      {STOCK_OUT_REASON_LABELS[reason]}
                    </div>
                    <div style={{ marginTop: "0.25rem", fontSize: "1.05rem", fontWeight: 500, color: "#211b15", overflowWrap: "anywhere" }}>
                      {lossSummary[reason].count} record{lossSummary[reason].count === 1 ? "" : "s"} · {peso(lossSummary[reason].value)}
                    </div>
                    <div style={{ fontSize: "0.72rem", marginTop: "0.1rem" }}>Estimated value, for the dates and items filtered above.</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Records Table */}
          <div style={{ background: "#ffffff", border: "1px solid #efe9e0", borderRadius: "7.5px", boxShadow: "none", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: activeHistoryColumns.template,
                  minWidth: activeHistoryColumns.minWidth,
                  gap: "0.75rem",
                  padding: "1rem 1.25rem",
                  background: "#efe9e0",
                  fontWeight: 500,
                  color: "#96897b",
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {activeHistoryColumns.columns.map((column) => <span key={column.label}>{column.label}</span>)}
              </div>

              {movementsError && (
                <div style={{ padding: "1.25rem", color: "#9a2d24", background: "#f9ecea" }}>
                  Could not load history — {movementsError}
                </div>
              )}

              {!movementsError && movementsLoading && (
                <div style={{ padding: "1.25rem", color: "#96897b" }}>Loading history…</div>
              )}

              {!movementsError && !movementsLoading && filteredAndSortedMovements.length === 0 && (
                <div style={{ padding: "1.75rem", textAlign: "center", color: "#96897b" }}>
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
                    borderTop: "1px solid #efe9e0",
                    alignItems: "center",
                    fontSize: "0.9rem",
                  }}
                >
                  {activeHistoryColumns.columns.map((column) => (
                    <div key={column.label}>{column.render(movement, { technicianName, appointmentLabel, checkoutOf: sourceCheckout, batchById })}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedItem && (
        <InventoryDetailModal
          // The list row can be stale once a batch action reloads the item.
          item={inventory.find((entry) => entry.id === selectedItem.id) || selectedItem}
          batches={batches}
          canManage={canManageStock}
          onClose={() => setSelectedItem(null)}
          batchActions={{
            onWriteOff: async (batch, note) => {
              const result = await writeOffBatch(batch, note);
              if (result === true) showSuccess(`Wrote off expired batch ${batch.lotNumber || batch.reference}.`);
              return result;
            },
            onUpdate: async (batch, changes) => {
              const result = await updateBatch(batch, changes);
              if (result === true) showSuccess(`Batch ${batch.reference} updated.`);
              return result;
            },
            onSplit: async (batch, split) => {
              const result = await splitBatch(batch, split);
              if (result === true) showSuccess(`Split ${split.amount} off ${batch.reference} into lot ${split.lotNumber}.`);
              return result;
            },
          }}
        />
      )}

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

      {stockInOpen && (
        <BulkStockInModal
          inventory={inventory}
          initialItemId={stockInSeedItemId}
          onClose={() => { setStockInOpen(false); setStockInSeedItemId(""); }}
          onSubmit={async (entries, header) => {
            const result = await stockInMany(entries, header);
            if (result !== true) {
              showError(typeof result === "string" ? result : "Could not record the Stock In.");
              return false;
            }
            showSuccess(`Stocked in ${entries.length} item${entries.length === 1 ? "" : "s"} against ${header.reference}.`);
            setStockInOpen(false);
            setStockInSeedItemId("");
            return true;
          }}
        />
      )}

      {returnTarget && (
        <ReturnModal
          entry={returnTarget}
          technicianName={technicianName}
          appointments={appointments}
          appointmentLabel={appointmentLabel}
          onClose={() => setReturnTarget(null)}
          onSubmit={async (values) => {
            const { checkout } = returnTarget;
            const result = await returnCheckout(checkout, values);
            if (result !== true) {
              showError(typeof result === "string" ? result : "Could not record the return.");
              return false;
            }
            showSuccess(`${values.amount} ${checkout.itemUnit || ""} of ${checkout.itemName} is back on the shelf.`.replace("  ", " "));
            setReturnTarget(null);
            return true;
          }}
        />
      )}

      {stockOutItem && (
        <StockOutModal
          item={stockOutItem}
          technicians={technicians}
          appointments={appointments}
          batches={batches}
          onClose={() => setStockOutItem(null)}
          onSubmit={async (values) => {
            const result = await stockOutManual(stockOutItem.id, values);
            if (result !== true) {
              showError(typeof result === "string" ? result : "Could not record the Stock Out.");
              return false;
            }
            showSuccess(`Removed ${values.amount} ${stockOutItem.unit} from ${stockOutItem.name}.`);
            setStockOutItem(null);
            return true;
          }}
        />
      )}

      {correctionItem && (
        <StockCorrectionModal
          item={correctionItem}
          batches={batches}
          onClose={() => setCorrectionItem(null)}
          onSubmit={async (values) => {
            const result = await stockCorrection(correctionItem.id, values.delta, values.reason, { batchId: values.batchId });
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
        color: active ? colors.brandInk : "#96897b",
        fontWeight: 500,
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
    const limitError =
      validateMoney(values.cost, { max: LIMITS.MAX_UNIT_COST, label: "Cost per unit" }) ||
      (values.reorderLevel !== "" && Number(values.reorderLevel) > LIMITS.MAX_MOVEMENT_QTY
        ? `Reorder level cannot be more than ${LIMITS.MAX_MOVEMENT_QTY.toLocaleString()}.`
        : null);
    if (limitError) {
      setValidationError(limitError);
      return;
    }
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
        <p style={{ margin: "0 0 1.25rem", color: "#96897b", fontSize: "0.85rem" }}>
          Update this item's details here. Quantity stays protected and can only be changed through Stock In, which records every adjustment in history.
        </p>
        {validationError && <p style={{ margin: "0 0 1rem", color: "#9a2d24", fontSize: "0.85rem", fontWeight: 500 }}>{validationError}</p>}

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
            <input name="cost" type="number" min="0" max={LIMITS.MAX_UNIT_COST} step="0.01" value={values.cost} onChange={handleChange} style={inputStyle} required />
          </Field>
          <Field label="Supplier">
            <input name="supplier" value={values.supplier} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Storage Location">
            <input name="storageLocation" value={values.storageLocation} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Reorder Level">
            <input name="reorderLevel" type="number" min="0" max={LIMITS.MAX_MOVEMENT_QTY} step="0.1" value={values.reorderLevel} onChange={handleChange} style={inputStyle} />
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
              {/* The expiry comes from the batches (migration 055): the soonest
                  one with stock. It is corrected per batch in the item's details. */}
              <Field label="Soonest expiry" hint="Comes from the batches. Correct a batch's expiry in the item's details.">
                <input value={values.expirationDate ? formatDate(values.expirationDate) : "—"} readOnly style={{ ...inputStyle, background: "#efe9e0" }} />
              </Field>
              <Field label="Safety Level *">
                <select name="safetyLevel" value={values.safetyLevel} onChange={handleChange} style={inputStyle} required>
                  <option value="">Select safety level</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </Field>
              <Field label="Hazard Note"><input name="hazardRating" value={values.hazardRating} onChange={handleChange} style={inputStyle} /></Field>
              <Field label="Date Received"><input name="dateReceived" type="date" value={values.dateReceived} onChange={handleChange} style={inputStyle} /></Field>
            </div>
          </section>
        )}

        {values.type === "EQUIPMENT" && (
          <section style={editSectionStyle}>
            <h3 style={editSectionHeadingStyle}>Equipment Details</h3>
            <p style={{ margin: "0 0 1rem", color: "#96897b", fontSize: "0.85rem" }}>After servicing equipment, set Last Maintenance to the service date and schedule its Next Maintenance date.</p>
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

/**
 * Stock In, for a whole delivery.
 *
 * A delivery note lists several products against one PO, one date and one
 * receiving station, and the old form took them one at a time — which meant
 * retyping the header four times and, worse, four independent writes where the
 * third could fail after the first two had already moved the stock. The header
 * is now entered once and the lines are submitted together through
 * stock_in_batch(): all of them land, or none of them do.
 *
 * Unit conversion sits on the line, not the header, because one note can carry
 * a drum in gallons and a sack in kilograms. The row shows what the converted
 * figure will be before it is submitted — the arithmetic is the part staff were
 * getting wrong, so hiding it would only move the mistake.
 */
/**
 * The delivery note header: Date, PO reference, Intake Branch on one line.
 *
 * Not built out of `Field` like the rest of this file. Field renders each
 * field as its own grid, and three separate grids cannot agree on where the
 * input goes — the labels are different heights ("PO / Supplier Invoice
 * Reference *" wraps) and only two of the three have a hint, so each grid
 * sized its own rows and the three inputs sat at three different heights.
 *
 * Here the label, the control and the hint are direct children of one grid
 * and land in an explicit band, so every input is on the same line. The
 * placement lives in `.delivery-note-grid` in globals.css, which is also
 * where the narrow-screen stacking is; children are emitted in per-field
 * order so that stacking reads correctly.
 */
function DeliveryNoteHeader({ fields }) {
  return (
    <div className="delivery-note-grid">
      {fields.map((field, index) => {
        const column = `dn-col-${index + 1}`;
        return (
          <Fragment key={field.id}>
            <label className={`dn-label ${column}`} htmlFor={field.id}>
              {field.label}
              {/* Non-breaking, so a wrapping label never leaves the asterisk
                  stranded alone on the second line. */}
              {field.required && <span aria-hidden="true">{"\u00a0*"}</span>}
            </label>
            <div className={`dn-control ${column}`}>{field.control}</div>
            <span className={`dn-hint ${column}`}>{field.hint || ""}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

const EXPIRY_WARNING_DAYS = 30;

/**
 * The line under a Stock In expiry field: what happens to the item's date, or
 * a warning when this delivery is already close to expiring.
 */
export function expiryHint(expiry, deliveryDate, currentExpiry) {
  if (!expiry) {
    return currentExpiry
      ? `Printed on the container. Required — currently ${formatDate(currentExpiry)}.`
      : "Printed on the container. Required for every chemical.";
  }
  const days = Math.round((new Date(`${expiry}T00:00:00`) - new Date(`${deliveryDate || todayISO()}T00:00:00`)) / 86400000);
  if (days < 0) return "Before the delivery date: this stock has already expired.";
  if (days <= EXPIRY_WARNING_DAYS) return `Expires ${days === 0 ? "on the delivery date" : `${days} day${days === 1 ? "" : "s"} after delivery`}.`;
  // Migration 055: the delivery is its own batch; the item shows the soonest.
  return "Kept with this batch. The soonest-expiring batch is used first.";
}

export function BulkStockInModal({ inventory, initialItemId = "", onClose, onSubmit }) {
  const stockableItems = useMemo(
    () => inventory.filter((item) => item.status !== INVENTORY_STATUS.DISABLED),
    [inventory]
  );
  const findItem = (itemId) => stockableItems.find((item) => item.id === itemId) || null;

  const buildRow = (itemId = "") => {
    const item = findItem(itemId);
    return {
      key: `stock-in-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      itemId,
      amount: "",
      // Defaults to the item's own unit, so a user who never opens the picker
      // gets exactly the old behaviour with no conversion applied.
      enteredUnit: item ? normalizeUnit(item.unit) || item.unit : "",
      unitCost: item?.cost ?? "",
      expirationDate: "",
      // A chemical line becomes its own batch (migration 055): the lot printed
      // on the container, or `noLot` when none is.
      lotNumber: "",
      noLot: false,
    };
  };

  const [rows, setRows] = useState(() => [buildRow(initialItemId)]);
  const [date, setDate] = useState(() => todayISO());
  const [reference, setReference] = useState("");
  const [intakeBranchOrStation, setIntakeBranchOrStation] = useState(
    findItem(initialItemId)?.intakeBranchOrStation || ""
  );
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  const updateRow = (key, changes) => {
    setValidationError("");
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  };

  const pickItem = (key, itemId) => {
    const item = findItem(itemId);
    updateRow(key, {
      itemId,
      enteredUnit: item ? normalizeUnit(item.unit) || item.unit : "",
      unitCost: item?.cost ?? "",
      expirationDate: "",
      lotNumber: "",
      noLot: false,
    });
  };

  /** The base-unit figure a row will actually move the stock by, or null. */
  const baseAmount = (row) => {
    const item = findItem(row.itemId);
    if (!item || row.amount === "") return null;
    if (!row.enteredUnit || normalizeUnit(row.enteredUnit) === normalizeUnit(item.unit) || !normalizeUnit(item.unit)) {
      const plain = Number(row.amount);
      return Number.isFinite(plain) ? plain : null;
    }
    return convertAmount(row.amount, row.enteredUnit, item.unit);
  };

  const rowTotal = (row) => {
    const amount = baseAmount(row);
    if (amount === null) return 0;
    return amount * (Number(row.unitCost) || 0);
  };

  const totalCapitalSpent = rows.reduce((sum, row) => sum + rowTotal(row), 0);
  const filledRows = rows.filter((row) => row.itemId);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (filledRows.length === 0) {
      setValidationError("Add at least one item to this delivery.");
      return;
    }
    // One line per item — except a chemical, which may arrive in more than
    // one lot: then one line per lot.
    const lineKey = (row) => (findItem(row.itemId)?.type === "CHEMICAL"
      ? `${row.itemId}|${row.noLot ? "" : row.lotNumber.trim().toLowerCase()}`
      : row.itemId);
    if (new Set(filledRows.map(lineKey)).size !== filledRows.length) {
      setValidationError("The same item and lot appear twice. Combine the duplicate lines.");
      return;
    }
    if (!reference.trim() || !intakeBranchOrStation.trim() || !date) return;
    const dateError = validateMovementDate(date);
    if (dateError) {
      setValidationError(`Delivery ${dateError.charAt(0).toLowerCase()}${dateError.slice(1)}`);
      return;
    }

    const entries = [];
    for (const row of filledRows) {
      const item = findItem(row.itemId);
      const amount = baseAmount(row);
      if (amount === null || !(amount > 0)) {
        setValidationError(`Enter a quantity greater than zero for ${item?.name || "every item"}.`);
        return;
      }
      const limitError =
        validateQuantity(amount, { label: `Quantity for ${item?.name || "an item"}` }) ||
        validateMoney(row.unitCost, { max: LIMITS.MAX_UNIT_COST, label: `Cost per unit for ${item?.name || "an item"}` });
      if (limitError) {
        setValidationError(limitError);
        return;
      }
      const expiry = item.type === "CHEMICAL" ? row.expirationDate : "";
      // Every chemical delivery carries its expiry: it is printed on the
      // container, and this is the only place the app records it.
      if (item.type === "CHEMICAL" && !expiry) {
        setValidationError(`Enter the expiry date printed on the ${item.name} delivery.`);
        return;
      }
      if (expiry && expiry < date) {
        setValidationError(`${item.name} has already expired: its expiry date is before the delivery date.`);
        return;
      }
      const lotNumber = item.type === "CHEMICAL" && !row.noLot ? row.lotNumber.trim() : "";
      if (item.type === "CHEMICAL" && !row.noLot && !lotNumber) {
        setValidationError(`Enter the lot number printed on the ${item.name} container, or tick "No lot number printed".`);
        return;
      }
      const converted = normalizeUnit(row.enteredUnit) !== normalizeUnit(item.unit)
        && Boolean(normalizeUnit(row.enteredUnit))
        && Boolean(normalizeUnit(item.unit));
      entries.push({
        itemId: row.itemId,
        amount,
        unitCost: row.unitCost === "" ? null : Number(row.unitCost),
        enteredAmount: converted ? Number(row.amount) : null,
        enteredUnit: converted ? row.enteredUnit : null,
        conversionFactor: converted ? conversionFactor(row.enteredUnit, item.unit) : 1,
        expirationDate: expiry || null,
        lotNumber: lotNumber || null,
        noLot: item.type === "CHEMICAL" && row.noLot,
      });
    }

    setSaving(true);
    await onSubmit(entries, {
      date,
      reference: reference.trim(),
      intakeBranchOrStation: intakeBranchOrStation.trim(),
      idempotencyKey,
    });
    setSaving(false);
  };

  return (
    <ModalShell
      onClose={onClose}
      title="Stock In"
      subtitle="One delivery note: shared PO, date and receiving station, with a line per item."
      maxWidth="46rem"
    >
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        {validationError && (
          <p style={{ margin: 0, color: "#9a2d24", fontSize: "0.85rem", fontWeight: 500 }}>{validationError}</p>
        )}

        <DeliveryNoteHeader
          fields={[
            {
              id: "stock-in-date",
              label: "Date",
              required: true,
              control: (
                <input id="stock-in-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} style={inputStyle} required />
              ),
            },
            {
              id: "stock-in-reference",
              label: "PO / Supplier Invoice Reference",
              required: true,
              hint: "Enter the Purchase Order (PO) or invoice number",
              control: (
                <input id="stock-in-reference" value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} placeholder="PO-1001, Invoice #, delivery note" required />
              ),
            },
            {
              id: "stock-in-intake",
              label: "Intake Branch / Station",
              required: true,
              hint: "Station or warehouse where items were received",
              control: (
                <input id="stock-in-intake" value={intakeBranchOrStation} onChange={(e) => setIntakeBranchOrStation(e.target.value)} style={inputStyle} placeholder="e.g. Main Warehouse, Pasig Station" required />
              ),
            },
          ]}
        />

        <div style={{ display: "grid", gap: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #efe9e0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <strong style={{ color: "#211b15", fontSize: "0.9rem" }}>Items received</strong>
            <button
              type="button"
              onClick={() => setRows((current) => [...current, buildRow()])}
              style={{ ...secondaryButton, padding: "0.42rem 0.72rem", fontSize: "0.75rem" }}
            >
              <Plus size={13} /> Add item
            </button>
          </div>

          {rows.map((row) => {
            const item = findItem(row.itemId);
            // A chemical can appear again for another lot; anything else once.
            const alreadyChosen = new Set(rows
              .filter((other) => other.key !== row.key && findItem(other.itemId)?.type !== "CHEMICAL")
              .map((other) => other.itemId)
              .filter(Boolean));
            const unitChoices = item ? convertibleUnits(item.unit) : [];
            const conversionNote = item && row.amount !== "" && row.enteredUnit
              ? describeConversion(row.amount, row.enteredUnit, item.unit)
              : "";

            return (
              <div key={row.key} style={{ display: "grid", gap: "0.45rem", padding: "0.75rem", border: "1px solid #efe9e0", borderRadius: "3.75px", background: "#fcfaf1" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) 90px minmax(0, 0.9fr) 110px auto", gap: "0.45rem", alignItems: "end" }}>
                  <Field label="Item">
                    <select
                      aria-label="Stock In item"
                      value={row.itemId}
                      onChange={(event) => pickItem(row.key, event.target.value)}
                      style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem" }}
                    >
                      <option value="">Select item</option>
                      {stockableItems.map((candidate) => (
                        <option key={candidate.id} value={candidate.id} disabled={alreadyChosen.has(candidate.id)}>
                          {candidate.name} ({candidate.quantity} {candidate.unit})
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Quantity">
                    <input
                      aria-label="Stock In quantity"
                      type="number"
                      min="0"
                      max={LIMITS.MAX_MOVEMENT_QTY}
                      step="any"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(event) => updateRow(row.key, { amount: event.target.value })}
                      style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem" }}
                      placeholder="0"
                    />
                  </Field>

                  <Field label="Received in">
                    {unitChoices.length > 0 ? (
                      <select
                        aria-label="Received unit"
                        value={row.enteredUnit}
                        onChange={(event) => updateRow(row.key, { enteredUnit: event.target.value })}
                        style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem" }}
                      >
                        {unitChoices.map((unit) => (
                          <option key={unit} value={unit}>{UNIT_LABELS[unit] || unit}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label="Received unit"
                        value={item?.unit || ""}
                        readOnly
                        style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem", background: "#efe9e0" }}
                      />
                    )}
                  </Field>

                  <Field label="Cost / unit (₱)">
                    <input
                      aria-label="Purchase cost per unit"
                      type="number"
                      min="0"
                      max={LIMITS.MAX_UNIT_COST}
                      step="0.01"
                      value={row.unitCost}
                      onChange={(event) => updateRow(row.key, { unitCost: event.target.value })}
                      style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem" }}
                      placeholder="0.00"
                    />
                  </Field>

                  {rows.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove item line"
                      onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
                      style={{ border: 0, background: "transparent", color: "#9a2d24", cursor: "pointer", padding: "0.6rem 0.4rem", fontSize: "0.95rem" }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {item?.type === "CHEMICAL" && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))", gap: "0.45rem", alignItems: "start" }}>
                    <Field
                      label="Expiry date *"
                      hint={expiryHint(row.expirationDate, date, item.expirationDate)}
                    >
                      <input
                        aria-label="Expiry date"
                        aria-required="true"
                        type="date"
                        min={date || undefined}
                        value={row.expirationDate}
                        onChange={(event) => updateRow(row.key, { expirationDate: event.target.value })}
                        style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem" }}
                      />
                    </Field>
                    <Field label={row.noLot ? "Lot number" : "Lot number *"} hint="Printed on the container, for recalls. The batch ID is added for you.">
                      <input
                        aria-label="Lot number"
                        aria-required={!row.noLot}
                        value={row.noLot ? "" : row.lotNumber}
                        disabled={row.noLot}
                        onChange={(event) => updateRow(row.key, { lotNumber: event.target.value })}
                        maxLength={LIMITS.SHORT_TEXT_MAX}
                        placeholder="e.g. L24-0917"
                        style={{ ...inputStyle, padding: "0.6rem 0.55rem", fontSize: "0.82rem", background: row.noLot ? "#efe9e0" : inputStyle.background }}
                      />
                    </Field>
                    <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", color: "#50463c", fontSize: "0.8rem", paddingTop: "1.7rem" }}>
                      <input
                        type="checkbox"
                        checked={row.noLot}
                        onChange={(event) => updateRow(row.key, { noLot: event.target.checked })}
                      />
                      No lot number printed
                    </label>
                  </div>
                )}

                {conversionNote && (
                  <div style={{ color: "#4a6b4a", fontSize: "0.74rem" }}>
                    Converted: <strong>{conversionNote}</strong> — stock moves by the {item.unit} figure.
                  </div>
                )}
                {item && (
                  <div style={{ color: "#96897b", fontSize: "0.72rem" }}>
                    Line total {peso(rowTotal(row))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: "0.9rem 1rem",
            background: "#efe9e0",
            borderRadius: "3.75px",
            border: "1px solid #efe9e0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div>
            <div style={{ color: "#50463c", fontSize: "0.7rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total Cost
            </div>
            <div style={{ color: "#96897b", fontSize: "0.72rem", marginTop: "0.2rem" }}>
              {filledRows.length} item{filledRows.length === 1 ? "" : "s"} on this delivery
            </div>
          </div>
          <div style={{ color: "#211b15", fontSize: "1rem", fontWeight: 500, textAlign: "right" }}>
            {peso(totalCapitalSpent)}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.75rem", paddingTop: "1rem", borderTop: "1px solid #efe9e0" }}>
          <button type="button" onClick={onClose} style={secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving} style={buttonWhen(saving)}>
            {saving ? "Recording…" : "Submit"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Stock leaving for a reason that is not an appointment.
 *
 * Until now the only way out of the store room was through a service report,
 * so a container checked out to a technician, a shortfall at count, and a
 * split drum all had to be filed as a "correction" with the reason typed into
 * free text. That made them uncountable. Each is now its own reason, and the
 * checkout names the technician holding the stock.
 *
 * The date defaults to today and stays editable: a discrepancy is usually
 * found days after it happened, and backdating it is what keeps the movement
 * log lined up with the physical count.
 */
function StockOutModal({ item, technicians, appointments = [], batches = [], onClose, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [reason, setReason] = useState(STOCK_OUT_REASONS[0].value);
  const [technicianId, setTechnicianId] = useState("");
  const [forAppointmentId, setForAppointmentId] = useState("");
  // A chemical's batch (migration 055): blank = soonest expiry first.
  const [batchId, setBatchId] = useState("");
  const withBatches = item.type === "CHEMICAL" && batches.some((batch) => batch.itemId === item.id);
  const usable = withBatches
    ? Math.round(usableBatches(batches, item.id, date).reduce((sum, batch) => sum + batch.quantity, 0) * 1e6) / 1e6
    : Number(item.quantity);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  const selectedReason = STOCK_OUT_REASONS.find((entry) => entry.value === reason) || STOCK_OUT_REASONS[0];
  const activeTechnicians = technicians.filter((account) => account.status !== ACCOUNT_STATUS.INACTIVE);
  // A checkout may name the visit it is for (migration 054): that visit uses it
  // first. Only the technician's visits still to be done are offered.
  const upcomingVisits = useMemo(() => {
    if (!technicianId) return [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return appointments
      .filter((visit) => crewOf(visit).includes(technicianId)
        && !["Completed", "Cancelled"].includes(visit.status)
        && new Date(visit.scheduledAt) >= startOfToday)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, 30);
  }, [appointments, technicianId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const parsedAmount = Number(amount);
    const limitError = validateQuantity(amount) || validateMovementDate(date);
    if (limitError) {
      setValidationError(limitError);
      return;
    }
    if (parsedAmount > usable) {
      setValidationError(withBatches && usable < Number(item.quantity)
        ? `Only ${usable} ${item.unit} is usable; the rest has expired. Write the expired batch off from the item's details.`
        : `Only ${item.quantity} ${item.unit} is in stock.`);
      return;
    }
    if (selectedReason.requiresTechnician && !technicianId) {
      setValidationError("Select the technician the stock was checked out to.");
      return;
    }
    setSaving(true);
    await onSubmit({
      amount: parsedAmount,
      date,
      reason,
      technicianId,
      forAppointmentId: selectedReason.requiresTechnician ? forAppointmentId : "",
      batchId: withBatches ? batchId : "",
      note: note.trim(),
    });
    setSaving(false);
  };

  return (
    <ModalShell onClose={onClose} title="Stock Out" subtitle={`Item: ${item.name} • Current Stock: ${item.quantity} ${item.unit}`}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        {validationError && (
          <p style={{ margin: 0, color: "#9a2d24", fontSize: "0.85rem", fontWeight: 500 }}>{validationError}</p>
        )}

        <Field label={`Quantity (${item.unit}) *`}>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(event) => { setValidationError(""); setAmount(event.target.value); }}
            style={inputStyle}
            placeholder="0"
            required
            autoFocus
          />
        </Field>

        <Field label="Date *" hint="Defaults to today. Change it to record a stock-out that happened earlier.">
          <input type="date" value={date} max={todayISO()} onChange={(event) => { setValidationError(""); setDate(event.target.value); }} style={inputStyle} required />
        </Field>

        {withBatches && (
          <Field label="Batch">
            <BatchSelect
              item={item}
              batches={batches}
              date={date}
              value={batchId}
              onChange={(value) => { setValidationError(""); setBatchId(value); }}
              amount={amount}
              label="Batch"
              selectStyle={inputStyle}
              noteStyle={{ color: "#96897b", fontSize: "0.74rem", fontWeight: 400 }}
            />
          </Field>
        )}

        <Field label="Reason *">
          <select
            value={reason}
            onChange={(event) => { setValidationError(""); setReason(event.target.value); }}
            style={inputStyle}
            required
          >
            {STOCK_OUT_REASONS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </Field>

        {selectedReason.requiresTechnician && (
          <Field label="Technician *">
            <select
              value={technicianId}
              onChange={(event) => { setValidationError(""); setTechnicianId(event.target.value); setForAppointmentId(""); }}
              style={inputStyle}
              required
            >
              <option value="">Select a technician</option>
              {activeTechnicians.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.reference ? `${account.reference} — ` : ""}{account.name || account.username}
                </option>
              ))}
            </select>
            {activeTechnicians.length === 0 && (
              <span style={{ color: "#9a2d24", fontSize: "0.74rem" }}>No active technician accounts to check stock out to.</span>
            )}
          </Field>
        )}

        {selectedReason.requiresTechnician && technicianId && (
          <Field label="For visit" hint="Optional. The stock stays with the technician either way; their next visit's materials are taken from it before the shelf.">
            <select value={forAppointmentId} onChange={(event) => setForAppointmentId(event.target.value)} style={inputStyle}>
              <option value="">Not for a particular visit</option>
              {upcomingVisits.map((visit) => (
                <option key={visit.id} value={visit.id}>
                  {appointmentReference(visit)} · {new Date(visit.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Note">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
            placeholder="Anything worth recording — where it went, how it was damaged"
            maxLength={LIMITS.NOTES_MAX}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", paddingTop: "0.75rem", borderTop: "1px solid #efe9e0" }}>
          <button type="button" onClick={onClose} style={secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving} style={buttonWhen(saving)}>
            {saving ? "Recording…" : "Record stock out"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Stock technicians have checked out and not yet used on a visit or returned
 * (migration 054). A visit's materials come out of these first, so what is
 * listed here is what is physically in someone's van right now.
 */
function CustodyList({ entries, technicianName, appointmentLabel, canManage, loading, error, onReturn }) {
  const template = "1.1fr 1.3fr 110px 1fr 120px 1.1fr 110px";
  const cell = { color: "#50463c" };
  return (
    <div style={{ background: "#ffffff", border: "1px solid #efe9e0", borderRadius: "7.5px", overflow: "hidden" }}>
      <p style={{ margin: 0, padding: "0.9rem 1.25rem", color: "#50463c", fontSize: "0.85rem", borderBottom: "1px solid #efe9e0" }}>
        Stock checked out and not yet used or returned. When a technician records a visit's materials, they come out of this first — the shelf is only charged for the rest.
      </p>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: template, minWidth: "900px", gap: "0.75rem", padding: "0.8rem 1.25rem", background: "#efe9e0", color: "#96897b", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {["Technician", "Item", "Taken", "For visit", "Still out", "Used · returned", ""].map((label) => <span key={label || "action"}>{label}</span>)}
        </div>
        {error && <div style={{ padding: "1.25rem", color: "#9a2d24", background: "#f9ecea" }}>Could not load checkouts — {error}</div>}
        {!error && loading && entries.length === 0 && <div style={{ padding: "1.25rem", color: "#96897b" }}>Loading…</div>}
        {!error && !loading && entries.length === 0 && (
          <div style={{ padding: "1.75rem", textAlign: "center", color: "#96897b" }}>Nothing is checked out right now.</div>
        )}
        {entries.map((entry) => {
          const { checkout, remaining, used, returned } = entry;
          return (
            <div key={checkout.id} style={{ display: "grid", gridTemplateColumns: template, minWidth: "900px", gap: "0.75rem", padding: "0.85rem 1.25rem", borderTop: "1px solid #efe9e0", alignItems: "center", fontSize: "0.9rem" }}>
              <span style={{ color: "#211b15", fontWeight: 500 }}>{technicianName(checkout.technicianId) || "A technician"}</span>
              {itemCell(checkout)}
              <span style={cell}>{formatDate(checkout.movementDate)}</span>
              <span style={cell}>{checkout.forAppointmentId ? appointmentLabel(checkout.forAppointmentId) : "—"}</span>
              <span style={{ fontWeight: 600, color: "#211b15", fontVariantNumeric: "tabular-nums" }}>{remaining} {checkout.itemUnit}</span>
              <span style={{ ...cell, fontSize: "0.8rem" }}>of {checkout.amount} · {used} used · {returned} returned</span>
              <span style={{ textAlign: "right" }}>
                {canManage && <Button size="sm" variant="secondary" onClick={() => onReturn(entry)}>Return</Button>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Checked-out stock coming back to the shelf. Every return says why; a
 * cancelled visit names the visit, and "Other" needs a note.
 */
function ReturnModal({ entry, technicianName, appointments, appointmentLabel, onClose, onSubmit }) {
  const { checkout, remaining } = entry;
  const technician = technicianName(checkout.technicianId) || "the technician";
  // Visits that can be "the cancelled one": this technician's cancelled visits,
  // the one the checkout was for first.
  const cancelledVisits = useMemo(() => appointments
    .filter((visit) => visit.status === "Cancelled" && crewOf(visit).includes(checkout.technicianId))
    .sort((a, b) => (b.id === checkout.forAppointmentId) - (a.id === checkout.forAppointmentId) || new Date(b.scheduledAt) - new Date(a.scheduledAt))
    .slice(0, 30), [appointments, checkout]);
  const forVisitCancelled = cancelledVisits.some((visit) => visit.id === checkout.forAppointmentId);

  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState(forVisitCancelled ? "VISIT_CANCELLED" : "LEFTOVER");
  const [visitId, setVisitId] = useState(forVisitCancelled ? checkout.forAppointmentId : "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");
  const chosen = RETURN_REASONS.find((option) => option.value === reason) || RETURN_REASONS[0];

  const handleSubmit = async (event) => {
    event.preventDefault();
    const problem = validateQuantity(amount, { label: "Quantity returned" })
      || (Number(amount) > remaining ? `Only ${remaining} ${checkout.itemUnit} is still out on this checkout.` : null)
      || validateMovementDate(date)
      || (date < String(checkout.movementDate).slice(0, 10) ? "A return cannot be dated before the checkout." : null)
      || (chosen.needsVisit && !visitId ? "Choose the visit that was cancelled." : null)
      || (chosen.needsNote && !note.trim() ? "Write a note saying why the stock is coming back." : null);
    if (problem) {
      setValidationError(problem);
      return;
    }
    setSaving(true);
    await onSubmit({ amount: Number(amount), reason, appointmentId: chosen.needsVisit ? visitId : "", note: note.trim(), date });
    setSaving(false);
  };

  const clear = (setter) => (event) => { setValidationError(""); setter(event.target.value); };

  return (
    <ModalShell
      onClose={onClose}
      title="Return to stock"
      subtitle={`${checkout.itemName} • ${remaining} ${checkout.itemUnit} still out with ${technician} since ${formatDate(checkout.movementDate)}`}
    >
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        {validationError && <p role="alert" style={{ margin: 0, color: "#9a2d24", fontSize: "0.85rem", fontWeight: 500 }}>{validationError}</p>}

        <Field label={`Quantity returned (${checkout.itemUnit}) *`}>
          <input type="number" min="0" max={remaining} step="any" inputMode="decimal" value={amount} onChange={clear(setAmount)} style={inputStyle} required autoFocus />
        </Field>

        <Field label="Why is it coming back? *">
          <select aria-label="Return reason" value={reason} onChange={clear(setReason)} style={inputStyle} required>
            {RETURN_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>

        {chosen.needsVisit && (
          <Field label="Cancelled visit *">
            <select aria-label="Cancelled visit" value={visitId} onChange={clear(setVisitId)} style={inputStyle} required>
              <option value="">Select the visit</option>
              {cancelledVisits.map((visit) => (
                <option key={visit.id} value={visit.id}>
                  {appointmentLabel(visit.id)} · {new Date(visit.scheduledAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                </option>
              ))}
            </select>
            {cancelledVisits.length === 0 && (
              <span style={{ color: "#9a2d24", fontSize: "0.74rem" }}>{technician} has no cancelled visits. Cancel the visit first, or choose another reason.</span>
            )}
          </Field>
        )}

        <Field label="Date returned *">
          <input type="date" value={date} min={String(checkout.movementDate).slice(0, 10)} max={todayISO()} onChange={clear(setDate)} style={inputStyle} required />
        </Field>

        <Field label={chosen.needsNote ? "Note *" : "Note"}>
          <textarea
            value={note}
            onChange={clear(setNote)}
            style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }}
            placeholder="Anything worth recording — the container's condition, who brought it back"
            maxLength={LIMITS.NOTES_MAX}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", paddingTop: "0.75rem", borderTop: "1px solid #efe9e0" }}>
          <button type="button" onClick={onClose} style={secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving} style={buttonWhen(saving)}>{saving ? "Recording…" : "Return to stock"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function StockCorrectionModal({ item, batches = [], onClose, onSubmit }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  // Which batch the count is about (migration 055). Blank: a shortfall comes
  // off the soonest expiry (expired included — it is what is on the shelf),
  // extra stock goes into the opening batch, since its lot is unknown.
  const [batchId, setBatchId] = useState("");
  const [saving, setSaving] = useState(false);
  const adding = Number(delta) > 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const parsedDelta = Number(delta);
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0 || !reason.trim()) return;
    setSaving(true);
    await onSubmit({ delta: parsedDelta, reason: reason.trim(), batchId });
    setSaving(false);
  };

  return (
    <ModalShell onClose={onClose} title="Correct Stock" subtitle={`Item: ${item.name} • Current Stock: ${item.quantity} ${item.unit}`}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        <Field label={`Adjustment (${item.unit}) *`} hint="Use a positive number to add stock or a negative number to remove stock.">
          <input type="number" step="1" value={delta} onChange={(event) => setDelta(event.target.value)} style={inputStyle} placeholder="e.g. -2 or 5" required autoFocus />
        </Field>
        {item.type === "CHEMICAL" && batches.some((batch) => batch.itemId === item.id) && (
          <Field label="Batch" hint={adding ? "Extra stock found. Pick its batch if you know it." : "Stock missing from the count. Pick the batch if you know it."}>
            <BatchSelect
              item={item}
              batches={batches}
              date={todayISO()}
              value={batchId}
              onChange={setBatchId}
              includeExpired
              showPlan={false}
              label="Batch"
              autoLabel={adding ? "Unknown lot (opening batch)" : "Soonest expiry first"}
              selectStyle={inputStyle}
            />
          </Field>
        )}
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
          borderRadius: "7.5px",
          border: "1px solid #efe9e0",
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
            <h2 style={{ margin: 0, color: "#211b15", fontSize: "1.125rem", fontWeight: 500 }}>{title}</h2>
            {subtitle && <p style={{ margin: "0.35rem 0 0", color: "#96897b", fontSize: "0.72rem", lineHeight: 1.4 }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            type="button"
            style={{
              background: "#ffffff",
              border: "1px solid #efe9e0",
              borderRadius: "999px",
              width: "2rem",
              height: "2rem",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: "#50463c",
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

function InventoryDetailModal({ item, batches = [], canManage, batchActions, onClose }) {
  const typeLabel = item.type === "CHEMICAL" ? "Chemical" : item.type === "EQUIPMENT" ? "Equipment" : "Material";
  const hasBatches = item.type === "CHEMICAL" && batches.some((batch) => batch.itemId === item.id);

  return (
    <ModalShell onClose={onClose} title={item.name} maxWidth={hasBatches ? "44rem" : undefined}>
      {/* Basic Information */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ color: "#50463c", fontSize: "0.875rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
          Basic Information
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <DetailRow label="Type" value={typeLabel} />
          <DetailRow label="Status" value={item.status === "DISABLED" ? "Disabled" : "Active"} />
          <DetailRow label="Quantity" value={`${item.quantity} ${item.unit}`} />
          {item.cost !== undefined && item.cost !== null ? <DetailRow label="Cost per Unit" value={peso(item.cost)} /> : null}
          {item.cost !== undefined && item.cost !== null && item.quantity ? <DetailRow label="Total Value" value={peso(item.quantity * Number(item.cost))} /> : null}
          {item.supplier && <DetailRow label="Supplier" value={item.supplier} />}
          {item.reorderLevel && <DetailRow label="Reorder Level" value={item.reorderLevel} />}
        </div>
      </div>

      {/* Chemical-Specific Details */}
      {item.type === "CHEMICAL" && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#50463c", fontSize: "0.875rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Chemical Details
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <DetailRow label="Chemical Type" value={item.chemicalType} />
            {item.expirationDate && <DetailRow label={hasBatches ? "Soonest expiry" : "Expiration Date"} value={formatDate(item.expirationDate)} />}
            {item.safetyLevel && <DetailRow label="Safety Level" value={item.safetyLevel} />}
              {item.hazardRating && <DetailRow label="Hazard Note" value={item.hazardRating} />}
            {item.dateReceived && <DetailRow label="Date Received" value={formatDate(item.dateReceived)} />}
          </div>
        </div>
      )}

      {/* Batches (migration 055): what is on the shelf, by lot and expiry. */}
      {hasBatches && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#50463c", fontSize: "0.875rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Batches
          </h3>
          <BatchList item={item} batches={batches} today={todayISO()} canManage={canManage} {...batchActions} />
        </div>
      )}

      {/* Equipment-Specific Details */}
      {item.type === "EQUIPMENT" && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#50463c", fontSize: "0.875rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Equipment Details
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {item.serialNumber && <DetailRow label="Serial Number" value={item.serialNumber} />}
            <DetailRow label="Condition" value={item.condition} />
            {item.manufacturer && <DetailRow label="Manufacturer" value={item.manufacturer} />}
            {item.model && <DetailRow label="Model" value={item.model} />}
            {item.lastMaintenanceDate && <DetailRow label="Last Maintenance" value={formatDate(item.lastMaintenanceDate)} />}
            {item.nextMaintenanceDate && <DetailRow label="Next Maintenance" value={formatDate(item.nextMaintenanceDate)} />}
          </div>
        </div>
      )}

      {/* Material-Specific Details */}
      {item.type === "MATERIAL" && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#50463c", fontSize: "0.875rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.85rem", color: "#96897b" }}>
          <div>
            <div style={{ fontWeight: 500, color: "#50463c" }}>Created</div>
            {formatDate(item.createdAt)}
          </div>
          <div>
            <div style={{ fontWeight: 500, color: "#50463c" }}>Last Updated</div>
            {formatDate(item.updatedAt)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem", gap: "0.5rem" }}>
        <button onClick={onClose} style={{ background: "#8b1e1e", color: "#fff", border: "none", borderRadius: "3.75px", padding: "0.8rem 1rem", fontWeight: 500, cursor: "pointer" }}>
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
      <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#96897b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", color: "#211b15", fontWeight: 500 }}>
        {value || "—"}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    // alignContent start: a field beside one with a hint must not stretch its
    // control to fill the taller row (Edit item's Chemical Type did).
    <label style={{ display: "grid", gap: "0.45rem", alignContent: "start", color: "#50463c", fontWeight: 500 }}>
      <span>{label}</span>
      {children}
      {hint && <span style={{ color: "#96897b", fontSize: "0.72rem", fontWeight: 400 }}>{hint}</span>}
    </label>
  );
}

function buttonWhen(disabled, base = primaryButton, extra = {}) {
  return { ...base, ...extra, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
}

const menuActionStyle = {
  width: "100%",
  border: "none",
  background: "#ffffff",
  textAlign: "left",
  padding: "0.6rem 0.7rem",
  borderRadius: "3.75px",
  fontWeight: 500,
  cursor: "pointer",
  opacity: 1,
};

const inputStyle = {
  width: "100%",
  border: "1px solid #c7bcaf",
  borderRadius: "3.75px",
  padding: "0.72rem 0.8rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: "#211b15",
};

const editSectionStyle = {
  marginTop: "1.5rem",
  paddingTop: "1.25rem",
  borderTop: "1px solid #efe9e0",
};

const editSectionHeadingStyle = {
  margin: "0 0 1rem",
  color: "#50463c",
  fontSize: "1rem",
};

const editGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "1rem",
  alignItems: "start",
};

export default InventoryPage;
