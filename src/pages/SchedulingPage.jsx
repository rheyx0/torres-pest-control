import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  Lock,
  MapPin,
  PackageCheck,
  Plus,
  Printer,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import ClientDocuments from "../components/clients/ClientDocuments";
import SignaturePad from "../components/scheduling/SignaturePad";
import ServiceReportPrinter from "../components/scheduling/ServiceReportPrinter";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import useInventory from "../hooks/useInventory";
import useUsers from "../hooks/useUsers";
import { useScheduling } from "../context/SchedulingContext";
import { useToast } from "../context/ToastContext";
import { ACCOUNT_STATUS, APPOINTMENT_STATUSES, ATTACHMENT_CATEGORIES, DOCUMENT_CATEGORIES, PEST_CONCERN_SUGGESTIONS, ROLES, SERVICE_TYPES, TREATMENT_METHODS, TREATMENT_METHOD_GROUPS } from "../utils/constants";
import { allowedNextStatuses, busyTechnicianIds, canTransition, endOf, findTechnicianConflicts, layoutDayAppointments, startOf } from "../utils/scheduling";
import { validateAttachment } from "../utils/validators";
import { card, colors, inputStyle, pageShell, primaryButton, secondaryButton } from "../styles/theme";

// Week grid geometry. ROW_HEIGHT is the pixel height of one hour and is the
// single basis for every position in the grid — card tops, card heights, and
// the drop-target time math all derive from it.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 19;
const ROW_HEIGHT = 56;
const MIN_CARD_HEIGHT = 22;
const MAX_CARD_COLUMNS = 3;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => index + DAY_START_HOUR);

// A card is filled with its technician's color. Overlapping cards are always
// different technicians — the database forbids double-booking one — so color is
// what tells them apart at a glance, and an overloaded technician shows up
// across the whole week without reading a word.
const TECHNICIAN_PALETTE = [
  { fill: "#d9f0ef", ink: "#0a6b6d", bar: "#0e8f92" },
  { fill: "#e2e3fb", ink: "#3a44b8", bar: "#4f5bd5" },
  { fill: "#fbe8d4", ink: "#94540a", bar: "#c07a10" },
  { fill: "#dcefdc", ink: "#2c6b33", bar: "#3f8b47" },
  { fill: "#f6e0f4", ink: "#8a2f83", bar: "#a9459f" },
  { fill: "#dfeaf9", ink: "#1f5c9c", bar: "#2f7cc4" },
];

// Unassigned is deliberately the odd one out: those appointments skip the
// double-booking check entirely, so the dispatch backlog should be obvious.
const UNASSIGNED_COLOR = { fill: "#fadfe5", ink: "#97324a", bar: "#bf4460" };
const TAB_LABELS = ["Overview", "Documents", "Report", "Stock-Out"];
const STOCK_CATEGORIES = ["CHEMICAL", "MATERIAL", "EQUIPMENT"];
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours ? `${hours} hour${hours === 1 ? "" : "s"}` : ""}${hours && remainingMinutes ? " and " : ""}${remainingMinutes ? `${remainingMinutes} minutes` : ""}`;
}

function readDuration(values) {
  const hours = Number(values.get("durationHours")) || 0;
  const minutes = Number(values.get("durationMinutes")) || 0;
  return hours * 60 + minutes;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(`2000-01-01T${value}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const STATUS_COLORS = {
  Pending: ["#fff7ed", "#c2410c"],
  Scheduled: ["#eff6ff", "#1d4ed8"],
  Confirmed: ["#ecfdf5", "#047857"],
  Reschedule: ["#fefce8", "#a16207"],
  Completed: ["#f0fdf4", "#166534"],
  Cancelled: ["#fef2f2", "#b91c1c"],
};

function badgeStyle(status) {
  const [background, color] = STATUS_COLORS[status] || STATUS_COLORS.Pending;
  return { background, color, borderRadius: 999, padding: "0.25rem 0.55rem", fontSize: "0.7rem", fontWeight: 800 };
}

/** Status has to survive a card too small for its pill, so it also colors the edge. */
function statusAccent(status) {
  return (STATUS_COLORS[status] || STATUS_COLORS.Pending)[1];
}

/**
 * Colour says who; outline says what state. Keeping both means a two-line block
 * still carries everything the old five-row card tried to spell out.
 */
function statusShape(status) {
  if (status === "Cancelled") return { borderStyle: "solid", opacity: 0.5, strike: true, dim: true };
  if (status === "Completed") return { borderStyle: "solid", opacity: 0.78, strike: false, dim: true };
  if (status === "Pending") return { borderStyle: "dashed", opacity: 1, strike: false, dim: false };
  if (status === "Reschedule") return { borderStyle: "dotted", opacity: 1, strike: false, dim: false };
  return { borderStyle: "solid", opacity: 1, strike: false, dim: false };
}

function SchedulingPage() {
  const { can, currentUser } = useAuth();
  const { showError } = useToast();
  const { clients, addDocument, removeDocument, getDocumentUrl } = useClients();
  const { inventory, stockOutMany } = useInventory();
  const { staff, technicians } = useUsers();
  const { appointments, createAppointment, updateAppointment, submitReport, addStockUsed, addAttachment, removeAttachment, getAttachmentUrl, uploadSignature, getSignatureUrl, loading, error } = useScheduling();
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("week");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [tab, setTab] = useState("Overview");
  const [draggedId, setDraggedId] = useState(null);
  const [message, setMessage] = useState("");
  const [stockRows, setStockRows] = useState(STOCK_CATEGORIES.map((category) => ({ id: `stock-row-${category}`, category, itemId: "", amount: "", batchNumber: "" })));
  const [createOpen, setCreateOpen] = useState(false);
  const [createClientId, setCreateClientId] = useState("");
  const [overflowGroup, setOverflowGroup] = useState(null);
  const [printRequest, setPrintRequest] = useState(null);
  const [treatmentMethods, setTreatmentMethods] = useState([]);
  const [appointmentSearch, setAppointmentSearch] = useState("");
  const [scheduleTab, setScheduleTab] = useState("calendar");
  const [technicianFilter, setTechnicianFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");
  const [pestConcernFilter, setPestConcernFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const draggedCardRef = useRef(false);

  // Two separate rights, and they do not line up:
  //   reschedule - moving a visit is an office decision, so technicians never
  //                drag, not even their own appointments.
  //   file       - the technician who was actually on site is the one who
  //                writes the report and records materials, so that stays.
  const isTechnician = currentUser?.role === ROLES.TECHNICIAN;
  const canReschedule = !isTechnician;
  const ownsAppointment = (appointment) => !isTechnician || appointment?.technicianId === currentUser?.id;

  const selected = appointments.find((appointment) => appointment.id === selectedId && ownsAppointment(appointment)) || null;
  const selectedClient = clients.find((client) => client.id === selected?.clientId) || null;
  const activeAccounts = useMemo(
    () => [...staff, ...technicians].filter((account) => account.status !== ACCOUNT_STATUS.INACTIVE),
    [staff, technicians]
  );
  // Colour is keyed off the technician list order so it stays stable between
  // renders and across the week.
  const technicianColors = useMemo(() => {
    const map = new Map();
    technicians.forEach((account, index) => map.set(account.id, TECHNICIAN_PALETTE[index % TECHNICIAN_PALETTE.length]));
    return map;
  }, [technicians]);
  const colorFor = (appointment) => technicianColors.get(appointment.technicianId) || UNASSIGNED_COLOR;

  useEffect(() => {
    setTreatmentMethods(selected?.treatmentMethods || []);
  }, [selectedId, selected?.treatmentMethods]);

  const toggleTreatmentMethod = (value) => {
    setTreatmentMethods((current) => current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]);
  };

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const weekStart = startOfWeek(anchorDate);
  const weekStartTime = weekStart.getTime();
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(new Date(weekStartTime), index)),
    [weekStartTime]
  );
  const monthCells = useMemo(() => {
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [anchorDate]);
  const visibleAppointments = useMemo(() => {
    const term = appointmentSearch.trim().toLowerCase();
    return appointments.filter((appointment) => {
      // Technicians see only what is assigned to them. Not a default, not a
      // filter they can widen — nothing else in this list can reach past it.
      if (isTechnician && appointment.technicianId !== currentUser?.id) return false;
      const client = clients.find((entry) => entry.id === appointment.clientId);
      const technician = activeAccounts.find((account) => account.id === appointment.technicianId);
      const text = `${appointment.id} ${client?.name || ""} ${client?.address || ""} ${appointment.pestConcern || ""} ${appointment.status} ${technician?.name || technician?.username || ""}`.toLowerCase();
      return (!term || text.includes(term))
        && (technicianFilter === "ALL" || appointment.technicianId === technicianFilter)
        && (statusFilter === "ALL" || appointment.status === statusFilter)
        && (clientFilter === "ALL" || appointment.clientId === clientFilter)
        && (pestConcernFilter === "ALL" || appointment.pestConcern === pestConcernFilter)
        // Compared as local date keys so a boundary date includes the whole day
        // regardless of the appointment's time.
        && (!dateFrom || localDateKey(new Date(appointment.scheduledAt)) >= dateFrom)
        && (!dateTo || localDateKey(new Date(appointment.scheduledAt)) <= dateTo);
    });
  }, [appointments, appointmentSearch, clients, activeAccounts, technicianFilter, statusFilter, clientFilter, pestConcernFilter, dateFrom, dateTo, isTechnician, currentUser?.id]);

  const pestConcernOptions = useMemo(
    () => Array.from(new Set(appointments.filter(ownsAppointment).map((appointment) => appointment.pestConcern).filter(Boolean))).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, isTechnician, currentUser?.id]
  );

  // One layout pass per visible day, not per card. Appointments starting
  // outside the rendered hours are counted separately so they can be flagged
  // in the day header rather than silently dropped.
  const weekLayout = useMemo(() => {
    const byDay = new Map();
    weekDays.forEach((date) => byDay.set(localDateKey(date), { inRange: [], outside: [] }));

    visibleAppointments.forEach((appointment) => {
      const date = new Date(appointment.scheduledAt);
      const bucket = byDay.get(localDateKey(date));
      if (!bucket) return;
      if (date.getHours() < DAY_START_HOUR || date.getHours() >= DAY_END_HOUR) bucket.outside.push(appointment);
      else bucket.inRange.push(appointment);
    });

    const result = new Map();
    byDay.forEach((bucket, key) => {
      result.set(key, {
        ...layoutDayAppointments(bucket.inRange, { maxColumns: MAX_CARD_COLUMNS }),
        outside: bucket.outside,
      });
    });
    return result;
  }, [weekDays, visibleAppointments]);

  /** Minutes from the top of the rendered day, clamped to the grid. */
  const minutesFromGridStart = (value) => {
    const date = new Date(value);
    return date.getHours() * 60 + date.getMinutes() - DAY_START_HOUR * 60;
  };

  const columnPlacement = (column, columns) => ({
    left: `calc(${(column / columns) * 100}% + 0.25rem)`,
    width: `calc(${100 / columns}% - 0.5rem)`,
  });

  const spanGeometry = (startValue, endValue) => {
    const top = (minutesFromGridStart(startValue) / 60) * ROW_HEIGHT;
    const rawHeight = ((endValue - startValue) / 60000 / 60) * ROW_HEIGHT;
    return { top, height: Math.max(MIN_CARD_HEIGHT, rawHeight - 2) };
  };

  const moveAppointment = async (dateKey, time = "09:00") => {
    if (!draggedId) return;
    const current = appointments.find((appointment) => appointment.id === draggedId);
    if (!canReschedule) {
      setDraggedId(null);
      const refusal = "Rescheduling is handled by the office. Ask staff to move this visit.";
      showError(refusal);
      setMessage(refusal);
      return;
    }
    if (!current) {
      setDraggedId(null);
      return;
    }
    const nextScheduledAt = `${dateKey}T${time}:00`;
    const movedAppointment = { ...current, scheduledAt: nextScheduledAt, status: "Confirmed" };
    // Moving requires the Reschedule status first, so an appointment that cannot
    // reach Reschedule cannot be dragged at all.
    if (!canTransition(current.status, "Reschedule")) {
      setDraggedId(null);
      const blockedMessage = `A ${current.status.toLowerCase()} appointment cannot be moved.`;
      showError(blockedMessage);
      setMessage(blockedMessage);
      return;
    }
    if (findTechnicianConflicts(appointments, movedAppointment).length > 0) {
      setDraggedId(null);
      const conflictMessage = "Schedule conflict: that technician is already booked during this time.";
      showError(conflictMessage);
      setMessage(conflictMessage);
      return;
    }
    if (current.status !== "Reschedule") {
      const prepareResult = await updateAppointment({ ...current, status: "Reschedule" });
      if (typeof prepareResult === "string") {
        setDraggedId(null);
        showError(prepareResult);
        setMessage(prepareResult);
        return;
      }
    }
    const result = await updateAppointment(movedAppointment);
    setDraggedId(null);
    if (typeof result === "string") showError(result);
    setMessage(typeof result === "string" ? result : `Moved appointment to ${formatDateTime(nextScheduledAt)}.`);
  };

  const navigateCalendar = (amount) => {
    const next = new Date(anchorDate);
    if (view === "week") next.setDate(next.getDate() + amount * 7);
    else next.setMonth(next.getMonth() + amount);
    setAnchorDate(next);
  };

  const handleManualSave = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextValue = form.get("scheduledAt");
    const result = await updateAppointment({
      ...selected,
      scheduledAt: new Date(nextValue).toISOString(),
      durationMinutes: readDuration(form),
      pestConcern: form.get("pestConcern"),
      serviceType: form.get("serviceType") || "",
      serviceLocation: form.get("serviceLocation") || "",
      technicianId: form.get("technicianId"),
      status: form.get("status"),
      notes: form.get("notes"),
      cancellationReason: form.get("cancellationReason") || "",
    });
    if (typeof result === "string") showError(result);
    setMessage(typeof result === "string" ? result : "Appointment details updated.");
  };

  const handleTimingSave = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await updateAppointment({
      ...selected,
      durationMinutes: readDuration(form),
      pestConcern: form.get("pestConcern"),
    });
    if (typeof result === "string") showError(result);
    setMessage(typeof result === "string" ? result : "Appointment timing updated.");
  };

  /**
   * One handler for both buttons. `confirmation` is null for a plain save —
   * which stores the report and leaves the appointment's status alone — or
   * carries the customer's signature, or an office override reason.
   */
  const handleReportSubmit = async (formElement, confirmation = null) => {
    const form = new FormData(formElement);
    const report = {
      findings: (form.get("findings") || "").trim(),
      treatmentPerformed: (form.get("treatmentPerformed") || "").trim(),
      recommendations: (form.get("recommendations") || "").trim(),
      followUpDate: form.get("followUpDate") || "",
      treatmentMethods,
    };
    if (!report.findings) {
      showError("Inspection findings are required.");
      return;
    }
    if (treatmentMethods.length === 0 && !report.treatmentPerformed) {
      showError("Record the treatment: tick at least one method, or describe it in the notes.");
      return;
    }

    // The signature image is uploaded first; only its object key reaches the
    // report, so a failed upload never completes a visit.
    if (confirmation?.signatureFile) {
      const upload = await uploadSignature(selected.id, confirmation.signatureFile);
      if (upload.error) {
        showError(upload.error);
        return;
      }
      report.signaturePath = upload.storagePath;
      report.customerName = confirmation.customerName;
    }
    if (confirmation?.completionNote) report.completionNote = confirmation.completionNote;

    const result = await submitReport(selected.id, report);
    if (typeof result === "string") {
      showError(result);
      setMessage(result);
      return;
    }
    setMessage(confirmation
      ? "Completion confirmed. Service marked Completed."
      : "Report saved. Confirm completion with the customer's signature to close this visit.");
  };

  const printServiceForm = (appointment) => {
    const client = clients.find((entry) => entry.id === appointment.clientId);
    if (!client) {
      showError("That client could not be loaded, so the form cannot be printed.");
      return;
    }
    setPrintRequest({
      appointment,
      client,
      technician: activeAccounts.find((account) => account.id === appointment.technicianId) || null,
    });
  };

  const scheduleFollowUp = () => {
    setCreateClientId(selected.clientId);
    setCreateOpen(true);
  };

  const handleStockSubmit = async (event) => {
    event.preventDefault();
    const entries = stockRows.filter((row) => row.itemId).map((row) => ({ itemId: row.itemId, amount: Number(row.amount), batchNumber: (row.batchNumber || "").trim() }));
    // Decimals are the point of migration 036: applying 0.4 L is the honest
    // number, and the whole-number rule now applies only to stock coming IN.
    if (entries.length === 0 || entries.some((entry) => !Number.isFinite(entry.amount) || entry.amount <= 0)) {
      setMessage("Select at least one item and enter a quantity greater than zero.");
      return;
    }
    if (new Set(entries.map((entry) => entry.itemId)).size !== entries.length) {
      setMessage("Select each inventory item only once per stock-out.");
      return;
    }
    const result = await stockOutMany(selected.id, entries);
    if (typeof result === "string") {
      showError(result);
      setMessage(result);
      return;
    }
    entries.forEach((entry) => {
      const item = inventory.find((candidate) => candidate.id === entry.itemId);
      addStockUsed(selected.id, { itemId: entry.itemId, name: item?.name || "Inventory item", amount: entry.amount, unit: item?.unit || "", batchNumber: entry.batchNumber, date: new Date().toISOString().slice(0, 10) });
    });
    setStockRows(STOCK_CATEGORIES.map((category) => ({ id: `stock-row-${category}-${Date.now()}`, category, itemId: "", amount: "", batchNumber: "" })));
    setMessage(`${entries.length} stock item${entries.length === 1 ? "" : "s"} recorded as OUT for this appointment.`);
  };

  const handleCreate = async (fields) => {
    const result = await createAppointment(fields);
    if (typeof result === "string") return result;
    setCreateOpen(false);
    setSelectedId(result.id);
    setView("week");
    setAnchorDate(startOfWeek(new Date(result.scheduledAt)));
    setMessage("Appointment created.");
    return true;
  };

  // `height` is the card's real pixel height in the week grid. Content is
  // chosen to fit it, because the card clips — a 15-minute visit that tried to
  // render four stacked rows showed only the first one and lost its status.
  const renderAppointmentCard = (appointment, compact = false, placement = {}, height = null) => {
    const client = clients.find((entry) => entry.id === appointment.clientId);
    if (!client) return null;
    const selectedCard = appointment.id === selectedId;
    // Detail lives in the side panel now, so a block only needs two lines.
    const roomy = height === null || height >= 80;
    const tight = height !== null && height < 34;
    const tone = colorFor(appointment);
    const shape = statusShape(appointment.status);
    const technician = activeAccounts.find((account) => account.id === appointment.technicianId);
    const startLabel = new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const endLabel = new Date(endOf(appointment)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return (
      <button
        key={appointment.id}
        type="button"
        draggable={canReschedule}
        onDragStart={async () => {
          if (!canReschedule) return;
          draggedCardRef.current = false;
          setDraggedId(appointment.id);
          if (appointment.status !== "Reschedule") {
            const result = await updateAppointment({ ...appointment, status: "Reschedule" });
            if (typeof result === "string") setMessage(result);
          }
        }}
        onDragEnd={() => { draggedCardRef.current = true; setDraggedId(null); }}
        onClick={() => { if (draggedCardRef.current) { draggedCardRef.current = false; return; } setSelectedId(appointment.id); setTab("Overview"); }}
        title={`${client.name}
${startLabel} – ${endLabel} · ${formatDuration(appointment.durationMinutes || 60)}
${technician?.name || technician?.username || "Unassigned"} · ${appointment.status}${appointment.pestConcern ? ` · ${appointment.pestConcern}` : ""}`}
        style={{
          width: "100%", textAlign: "left", cursor: canReschedule ? "grab" : "pointer",
          border: `1px ${shape.borderStyle} ${selectedCard ? colors.brandLight : tone.bar}`,
          borderLeftWidth: "3px", borderLeftStyle: "solid", borderLeftColor: tone.bar,
          borderRadius: "6px",
          padding: tight ? "0.1rem 0.35rem" : "0.2rem 0.4rem",
          background: tone.fill,
          filter: shape.dim ? "saturate(0.55)" : "none",
          outline: selectedCard ? `2px solid ${colors.brandLight}` : "none",
          outlineOffset: "1px",
          boxShadow: selectedCard ? "0 4px 12px rgba(127,17,17,0.18)" : "none",
          position: "relative", zIndex: selectedCard ? 3 : 1,
          opacity: draggedId === appointment.id ? 0.45 : shape.opacity,
          ...placement,
        }}
      >
        {tight ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.25rem", overflow: "hidden", whiteSpace: "nowrap", color: tone.ink }}>
            <span style={{ fontWeight: 700, fontSize: "0.66rem", overflow: "hidden", textOverflow: "ellipsis", textDecoration: shape.strike ? "line-through" : "none" }}>{client.name}</span>
            <span style={{ fontSize: "0.6rem", opacity: 0.8, flex: "none" }}>{startLabel}</span>
          </div>
        ) : (
          <div style={{ color: tone.ink, overflow: "hidden" }}>
            <div style={{ fontWeight: 700, fontSize: compact ? "0.7rem" : "0.72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: shape.strike ? "line-through" : "none" }}>{client.name}</div>
            <div style={{ fontSize: "0.62rem", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{startLabel} – {endLabel}</div>
            {roomy && <div style={{ fontSize: "0.62rem", opacity: 0.7, marginTop: "0.1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{technician?.name || technician?.username || "Unassigned"}{appointment.pestConcern ? ` · ${appointment.pestConcern}` : ""}</div>}
          </div>
        )}
      </button>
    );
  };

  return (
    <div style={pageShell}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ color: colors.brand, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>Operations</div>
          <h1 style={{ margin: "0.25rem 0 0", color: colors.ink, fontSize: "2rem" }}>Scheduling</h1>
        </div>
        <button type="button" style={primaryButton} onClick={() => setCreateOpen(true)}><Plus size={16} /> New appointment</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1.25fr) minmax(360px, 0.75fr)" : "1fr", gap: "1.25rem", alignItems: "start" }}>
        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}><div style={{ display: "flex", gap: "0.35rem", background: "#f8fafc", padding: "0.25rem", borderRadius: "10px" }}>{(isTechnician ? ["calendar", "list"] : ["calendar", "list", "technicians"]).map((option) => <button key={option} type="button" onClick={() => setScheduleTab(option)} style={{ ...secondaryButton, border: "none", background: scheduleTab === option ? colors.brand : "transparent", color: scheduleTab === option ? "#fff" : colors.body, padding: "0.5rem 0.8rem" }}>{option === "calendar" ? "Calendar" : option === "list" ? "List" : "Technicians"}</button>)}</div><div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>{scheduleTab === "calendar" && !isTechnician && <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: colors.muted, fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Technician
            <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} style={{ ...inputStyle, width: "auto", minWidth: "190px", padding: "0.5rem 0.6rem", fontSize: "0.8rem", fontWeight: 600, textTransform: "none", letterSpacing: 0, color: colors.ink }}>
              <option value="ALL">All technicians</option>
              {technicians.map((account) => <option key={account.id} value={account.id}>{account.reference ? `${account.reference} — ` : ""}{account.name || account.username}</option>)}
              <option value="">Unassigned only</option>
            </select>
          </label>}{scheduleTab === "calendar" && <div style={{ display: "flex", gap: "0.4rem", background: "#f8fafc", padding: "0.25rem", borderRadius: "10px" }}>{['week', 'month'].map((option) => <button key={option} type="button" onClick={() => setView(option)} style={{ ...secondaryButton, border: "none", background: view === option ? colors.brand : "transparent", color: view === option ? "#fff" : colors.body, padding: "0.55rem 0.8rem" }}>{option === "week" ? "Week" : "Month"}</button>)}</div>}</div></div>
          {scheduleTab === "list" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.65rem", alignItems: "end", marginBottom: "1rem", padding: "0.85rem", background: "#fffafa", border: "1px solid #eadede", borderRadius: "10px" }}><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800, gridColumn: "span 2" }}>Search appointments<input value={appointmentSearch} onChange={(event) => setAppointmentSearch(event.target.value)} placeholder="Client, address, technician, pest concern, ID" style={inputStyle} /></label>{!isTechnician && <label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Technician<select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} style={inputStyle}><option value="ALL">All technicians</option>{technicians.map((account) => <option key={account.id} value={account.id}>{account.name || account.username}</option>)}</select></label>}<label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}><option value="ALL">All statuses</option>{APPOINTMENT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Client<select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} style={inputStyle}><option value="ALL">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Pest concern<select value={pestConcernFilter} onChange={(event) => setPestConcernFilter(event.target.value)} style={inputStyle}><option value="ALL">All pest concerns</option>{pestConcernOptions.map((concern) => <option key={concern} value={concern}>{concern}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Date from<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} style={inputStyle} /></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Date to<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} style={inputStyle} /></label>{(dateFrom || dateTo) && <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ ...secondaryButton, alignSelf: "end" }}>Clear dates</button>}</div>}
          {scheduleTab !== "list" && <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <button type="button" aria-label="Previous period" onClick={() => navigateCalendar(-1)} style={secondaryButton}><ChevronLeft size={16} /></button>
              <button type="button" aria-label="Next period" onClick={() => navigateCalendar(1)} style={secondaryButton}><ChevronRight size={16} /></button>
              <strong style={{ color: colors.ink }}>{scheduleTab === "technicians" || view === "week" ? `${weekStart.toLocaleDateString([], { month: "short", day: "numeric" })} - ${addDays(weekStart, 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : anchorDate.toLocaleDateString([], { month: "long", year: "numeric" })}</strong>
            </div>
          </div>}

          {scheduleTab === "list" ? <AppointmentListView appointments={visibleAppointments} clients={clients} accounts={activeAccounts} onSelect={(id) => { setSelectedId(id); setTab("Overview"); }} /> : scheduleTab === "technicians" ? <TechnicianAvailability accounts={isTechnician ? technicians.filter((account) => account.id === currentUser?.id) : technicians} appointments={visibleAppointments} weekDays={weekDays} clients={clients} /> : (view === "week" ? (
            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 20rem)", minHeight: "26rem", border: "1px solid #eadede", borderRadius: "10px" }}>
              <div style={{ minWidth: "780px", display: "grid", gridTemplateColumns: "64px repeat(7, minmax(95px, 1fr))" }}>
                {/* Header row stays put while the hours scroll under it. */}
                <div style={{ position: "sticky", top: 0, zIndex: 3, background: "#fffafa", borderBottom: "1px solid #eadede", borderRight: "1px solid #eadede" }} />
                {weekDays.map((date) => {
                  const key = localDateKey(date);
                  const outside = weekLayout.get(key)?.outside || [];
                  return <div key={key} style={{ position: "sticky", top: 0, zIndex: 3, padding: "0.6rem 0.35rem", textAlign: "center", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", background: key === localDateKey(new Date()) ? "#fff1f1" : "#fffafa" }}>
                    <div style={{ color: colors.muted, fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase" }}>{date.toLocaleDateString([], { weekday: "short" })}</div>
                    <div style={{ color: colors.ink, fontSize: "1.05rem", fontWeight: 800 }}>{date.getDate()}</div>
                    {outside.length > 0 && <div title={outside.map((entry) => `${clients.find((client) => client.id === entry.clientId)?.name || "Appointment"} at ${new Date(entry.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`).join("\n")} style={{ marginTop: "0.25rem", display: "inline-block", background: "#fff7ed", color: "#c2410c", borderRadius: "999px", padding: "0.1rem 0.4rem", fontSize: "0.6rem", fontWeight: 800 }}>{outside.length} outside {formatTime(`${String(DAY_START_HOUR).padStart(2, "0")}:00`)}–{formatTime(`${String(DAY_END_HOUR).padStart(2, "0")}:00`)}</div>}
                  </div>;
                })}

                {/* Hour labels down the gutter. */}
                <div style={{ borderRight: "1px solid #eadede" }}>
                  {HOURS.map((hour) => <div key={hour} style={{ height: `${ROW_HEIGHT}px`, boxSizing: "border-box", borderBottom: "1px solid #eadede", color: colors.muted, fontSize: "0.65rem", padding: "0.25rem 0.4rem", textAlign: "right", fontWeight: 700 }}>{formatTime(`${String(hour).padStart(2, "0")}:00`)}</div>)}
                </div>

                {/* One positioned layer per day: a card spans its real duration
                    instead of being trapped inside its starting hour. */}
                {weekDays.map((date) => {
                  const key = localDateKey(date);
                  const layout = weekLayout.get(key) || { placed: [], overflow: [] };
                  return <div
                    key={key}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      const bounds = event.currentTarget.getBoundingClientRect();
                      const rawMinutes = ((event.clientY - bounds.top) / ROW_HEIGHT) * 60 + DAY_START_HOUR * 60;
                      const snapped = Math.min(DAY_END_HOUR * 60 - 10, Math.max(DAY_START_HOUR * 60, Math.round(rawMinutes / 10) * 10));
                      moveAppointment(key, `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`);
                    }}
                    style={{
                      position: "relative",
                      height: `${HOURS.length * ROW_HEIGHT}px`,
                      borderRight: "1px solid #f4eceb",
                      background: draggedId ? "#fffdfd" : "#fff",
                      backgroundImage: `repeating-linear-gradient(to bottom, #ece4e3 0px, #ece4e3 1px, transparent 1px, transparent ${ROW_HEIGHT}px)`,
                    }}
                  >
                    {layout.placed.map(({ appointment, column, columns }) => {
                      const { top, height } = spanGeometry(startOf(appointment), endOf(appointment));
                      return renderAppointmentCard(appointment, false, {
                        position: "absolute",
                        top: `${top + 1}px`,
                        height: `${height}px`,
                        ...columnPlacement(column, columns),
                        overflow: "hidden",
                      }, height);
                    })}
                    {key === localDateKey(now) && now.getHours() >= DAY_START_HOUR && now.getHours() < DAY_END_HOUR && <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: `${(minutesFromGridStart(now) / 60) * ROW_HEIGHT}px`, height: "2px", background: colors.brand, zIndex: 4 }}>
                      <span style={{ position: "absolute", left: "-4px", top: "-4px", width: "10px", height: "10px", borderRadius: "50%", background: colors.brand }} />
                    </div>}
                    {layout.overflow.map((group) => {
                      const { top, height } = spanGeometry(group.start, group.end);
                      return <button
                        key={group.id}
                        type="button"
                        onClick={() => setOverflowGroup({ ...group, dateKey: key })}
                        style={{
                          position: "absolute",
                          top: `${top + 1}px`,
                          height: `${height}px`,
                          ...columnPlacement(group.column, group.columns),
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.1rem",
                          border: "1px dashed #d8b4b4", borderRadius: "10px", background: "#fff6f6",
                          color: colors.brandInk, fontWeight: 800, fontSize: "0.68rem", cursor: "pointer", overflow: "hidden", zIndex: 1,
                        }}
                      >
                        +{group.items.length} more
                        {height >= 44 && <span style={{ color: colors.muted, fontWeight: 600, fontSize: "0.6rem" }}>tap to view</span>}
                      </button>;
                    })}
                  </div>;
                })}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(90px, 1fr))", overflowX: "auto", minWidth: "680px", borderTop: "1px solid #eadede", borderLeft: "1px solid #eadede" }}>
              {monthCells.map((date) => { const key = localDateKey(date); const entries = visibleAppointments.filter((appointment) => localDateKey(new Date(appointment.scheduledAt)) === key); return <div key={key} onDragOver={(event) => event.preventDefault()} onDrop={() => moveAppointment(key)} style={{ minHeight: "112px", padding: "0.45rem", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", background: date.getMonth() === anchorDate.getMonth() ? "#fff" : "#fafafa" }}><div style={{ color: date.getMonth() === anchorDate.getMonth() ? colors.ink : "#a3a3a3", fontWeight: 800, fontSize: "0.75rem", marginBottom: "0.3rem" }}>{date.getDate()}</div><div style={{ display: "grid", gap: "0.3rem" }}>{entries.map((appointment) => renderAppointmentCard(appointment, true))}</div></div>; })}
            </div>
          ))}
          {view === "week" && <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.75rem" }}>
            {technicians.map((account) => {
              const active = technicianFilter === account.id;
              return <button key={account.id} type="button" disabled={isTechnician} onClick={() => setTechnicianFilter(active ? "ALL" : account.id)} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", border: `1px solid ${active ? colors.brand : "transparent"}`, background: active ? "#fff1f1" : "transparent", borderRadius: "999px", padding: "0.15rem 0.5rem 0.15rem 0.35rem", color: active ? colors.brandInk : colors.muted, fontSize: "0.7rem", fontWeight: active ? 800 : 600, cursor: isTechnician ? "default" : "pointer" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: technicianColors.get(account.id)?.bar }} />{account.name || account.username}
              </button>;
            })}
            <button type="button" disabled={isTechnician} onClick={() => setTechnicianFilter(technicianFilter === "" ? "ALL" : "")} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", border: `1px solid ${technicianFilter === "" ? colors.brand : "transparent"}`, background: technicianFilter === "" ? "#fff1f1" : "transparent", borderRadius: "999px", padding: "0.15rem 0.5rem 0.15rem 0.35rem", color: technicianFilter === "" ? colors.brandInk : colors.muted, fontSize: "0.7rem", fontWeight: technicianFilter === "" ? 800 : 600, cursor: isTechnician ? "default" : "pointer" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: UNASSIGNED_COLOR.bar }} />Unassigned
            </button>
            {technicianFilter !== "ALL" && !isTechnician && <button type="button" onClick={() => setTechnicianFilter("ALL")} style={{ border: 0, background: "none", color: colors.brand, fontSize: "0.7rem", fontWeight: 800, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Show all</button>}
            <span style={{ color: colors.muted, fontSize: "0.7rem", borderLeft: "1px solid #eadede", paddingLeft: "0.9rem" }}>Dashed outline = Pending · dotted = Reschedule · faded = Completed or Cancelled</span>
          </div>}
          <div style={{ display: "flex", gap: "1rem", color: colors.muted, fontSize: "0.72rem", marginTop: "0.6rem", alignItems: "center" }}>{canReschedule ? <><GripVertical size={14} /> Drag any appointment to reschedule it. Dropping it saves the new time as Confirmed.</> : <><Lock size={14} /> This is your assigned schedule. Contact the office to change a visit — you can still file reports and materials from the Report and Stock-Out tabs.</>}</div>
          {loading && <div role="status" style={{ marginTop: "0.75rem", color: colors.muted, fontWeight: 700, fontSize: "0.82rem" }}>Loading appointments...</div>}
          {(message || error) && <div role="status" style={{ marginTop: "0.75rem", color: error ? colors.danger : colors.success, fontWeight: 700, fontSize: "0.82rem" }}>{error || message}</div>}
          {clients.length === 0 && <div style={{ padding: "2rem 1rem", textAlign: "center", color: colors.muted }}>Client profiles will appear here once they are loaded.</div>}
          {appointmentSearch && visibleAppointments.length === 0 && <div style={{ padding: "1rem", textAlign: "center", color: colors.muted }}>No appointments match this search.</div>}
        </section>

        {selected && selectedClient && <AppointmentPanel key={`${selected.id}-${selected.status}-${selected.updatedAt || ""}`} appointment={selected} client={selectedClient} tab={tab} setTab={setTab} activeAccounts={technicians} appointments={appointments} canReschedule={canReschedule} canFileService={ownsAppointment(selected)} getSignatureUrl={getSignatureUrl} treatmentMethods={treatmentMethods} onToggleMethod={toggleTreatmentMethod} onPrintServiceForm={() => printServiceForm(selected)} onProblem={showError} assignedName={activeAccounts.find((account) => account.id === selected.technicianId)?.name || activeAccounts.find((account) => account.id === selected.technicianId)?.username || "another technician"} canUpload={can("clientDocuments", "create") && ownsAppointment(selected)} canRemove={can("clientDocuments", "delete") && ownsAppointment(selected)} addDocument={addDocument} removeDocument={removeDocument} getDocumentUrl={getDocumentUrl} addAttachment={addAttachment} removeAttachment={removeAttachment} getAttachmentUrl={getAttachmentUrl} onSave={handleManualSave} onTimingSave={handleTimingSave} onReportSubmit={handleReportSubmit} onStockSubmit={handleStockSubmit} onScheduleFollowUp={scheduleFollowUp} inventory={inventory} stockRows={stockRows} setStockRows={setStockRows} onClose={() => setSelectedId(null)} />}
      </div>
      <ServiceReportPrinter request={printRequest} onDone={() => setPrintRequest(null)} onProblem={showError} getAttachmentUrl={getAttachmentUrl} getSignatureUrl={getSignatureUrl} />
      {createOpen && <CreateAppointmentModalV2 clients={clients} activeAccounts={technicians} initialClientId={createClientId} onClose={() => { setCreateOpen(false); setCreateClientId(""); }} onCreate={handleCreate} />}
      {overflowGroup && <div role="dialog" aria-modal="true" onClick={() => setOverflowGroup(null)} style={{ position: "fixed", inset: 0, zIndex: 40, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.42)" }}>
        <section onClick={(event) => event.stopPropagation()} style={{ ...card, width: "min(100%, 460px)", maxHeight: "80vh", overflowY: "auto", padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
            <div>
              <div style={{ color: colors.brand, fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Also booked</div>
              <h2 style={{ margin: "0.25rem 0 0", color: colors.ink, fontSize: "1.15rem" }}>{new Date(overflowGroup.start).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h2>
              <div style={{ color: colors.muted, fontSize: "0.78rem" }}>{overflowGroup.items.length} more between {new Date(overflowGroup.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} and {new Date(overflowGroup.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
            </div>
            <button type="button" aria-label="Close list" onClick={() => setOverflowGroup(null)} style={{ ...secondaryButton, padding: "0.4rem 0.55rem" }}><X size={16} /></button>
          </div>
          <div style={{ display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
            {overflowGroup.items.map((appointment) => {
              const client = clients.find((entry) => entry.id === appointment.clientId);
              return <button key={appointment.id} type="button" onClick={() => { setSelectedId(appointment.id); setTab("Overview"); setOverflowGroup(null); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", textAlign: "left", padding: "0.65rem 0.75rem", background: "#fff", border: "1px solid #e8d9d9", borderLeft: `3px solid ${statusAccent(appointment.status)}`, borderRadius: "10px", cursor: "pointer" }}>
                <div>
                  <div style={{ color: colors.ink, fontWeight: 800, fontSize: "0.85rem" }}>{client?.name || "Unknown client"}</div>
                  <div style={{ color: colors.muted, fontSize: "0.72rem" }}>{new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {formatDuration(appointment.durationMinutes || 60)} · {appointment.pestConcern || "Inspection"}</div>
                </div>
                <span style={badgeStyle(appointment.status)}>{appointment.status}</span>
              </button>;
            })}
          </div>
        </section>
      </div>}
    </div>
  );
}

function AppointmentOverviewForm({ appointment, client, activeAccounts, busyTechnicians, appointments, onSave }) {
  const hours = Math.floor((appointment.durationMinutes || 60) / 60);
  const minutes = (appointment.durationMinutes || 60) % 60;
  const [technicianId, setTechnicianId] = useState(appointment.technicianId || "");
  const [status, setStatus] = useState(appointment.status);
  const conflicts = findTechnicianConflicts(appointments, { ...appointment, technicianId });
  const statusOptions = allowedNextStatuses(appointment.status);
  const labelStyle = { fontSize: "0.76rem", color: colors.muted };
  const hintStyle = { color: colors.muted, fontSize: "0.7rem" };
  const isBusy = (accountId) => busyTechnicians.has(accountId) && accountId !== appointment.technicianId;

  return <form onSubmit={onSave} style={{ display: "grid", gap: "1rem" }}>
    <InfoRow icon={<UserRound size={15} />} label="Client contact" value={`${client.phone || "No phone"} ${client.email ? `• ${client.email}` : ""}`} />
    <InfoRow icon={<MapPin size={15} />} label="Service address" value={appointment.serviceLocation || client.address || "No address"} />
    <InfoRow icon={<UserRound size={15} />} label="Classification" value={client.classificationOther || client.classification || "Not classified"} />
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Date and time</strong><input name="scheduledAt" type="datetime-local" defaultValue={toDateTimeLocal(appointment.scheduledAt)} style={inputStyle} />{appointment.status !== "Reschedule" && <span style={hintStyle}>Set the status to Reschedule before changing the date, time, or duration.</span>}</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontSize: "0.72rem", fontWeight: 700 }}>Hours<input name="durationHours" type="number" min="0" max="24" defaultValue={hours} style={{ ...inputStyle, padding: "0.55rem" }} required /></label><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontSize: "0.72rem", fontWeight: 700 }}>Minutes<input name="durationMinutes" type="number" min="0" max="59" defaultValue={minutes} style={{ ...inputStyle, padding: "0.55rem" }} required /></label></div>
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Technician</strong><select name="technicianId" value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} style={inputStyle}><option value="">Unassigned</option>{activeAccounts.map((account) => <option key={account.id} value={account.id} disabled={isBusy(account.id)}>{account.reference ? `${account.reference} — ` : ""}{account.name || account.username}{isBusy(account.id) ? " - busy at this time" : ""}</option>)}</select>{conflicts.length > 0 && <span style={{ color: colors.danger, fontSize: "0.72rem", fontWeight: 700 }}>Conflict: this technician overlaps another appointment.</span>}</div>
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Service type</strong><select name="serviceType" defaultValue={appointment.serviceType || ""} style={inputStyle}><option value="">Select a service type</option>{SERVICE_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Service location</strong><input name="serviceLocation" defaultValue={appointment.serviceLocation || ""} placeholder={client.address || "Client address"} style={inputStyle} /><span style={hintStyle}>Leave blank to use the client's address.</span></div>
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Pest concern</strong><select name="pestConcern" defaultValue={appointment.pestConcern || ""} style={inputStyle}><option value="">Select a pest concern</option>{PEST_CONCERN_SUGGESTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Status</strong><select name="status" value={status} onChange={(event) => setStatus(event.target.value)} style={inputStyle}>{statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>{statusOptions.length === 1 && <span style={hintStyle}>A {appointment.status.toLowerCase()} appointment cannot change status.</span>}</div>
    {status === "Cancelled" && <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Cancellation reason (optional)</strong><textarea name="cancellationReason" defaultValue={appointment.cancellationReason || ""} rows={2} placeholder="Why is this appointment being cancelled?" style={{ ...inputStyle, resize: "vertical" }} /></div>}
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Visit notes</strong><textarea name="notes" defaultValue={appointment.notes} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></div>
    <button type="submit" style={primaryButton}><Check size={15} /> Save appointment</button>
  </form>;
}

function AppointmentListView({ appointments, clients, accounts, onSelect }) {
  return <div style={{ overflowX: "auto", border: "1px solid #eadede", borderRadius: "10px" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
      <thead><tr style={{ background: "#fffafa" }}>{["Date and time", "Client", "Technician", "Pest concern", "Status"].map((label) => <th key={label} style={{ padding: "0.75rem", color: colors.muted, fontSize: "0.7rem", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #eadede" }}>{label}</th>)}</tr></thead>
      <tbody>{appointments.map((appointment) => {
        const client = clients.find((entry) => entry.id === appointment.clientId);
        const technician = accounts.find((entry) => entry.id === appointment.technicianId);
        return <tr key={appointment.id} onClick={() => onSelect(appointment.id)} style={{ cursor: "pointer" }}>
          <td style={{ padding: "0.8rem 0.75rem", color: colors.ink, fontWeight: 700, borderBottom: "1px solid #f1e7e7" }}>{formatDateTime(appointment.scheduledAt)}</td>
          <td style={{ padding: "0.8rem 0.75rem", color: colors.body, borderBottom: "1px solid #f1e7e7" }}>{client?.name || "Unknown client"}</td>
          <td style={{ padding: "0.8rem 0.75rem", color: colors.body, borderBottom: "1px solid #f1e7e7" }}>{technician?.name || technician?.username || "Unassigned"}</td>
          <td style={{ padding: "0.8rem 0.75rem", color: colors.body, borderBottom: "1px solid #f1e7e7" }}>{appointment.pestConcern || "Inspection"}</td>
          <td style={{ padding: "0.8rem 0.75rem", borderBottom: "1px solid #f1e7e7" }}><span style={badgeStyle(appointment.status)}>{appointment.status}</span></td>
        </tr>;
      })}</tbody>
    </table>
    {appointments.length === 0 && <div style={{ padding: "2rem", textAlign: "center", color: colors.muted }}>No appointments match the current filters.</div>}
  </div>;
}

const fieldsetReset = { border: 0, padding: 0, margin: 0, minWidth: 0 };

/**
 * The formal completion step. A report on its own is a draft; the visit only
 * closes when the customer signs, or when the office records why they could
 * not. Technicians never see the override.
 */
/**
 * The treatment as a checklist. Grouped so a long list stays scannable, with
 * the old free-text box kept underneath — a visit occasionally needs a sentence
 * that no fixed list will ever cover.
 */
function TreatmentMethods({ appointment, selected, onToggle }) {
  return <div style={{ display: "grid", gap: "0.6rem" }}>
    <div>
      <strong style={{ color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Treatment performed</strong>
      <div style={{ color: colors.muted, fontSize: "0.72rem" }}>
        Tick everything that was done. {selected.length > 0 ? `${selected.length} selected.` : "None selected yet."}
      </div>
    </div>

    <div style={{ display: "grid", gap: "0.55rem", padding: "0.7rem 0.8rem", border: "1px solid #eadede", borderRadius: "10px", background: "#fff" }}>
      {TREATMENT_METHOD_GROUPS.map((group) => <div key={group}>
        <div style={{ color: colors.muted, fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", borderBottom: "1px solid #f1e7e7", paddingBottom: "0.2rem", marginBottom: "0.3rem" }}>{group}</div>
        {TREATMENT_METHODS.filter((method) => method.group === group).map((method) => {
          const on = selected.includes(method.value);
          return <label key={method.value} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.2rem 0", fontSize: "0.79rem", color: on ? colors.ink : colors.body, fontWeight: on ? 700 : 400, cursor: "pointer" }}>
            <input type="checkbox" checked={on} onChange={() => onToggle(method.value)} style={{ marginTop: "0.2rem", accentColor: colors.brand }} />
            <span>{method.label}</span>
          </label>;
        })}
      </div>)}
    </div>

    <label style={{ display: "grid", gap: "0.3rem", color: colors.body, fontWeight: 700, fontSize: "0.78rem" }}>
      Additional treatment notes <span style={{ fontWeight: 400, color: colors.muted, fontSize: "0.72rem" }}>Optional — anything the list above does not cover.</span>
      <textarea name="treatmentPerformed" defaultValue={appointment.treatmentPerformed} rows={3} placeholder="e.g. Pipe chase behind the range needs sealing before the next visit." style={{ ...inputStyle, resize: "vertical", whiteSpace: "pre-wrap" }} />
    </label>
  </div>;
}

function CustomerConfirmation({ appointment, canOverride, onSubmit, onScheduleFollowUp, getSignatureUrl, onPrintServiceForm, onProblem }) {
  const padRef = useRef(null);
  const nameRef = useRef(null);
  const [customerName, setCustomerName] = useState(appointment.customerName || "");
  const [hasInk, setHasInk] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");

  const alreadySigned = Boolean(appointment.signaturePath);
  const closed = appointment.status === "Completed";

  useEffect(() => {
    let cancelled = false;
    if (!appointment.signaturePath) { setSignatureUrl(""); return undefined; }
    getSignatureUrl(appointment.signaturePath).then((result) => {
      if (!cancelled && result?.url) setSignatureUrl(result.url);
    });
    return () => { cancelled = true; };
  }, [appointment.signaturePath, getSignatureUrl]);

  const run = async (formElement, confirmation) => {
    if (!formElement) return;
    setBusy(true);
    await onSubmit(formElement, confirmation);
    setBusy(false);
  };

  const confirmCompletion = async (event) => {
    // Grab the form before awaiting: the synthetic event's currentTarget is
    // gone by the time toFile() resolves.
    const formElement = event.currentTarget.form;
    setBusy(true);
    const signatureFile = await padRef.current?.toFile();
    if (!signatureFile) {
      setBusy(false);
      onProblem?.("The signature could not be read from the pad. Please ask the customer to sign again.");
      return;
    }
    try {
      await onSubmit(formElement, { signatureFile, customerName: customerName.trim() });
    } finally {
      setBusy(false);
    }
  };

  const labelStyle = { color: colors.body, fontWeight: 700, fontSize: "0.82rem" };
  const readyToConfirm = hasInk && agreed && customerName.trim().length > 0 && !busy;
  const missing = [
    customerName.trim() ? null : "the customer's name",
    hasInk ? null : "a signature",
    agreed ? null : "the confirmation tick",
  ].filter(Boolean);

  return <div style={{ display: "grid", gap: "0.85rem", paddingTop: "1rem", marginTop: "0.25rem", borderTop: "1px solid #eadede" }}>
    <div>
      <h3 style={{ margin: 0, color: colors.ink, fontSize: "0.95rem" }}>Customer confirmation</h3>
      <p style={{ margin: "0.2rem 0 0", color: colors.muted, fontSize: "0.74rem" }}>
        {closed ? "This service is closed." : "The visit is not complete until the customer confirms the work, or the office records why they could not sign."}
      </p>
    </div>

    {alreadySigned ? (
      <div style={{ padding: "0.8rem", borderRadius: "10px", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
        {signatureUrl
          ? <img src={signatureUrl} alt="Customer signature" style={{ display: "block", maxWidth: "100%", maxHeight: "130px", background: "#fff", borderRadius: "6px" }} />
          : <div style={{ color: colors.muted, fontSize: "0.76rem" }}>Loading signature…</div>}
        <div style={{ marginTop: "0.5rem", color: "#166534", fontWeight: 700, fontSize: "0.8rem" }}>
          Signed by {appointment.customerName || "the customer"}
        </div>
        {appointment.signedAt && <div style={{ color: colors.muted, fontSize: "0.72rem" }}>{formatDateTime(appointment.signedAt)}</div>}
      </div>
    ) : appointment.completionNote ? (
      <div style={{ padding: "0.8rem", borderRadius: "10px", background: "#fff7ed", border: "1px solid #fed7aa" }}>
        <div style={{ color: "#9a3412", fontWeight: 700, fontSize: "0.8rem" }}>Completed without a customer signature</div>
        <div style={{ marginTop: "0.25rem", color: colors.body, fontSize: "0.78rem", whiteSpace: "pre-wrap" }}>{appointment.completionNote}</div>
      </div>
    ) : (
      <>
        <label style={{ display: "grid", gap: "0.35rem", ...labelStyle }}>
          Customer name
          <input ref={nameRef} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Printed name of the person signing" style={{ ...inputStyle, borderColor: customerName.trim() || !hasInk ? undefined : "#e11d48" }} />
        </label>
        <SignaturePad ref={padRef} onChange={setHasInk} />
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", color: colors.body, fontSize: "0.78rem" }}>
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} style={{ marginTop: "0.15rem" }} />
          <span>The customer confirms the service described above was performed.</span>
        </label>
      </>
    )}

    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
      <button type="button" onClick={(event) => run(event.currentTarget.form, null)} disabled={busy} style={{ ...secondaryButton, opacity: busy ? 0.6 : 1 }}>
        <Check size={15} /> {appointment.reportSubmitted ? "Update report" : "Save report"}
      </button>
      {!alreadySigned && !appointment.completionNote && (
        <button type="button" onClick={confirmCompletion} disabled={!readyToConfirm} style={{ ...primaryButton, opacity: readyToConfirm ? 1 : 0.5, cursor: readyToConfirm ? "pointer" : "default" }}>
          <ShieldCheck size={15} /> Confirm completion
        </button>
      )}
      {appointment.followUpDate && <button type="button" onClick={onScheduleFollowUp} style={secondaryButton}>Schedule follow-up</button>}
    </div>

    {!alreadySigned && !appointment.completionNote && missing.length > 0 && <button
      type="button"
      onClick={() => nameRef.current?.focus()}
      style={{ display: "flex", gap: "0.45rem", alignItems: "center", textAlign: "left", width: "100%", padding: "0.55rem 0.7rem", marginTop: "-0.35rem", borderRadius: "9px", background: "#fef2f2", border: "1px solid #fecdd3", color: "#9f1239", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
    >
      <Lock size={13} style={{ flex: "none" }} />
      <span>Still needed: {missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.</span>
    </button>}

    {!alreadySigned && hasInk && <div style={{ display: "flex", gap: "0.45rem", alignItems: "flex-start", padding: "0.6rem 0.7rem", borderRadius: "9px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: "0.74rem", fontWeight: 600 }}>
      <Lock size={13} style={{ flex: "none", marginTop: "0.1rem" }} />
      <span>A signature has been drawn. <strong>Save report</strong> will not record it &mdash; press <strong>Confirm completion</strong> to store the signature and close the visit.</span>
    </div>}

    {appointment.reportSubmitted && <button type="button" onClick={onPrintServiceForm} style={{ ...secondaryButton, justifySelf: "start" }}>
      <Printer size={15} /> Generate service form PDF
    </button>}

    {!alreadySigned && !appointment.completionNote && canOverride && (
      overrideOpen ? (
        <div style={{ display: "grid", gap: "0.5rem", padding: "0.8rem", borderRadius: "10px", background: "#fffbeb", border: "1px solid #fde68a" }}>
          <strong style={{ ...labelStyle, fontSize: "0.78rem" }}>Why is there no customer signature?</strong>
          <textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={2} placeholder="e.g. Customer left before the treatment finished; confirmed by phone." style={{ ...inputStyle, resize: "vertical" }} />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" disabled={!overrideReason.trim() || busy} onClick={(event) => run(event.currentTarget.form, { completionNote: overrideReason.trim() })} style={{ ...primaryButton, opacity: overrideReason.trim() && !busy ? 1 : 0.5 }}>
              Complete without signature
            </button>
            <button type="button" onClick={() => setOverrideOpen(false)} style={secondaryButton}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOverrideOpen(true)} style={{ justifySelf: "start", border: 0, background: "none", color: colors.muted, fontSize: "0.74rem", textDecoration: "underline", cursor: "pointer", padding: 0 }}>
          Customer cannot sign? Complete with a written reason
        </button>
      )
    )}

    {appointment.reportSubmitted && <div style={{ color: closed ? colors.success : colors.muted, fontWeight: 700, fontSize: "0.78rem" }}>
      Report saved{appointment.reportSubmittedAt ? ` on ${formatDateTime(appointment.reportSubmittedAt)}` : ""}.{closed ? " Service is Completed." : " Not yet completed — awaiting confirmation."}
    </div>}
  </div>;
}

function AppointmentPanel({ appointment, client, tab, setTab, activeAccounts, appointments, canReschedule = true, canFileService = true, assignedName, getSignatureUrl, treatmentMethods, onToggleMethod, onPrintServiceForm, onProblem, canUpload, canRemove, addDocument, removeDocument, getDocumentUrl, addAttachment, removeAttachment, getAttachmentUrl, onSave, onTimingSave, onReportSubmit, onStockSubmit, onScheduleFollowUp, inventory, stockRows, setStockRows, onClose }) {
  const busyTechnicians = busyTechnicianIds(appointments, appointment);
  const notice = (text) => <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.7rem 0.8rem", marginBottom: "1rem", borderRadius: "10px", background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: "0.76rem", fontWeight: 600 }}>
    <Lock size={14} style={{ flex: "none", marginTop: "0.1rem" }} />
    <span>{text}</span>
  </div>;
  const scheduleNotice = !canReschedule && notice("Scheduling is handled by the office. Ask staff to change the time, technician, or status of this visit.");
  const serviceNotice = !canFileService && notice(`This visit is assigned to ${assignedName}. Only the assigned technician can file its report and materials.`);
  if (tab === "Overview") {
    return <aside style={{ ...card, padding: 0, overflowY: "auto", maxHeight: "calc(100vh - 2rem)", position: "sticky", top: "1rem", border: "1px solid #eadede", boxShadow: "0 14px 34px rgba(75, 18, 18, 0.12)" }}>
      <div style={{ padding: "1.25rem 1.25rem 1rem", background: "linear-gradient(135deg, #7f1111, #b43d3d)", color: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: "0.68rem", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Appointment detail</div><h2 style={{ margin: "0.3rem 0", fontSize: "1.35rem" }}>{client.name}</h2><div style={{ opacity: 0.85, fontSize: "0.78rem" }}>{formatDateTime(appointment.scheduledAt)}</div></div><button type="button" aria-label="Close appointment detail" onClick={onClose} style={{ border: 0, background: "transparent", color: "#fff", cursor: "pointer" }}><X size={18} /></button></div></div>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid #eadede" }}>{TAB_LABELS.map((label) => <button type="button" key={label} onClick={() => setTab(label)} style={{ flex: 1, minWidth: "88px", border: 0, borderBottom: tab === label ? `3px solid ${colors.brand}` : "3px solid transparent", padding: "0.8rem 0.35rem", background: "#fff", color: tab === label ? colors.brand : colors.muted, fontWeight: 800, fontSize: "0.72rem", cursor: "pointer" }}>{label}</button>)}</div>
      <div style={{ padding: "1.25rem", background: "#fffdfd" }}>{scheduleNotice}<fieldset disabled={!canReschedule} style={fieldsetReset}><AppointmentOverviewForm key={appointment.id} appointment={appointment} client={client} activeAccounts={activeAccounts} busyTechnicians={busyTechnicians} appointments={appointments} onSave={onSave} /></fieldset></div>
    </aside>;
  }
  return (
    <aside style={{ ...card, padding: 0, overflowY: "auto", maxHeight: "calc(100vh - 2rem)", position: "sticky", top: "1rem", border: "1px solid #eadede", boxShadow: "0 14px 34px rgba(75, 18, 18, 0.12)" }}>
      <div style={{ padding: "1.25rem 1.25rem 1rem", background: "linear-gradient(135deg, #7f1111, #b43d3d)", color: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: "0.68rem", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Appointment detail</div><h2 style={{ margin: "0.3rem 0", fontSize: "1.35rem" }}>{client.name}</h2><div style={{ opacity: 0.85, fontSize: "0.78rem" }}>{formatDateTime(appointment.scheduledAt)}</div></div><button type="button" aria-label="Close appointment detail" onClick={onClose} style={{ border: 0, background: "transparent", color: "#fff", cursor: "pointer" }}><X size={18} /></button></div></div>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid #eadede" }}>{TAB_LABELS.map((label) => <button type="button" key={label} onClick={() => setTab(label)} style={{ flex: 1, minWidth: "88px", border: 0, borderBottom: tab === label ? `3px solid ${colors.brand}` : "3px solid transparent", padding: "0.8rem 0.35rem", background: "#fff", color: tab === label ? colors.brand : colors.muted, fontWeight: 800, fontSize: "0.72rem", cursor: "pointer" }}>{label}</button>)}</div>
      <div style={{ padding: "1.25rem", maxHeight: "calc(100vh - 230px)", overflowY: "auto", background: "#fffdfd" }}>
        {serviceNotice}
        <fieldset disabled={!canFileService} style={fieldsetReset}>
        {tab === "Documents" && <div>
          <h2 style={{ marginTop: 0, marginBottom: "0.3rem", color: colors.body, fontSize: "1.05rem" }}>Client documents</h2>
          <p style={{ margin: "0 0 0.9rem", color: colors.muted, fontSize: "0.74rem" }}>Belongs to {client.name}, not to this visit. Photos and signed forms for this service go in the Report tab.</p>
          <div style={{ display: "grid", gap: "0.7rem" }}>
            {DOCUMENT_CATEGORIES.map((category) => <ClientDocuments
              key={category.value}
              compact
              title={category.label}
              uploadLabel={category.uploadLabel}
              documents={(client.documents || []).filter((document) => (document.category || "OTHER") === category.value)}
              canUpload={canUpload}
              canRemove={canRemove}
              onUpload={(file) => addDocument(client.id, file, category.value)}
              onRemove={(document) => removeDocument(client.id, document)}
              onResolveUrl={getDocumentUrl}
              emptyMessage="None uploaded yet."
            />)}
          </div>
        </div>}
        {tab === "Report" && <form onSubmit={(event) => event.preventDefault()} style={{ display: "grid", gap: "1rem" }}><div style={{ padding: "0.85rem", borderRadius: "10px", background: "#f8fafc", color: colors.muted, fontSize: "0.78rem" }}><FileText size={15} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} /> Required fields finalize this service. Recommendations and follow-up scheduling are optional.</div><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Inspection findings<textarea name="findings" defaultValue={appointment.report} rows={5} placeholder="What did the technician observe?" style={{ ...inputStyle, resize: "vertical", whiteSpace: "pre-wrap" }} required /></label><TreatmentMethods appointment={appointment} selected={treatmentMethods} onToggle={onToggleMethod} /><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Recommendations / follow-up notes<textarea name="recommendations" defaultValue={appointment.recommendations} rows={3} placeholder="Optional recommendations" style={{ ...inputStyle, resize: "vertical" }} /></label><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Follow-up date<input name="followUpDate" type="date" defaultValue={appointment.followUpDate} style={inputStyle} /></label><CustomerConfirmation appointment={appointment} canOverride={canReschedule} onSubmit={onReportSubmit} onScheduleFollowUp={onScheduleFollowUp} getSignatureUrl={getSignatureUrl} onPrintServiceForm={onPrintServiceForm} onProblem={onProblem} /></form>}
        {tab === "Report" && <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid #eadede" }}>
          <h2 style={{ marginTop: 0, marginBottom: "0.35rem", color: colors.body, fontSize: "1.05rem" }}>Report attachments</h2>
          <p style={{ margin: "0 0 0.9rem", color: colors.muted, fontSize: "0.74rem" }}>Files for this visit only. JPG, PNG, or PDF up to 5MB each.</p>
          <div style={{ display: "grid", gap: "0.7rem" }}>
            {ATTACHMENT_CATEGORIES.map((category) => <ClientDocuments
              key={category.value}
              compact
              title={category.label}
              uploadLabel={category.uploadLabel}
              documents={(appointment.attachments || []).filter((attachment) => (attachment.category || "OTHER") === category.value)}
              canUpload={canUpload}
              canRemove={canRemove && !appointment.reportSubmitted}
              onUpload={(file) => addAttachment(appointment.id, file, category.value)}
              onRemove={(attachment) => removeAttachment(attachment)}
              onResolveUrl={getAttachmentUrl}
              accept=".jpg,.jpeg,.png,.pdf"
              validate={validateAttachment}
              emptyMessage="None uploaded yet."
            />)}
          </div>
          {appointment.reportSubmitted && <div style={{ marginTop: "0.6rem", color: colors.muted, fontSize: "0.72rem" }}>The report is finalized, so existing attachments can no longer be removed.</div>}
        </div>}
        {tab === "Stock-Out" && <StockOutForm appointment={appointment} inventory={inventory} stockRows={stockRows} setStockRows={setStockRows} onSubmit={onStockSubmit} />}
        </fieldset>
      </div>
    </aside>
  );
}

function TechnicianAvailability({ accounts, appointments, weekDays, clients }) {
  return (
    <section style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid #eadede" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
        <div><div style={{ color: colors.brand, fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Dispatch</div><h2 style={{ margin: "0.25rem 0 0", color: colors.ink, fontSize: "1.1rem" }}>Technician availability</h2></div>
        <span style={{ color: colors.muted, fontSize: "0.75rem" }}>Booked times are shown from saved appointments.</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: "700px", display: "grid", gridTemplateColumns: "150px repeat(7, minmax(80px, 1fr))", borderTop: "1px solid #eadede", borderLeft: "1px solid #eadede" }}>
          <div style={{ padding: "0.6rem", background: "#fffafa", color: colors.muted, fontSize: "0.7rem", fontWeight: 800 }}>Account</div>
          {weekDays.map((day) => <div key={localDateKey(day)} style={{ padding: "0.6rem 0.35rem", textAlign: "center", background: "#fffafa", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>{day.toLocaleDateString([], { weekday: "short", day: "numeric" })}</div>)}
          {accounts.map((account) => <div key={account.id} style={{ display: "contents" }}><div style={{ padding: "0.65rem", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", color: colors.ink, fontSize: "0.78rem", fontWeight: 700 }}>{account.name || account.username}</div>{weekDays.map((day) => { const dayAppointments = appointments.filter((appointment) => appointment.technicianId === account.id && appointment.status !== "Cancelled" && localDateKey(new Date(appointment.scheduledAt)) === localDateKey(day)); return <div key={`${account.id}-${localDateKey(day)}`} style={{ padding: "0.45rem", minHeight: "52px", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", background: dayAppointments.length ? "#fff7ed" : "#f0fdf4", color: dayAppointments.length ? "#9a3412" : "#166534", fontSize: "0.68rem", lineHeight: 1.4 }}>{dayAppointments.length ? dayAppointments.map((appointment) => { const client = clients.find((entry) => entry.id === appointment.clientId); return <div key={appointment.id}>{new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{new Date(new Date(appointment.scheduledAt).getTime() + (appointment.durationMinutes || 60) * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {client?.name || "Client"} · {appointment.status}</div>; }) : "Available"}</div>; })}</div>)}
        </div>
      </div>
    </section>
  );
}

function StockOutForm({ appointment, inventory, stockRows, setStockRows, onSubmit }) {
  const updateRow = (rowId, field, value) => {
    setStockRows((current) => current.map((row) => row.id === rowId ? { ...row, [field]: value } : row));
  };

  const addRow = (category) => {
    setStockRows((current) => [...current, { id: `stock-row-${category}-${Date.now()}`, category, itemId: "", amount: "" }]);
  };

  const removeRow = (rowId) => {
    setStockRows((current) => current.length <= STOCK_CATEGORIES.length ? current : current.filter((row) => row.id !== rowId));
  };

  const categoryLabel = (category) => category.charAt(0) + category.slice(1).toLowerCase();

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
      <div style={{ padding: "0.85rem", borderRadius: "10px", background: "#fff7ed", color: "#9a3412", fontSize: "0.78rem" }}>
        <PackageCheck size={15} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} /> Select every chemical, material, or equipment item used. All rows are submitted together.
      </div>
      {STOCK_CATEGORIES.map((category) => {
        const categoryRows = stockRows.filter((row) => row.category === category);
        const categoryItems = inventory.filter((item) => item.type === category && item.status !== "DISABLED");
        return (
          <section key={category} style={{ display: "grid", gap: "0.6rem", padding: "0.8rem", border: "1px solid #eadede", borderRadius: "10px", background: "#fffdfd" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
              <strong style={{ color: colors.ink, fontSize: "0.82rem" }}>{categoryLabel(category)}</strong>
              <button type="button" onClick={() => addRow(category)} style={{ ...secondaryButton, padding: "0.4rem 0.6rem", fontSize: "0.72rem" }}><Plus size={13} /> Add item</button>
            </div>
            {categoryRows.map((row) => {
              const selectedItemIds = new Set(categoryRows.filter((candidate) => candidate.id !== row.id).map((candidate) => candidate.itemId).filter(Boolean));
              const chosen = inventory.find((item) => item.id === row.itemId);
              const rate = chosen && (chosen.standardRate !== "" && chosen.standardRate !== null && chosen.standardRate !== undefined)
                ? `${chosen.standardRate} ${chosen.rateUnit || chosen.usageUnit || chosen.unit || ""}`.trim()
                : "";
              return (
                <div key={row.id} style={{ display: "grid", gap: "0.3rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 82px auto", gap: "0.45rem", alignItems: "center" }}>
                  <select aria-label={`${categoryLabel(category)} item`} value={row.itemId} onChange={(event) => updateRow(row.id, "itemId", event.target.value)} style={{ ...inputStyle, padding: "0.62rem 0.55rem", fontSize: "0.78rem" }} required={categoryRows.length === 1 && categoryItems.length > 0}>
                    <option value="">Select item</option>
                    {categoryItems.map((item) => <option key={item.id} value={item.id} disabled={selectedItemIds.has(item.id)}>{item.name} ({item.quantity} {item.unit})</option>)}
                  </select>
                  <input aria-label={`${categoryLabel(category)} quantity`} type="number" min="0" step="any" value={row.amount} onChange={(event) => updateRow(row.id, "amount", event.target.value)} placeholder="Qty" style={{ ...inputStyle, padding: "0.62rem 0.55rem", fontSize: "0.78rem" }} />
                  {categoryRows.length > 1 && <button type="button" aria-label={`Remove ${categoryLabel(category)} row`} onClick={() => removeRow(row.id)} style={{ border: 0, background: "transparent", color: colors.danger, cursor: "pointer", padding: "0.4rem" }}><X size={15} /></button>}
                </div>
                {/* Guidance only — a technician can still record what actually
                    happened on a bad infestation. It just makes an outlier,
                    or a decimal-point slip, obvious at the moment of entry. */}
                {category === "CHEMICAL" && row.itemId && <input
                  aria-label="Batch or lot number"
                  value={row.batchNumber || ""}
                  onChange={(event) => updateRow(row.id, "batchNumber", event.target.value)}
                  placeholder="Batch / lot no. from the container — e.g. L24-0917"
                  style={{ ...inputStyle, padding: "0.5rem 0.55rem", fontSize: "0.74rem" }}
                />}
                {(rate || chosen?.rateNote) && <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", padding: "0.4rem 0.55rem", borderRadius: "8px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: "0.7rem" }}>
                  <PackageCheck size={12} style={{ flex: "none", marginTop: "0.12rem" }} />
                  <span>
                    {rate && <><strong>Standard rate:</strong> {rate}</>}
                    {rate && chosen?.rateNote ? " · " : ""}
                    {chosen?.rateNote}
                  </span>
                </div>}
                </div>
              );
            })}
            {categoryItems.length === 0 && <span style={{ color: colors.muted, fontSize: "0.72rem" }}>No active {categoryLabel(category).toLowerCase()} inventory items.</span>}
          </section>
        );
      })}
      <button type="submit" style={primaryButton}><PackageCheck size={15} /> Record stock out</button>
      {(appointment.stockUsed || []).length > 0 && <div style={{ display: "grid", gap: "0.45rem" }}><strong style={{ fontSize: "0.76rem", color: colors.muted }}>Recorded for this service</strong>{appointment.stockUsed.map((entry, index) => <div key={`${entry.itemId}-${index}`} style={{ display: "flex", justifyContent: "space-between", padding: "0.55rem 0.7rem", border: "1px solid #eadede", borderRadius: "8px", fontSize: "0.78rem" }}><span>{entry.name}</span><strong>{entry.amount} {entry.unit}</strong></div>)}</div>}
    </form>
  );
}

function CreateAppointmentModalV2({ clients, activeAccounts, initialClientId = "", onClose, onCreate }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [clientId, setClientId] = useState(initialClientId);
  const [clientSearch, setClientSearch] = useState(
    () => clients.find((client) => client.id === initialClientId)?.name || ""
  );
  const [listOpen, setListOpen] = useState(false);
  const clientFieldRef = useRef(null);

  const selectedClient = clients.find((client) => client.id === clientId) || null;

  const matchingClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((client) =>
      [client.name, client.phone, client.email, client.address]
        .filter(Boolean).join(" ").toLowerCase().includes(term));
  }, [clients, clientSearch]);

  useEffect(() => {
    if (!listOpen) return undefined;
    const handlePointerDown = (event) => {
      if (clientFieldRef.current && !clientFieldRef.current.contains(event.target)) setListOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [listOpen]);

  // Typing invalidates the current pick, so the box can never show one client's
  // name while a different id is submitted.
  const handleClientSearch = (value) => {
    setClientSearch(value);
    setClientId("");
    setListOpen(true);
  };

  const chooseClient = (client) => {
    setClientId(client.id);
    setClientSearch(client.name);
    setListOpen(false);
  };

  const clearClient = () => {
    setClientId("");
    setClientSearch("");
    setListOpen(true);
    clientFieldRef.current?.querySelector("input")?.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!clientId) {
      setFormError("Select a client from the list.");
      return;
    }
    setSaving(true);
    setFormError("");
    const values = new FormData(event.currentTarget);
    const result = await onCreate({
      clientId: values.get("clientId"),
      scheduledAt: values.get("scheduledAt"),
      durationMinutes: readDuration(values),
      pestConcern: values.get("pestConcern"),
      serviceType: values.get("serviceType") || "",
      serviceLocation: values.get("serviceLocation") || "",
      technicianId: values.get("technicianId"),
      notes: values.get("notes"),
    });
    if (typeof result === "string") setFormError(result);
    setSaving(false);
  };

  return <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 20, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.42)" }}>
    <form onSubmit={handleSubmit} style={{ ...card, width: "min(100%, 520px)", maxHeight: "90vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}><div><div style={{ color: colors.brand, fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Scheduling</div><h2 style={{ margin: "0.25rem 0 0", color: colors.ink }}>New appointment</h2></div><button type="button" aria-label="Close new appointment" onClick={onClose} style={{ border: 0, background: "transparent", cursor: "pointer", color: colors.muted }}><X size={18} /></button></div>
      <div style={{ display: "grid", gap: "0.9rem" }}>
        <div ref={clientFieldRef} style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem", position: "relative" }}>
          <label htmlFor="client-search">Client</label>
          <input type="hidden" name="clientId" value={clientId} />
          <div style={{ position: "relative" }}>
            <input
              id="client-search"
              value={clientSearch}
              onChange={(event) => handleClientSearch(event.target.value)}
              onFocus={(event) => { setListOpen(true); if (selectedClient) event.target.select(); }}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setListOpen(false); } }}
              placeholder="Search by name, phone, email, or address"
              autoComplete="off"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="client-options"
              style={{ ...inputStyle, paddingRight: selectedClient ? "2rem" : undefined, borderColor: selectedClient ? colors.success : undefined }}
            />
            {selectedClient && <button type="button" onClick={clearClient} aria-label={`Clear selected client ${selectedClient.name}`} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: colors.muted, cursor: "pointer", display: "inline-flex", padding: 0 }}><X size={15} /></button>}
          </div>

          {listOpen && <div id="client-options" role="listbox" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, marginTop: "0.25rem", maxHeight: "11rem", overflowY: "auto", background: "#fff", border: "1px solid #eadede", borderRadius: "10px", boxShadow: "0 12px 26px rgba(75, 18, 18, 0.14)" }}>
            {matchingClients.length === 0
              ? <div style={{ padding: "0.7rem 0.75rem", color: colors.muted, fontWeight: 600, fontSize: "0.78rem" }}>No clients match that search.</div>
              : matchingClients.map((client) => (
                <button
                  type="button"
                  key={client.id}
                  role="option"
                  aria-selected={client.id === clientId}
                  onClick={() => chooseClient(client)}
                  style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid #f4ecec", background: client.id === clientId ? "#fff5f5" : "transparent", padding: "0.55rem 0.75rem", cursor: "pointer", font: "inherit" }}
                >
                  <span style={{ display: "block", color: colors.ink, fontWeight: 700, fontSize: "0.82rem" }}>{client.name}</span>
                  {client.address && <span style={{ display: "block", color: colors.muted, fontWeight: 500, fontSize: "0.72rem" }}>{client.address}</span>}
                </button>
              ))}
          </div>}

          {!selectedClient && !listOpen && <span style={{ color: colors.muted, fontWeight: 600, fontSize: "0.72rem" }}>No client selected yet.</span>}
        </div>
        <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Date and time<input name="scheduledAt" type="datetime-local" defaultValue={new Date(Date.now() + 3600000).toISOString().slice(0, 16)} style={inputStyle} required /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontWeight: 700, fontSize: "0.72rem" }}>Hours<input name="durationHours" type="number" min="0" max="24" defaultValue="1" style={{ ...inputStyle, padding: "0.55rem" }} required /></label><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontWeight: 700, fontSize: "0.72rem" }}>Minutes<input name="durationMinutes" type="number" min="0" max="59" defaultValue="0" style={{ ...inputStyle, padding: "0.55rem" }} required /></label></div>
        <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Technician<select name="technicianId" defaultValue="" style={inputStyle}><option value="">Unassigned</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.username}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Service type<select name="serviceType" style={inputStyle}><option value="">Select a service type</option>{SERVICE_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Service location<input name="serviceLocation" placeholder="Defaults to the client's address" style={inputStyle} /></label>
        <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Pest concern<select name="pestConcern" style={inputStyle}><option value="">Select a pest concern</option>{PEST_CONCERN_SUGGESTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Notes<textarea name="notes" rows={3} style={{ ...inputStyle, resize: "vertical" }} /></label>
      </div>
      {formError && <div role="alert" style={{ marginTop: "0.9rem", color: colors.danger, fontWeight: 700, fontSize: "0.8rem" }}>{formError}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", marginTop: "1.25rem" }}><button type="button" onClick={onClose} style={secondaryButton}>Cancel</button><button type="submit" disabled={saving || clients.length === 0} style={primaryButton}>{saving ? "Creating..." : "Create appointment"}</button></div>
    </form>
  </div>;
}

function CreateAppointmentModal({ clients, activeAccounts, onClose, onCreate }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    const values = new FormData(event.currentTarget);
    const result = await onCreate({
      clientId: values.get("clientId"),
      scheduledAt: values.get("scheduledAt"),
      durationMinutes: readDuration(values),
      pestConcern: values.get("pestConcern"),
      technicianId: values.get("technicianId"),
      notes: values.get("notes"),
    });
    if (typeof result === "string") setFormError(result);
    setSaving(false);
  };

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 20, display: "grid", placeItems: "center", padding: "1rem", background: "rgba(15, 23, 42, 0.42)" }}>
      <form onSubmit={handleSubmit} style={{ ...card, width: "min(100%, 520px)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}><div><div style={{ color: colors.brand, fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Scheduling</div><h2 style={{ margin: "0.25rem 0 0", color: colors.ink }}>New appointment</h2></div><button type="button" aria-label="Close new appointment" onClick={onClose} style={{ border: 0, background: "transparent", cursor: "pointer", color: colors.muted }}><X size={18} /></button></div>
        <div style={{ display: "grid", gap: "1rem" }}><label style={{ display: "grid", gap: "0.4rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Client<select name="clientId" style={inputStyle} required><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label style={{ display: "grid", gap: "0.4rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Date and time<input name="scheduledAt" type="datetime-local" defaultValue={new Date(Date.now() + 3600000).toISOString().slice(0, 16)} style={inputStyle} required /></label><label style={{ display: "grid", gap: "0.4rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Technician or staff<select name="technicianId" defaultValue="" style={inputStyle}><option value="">Unassigned</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.username}</option>)}</select></label><label style={{ display: "grid", gap: "0.4rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Notes<textarea name="notes" rows={3} style={{ ...inputStyle, resize: "vertical" }} /></label></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem", marginTop: "1rem" }}><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontSize: "0.72rem", fontWeight: 700 }}>Hours<input name="durationHours" type="number" min="0" max="24" defaultValue="1" style={{ ...inputStyle, padding: "0.5rem" }} required /></label><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontSize: "0.72rem", fontWeight: 700 }}>Minutes<input name="durationMinutes" type="number" min="0" max="59" defaultValue="0" style={{ ...inputStyle, padding: "0.5rem" }} required /></label></div><label style={{ display: "grid", gap: "0.25rem", color: colors.muted, fontSize: "0.72rem", fontWeight: 700, marginTop: "0.65rem" }}>Pest concern<select name="pestConcern" style={{ ...inputStyle, padding: "0.5rem" }}><option value="">Select a pest concern</option>{PEST_CONCERN_SUGGESTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        {formError && <div role="alert" style={{ marginTop: "0.9rem", color: colors.danger, fontWeight: 700, fontSize: "0.8rem" }}>{formError}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", marginTop: "1.25rem" }}><button type="button" onClick={onClose} style={secondaryButton}>Cancel</button><button type="submit" disabled={saving || clients.length === 0} style={primaryButton}>{saving ? "Creating..." : "Create appointment"}</button></div>
      </form>
    </div>
  );
}

function InfoRow({ icon, label, value }) {
  return <div style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start", paddingBottom: "0.85rem", borderBottom: "1px solid #f1e7e7" }}><span style={{ color: colors.brand, marginTop: "0.1rem" }}>{icon}</span><div><div style={{ color: colors.muted, fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>{label}</div><div style={{ color: colors.ink, fontSize: "0.84rem", marginTop: "0.18rem", lineHeight: 1.45 }}>{value}</div></div></div>;
}

export default SchedulingPage;
