import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  MapPin,
  PackageCheck,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import ClientDocuments from "../components/clients/ClientDocuments";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import useInventory from "../hooks/useInventory";
import useUsers from "../hooks/useUsers";
import { useScheduling } from "../context/SchedulingContext";
import { useToast } from "../context/ToastContext";
import { ACCOUNT_STATUS, APPOINTMENT_STATUSES, PEST_CONCERN_SUGGESTIONS, SERVICE_TYPES } from "../utils/constants";
import { allowedNextStatuses, busyTechnicianIds, canTransition, findTechnicianConflicts } from "../utils/scheduling";
import { validateAttachment } from "../utils/validators";
import { card, colors, inputStyle, pageShell, primaryButton, secondaryButton } from "../styles/theme";

const HOURS = Array.from({ length: 10 }, (_, index) => index + 8);
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

function badgeStyle(status) {
  const map = {
    Pending: ["#fff7ed", "#c2410c"],
    Scheduled: ["#eff6ff", "#1d4ed8"],
    Confirmed: ["#ecfdf5", "#047857"],
    Completed: ["#f0fdf4", "#166534"],
    Cancelled: ["#fef2f2", "#b91c1c"],
  };
  const [background, color] = map[status] || map.Pending;
  return { background, color, borderRadius: 999, padding: "0.25rem 0.55rem", fontSize: "0.7rem", fontWeight: 800 };
}

function SchedulingPage() {
  const { can } = useAuth();
  const { showError } = useToast();
  const { clients, addDocument, removeDocument, getDocumentUrl } = useClients();
  const { inventory, stockOutMany } = useInventory();
  const { staff, technicians } = useUsers();
  const { appointments, createAppointment, updateAppointment, submitReport, addStockUsed, addAttachment, removeAttachment, getAttachmentUrl, loading, error } = useScheduling();
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("week");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [tab, setTab] = useState("Overview");
  const [draggedId, setDraggedId] = useState(null);
  const [message, setMessage] = useState("");
  const [stockRows, setStockRows] = useState(STOCK_CATEGORIES.map((category) => ({ id: `stock-row-${category}`, category, itemId: "", amount: "" })));
  const [createOpen, setCreateOpen] = useState(false);
  const [createClientId, setCreateClientId] = useState("");
  const [appointmentSearch, setAppointmentSearch] = useState("");
  const [scheduleTab, setScheduleTab] = useState("calendar");
  const [technicianFilter, setTechnicianFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");
  const [pestConcernFilter, setPestConcernFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const draggedCardRef = useRef(false);

  const selected = appointments.find((appointment) => appointment.id === selectedId) || null;
  const selectedClient = clients.find((client) => client.id === selected?.clientId) || null;
  const activeAccounts = useMemo(
    () => [...staff, ...technicians].filter((account) => account.status !== ACCOUNT_STATUS.INACTIVE),
    [staff, technicians]
  );
  const weekStart = startOfWeek(anchorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthCells = useMemo(() => {
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [anchorDate]);
  const visibleAppointments = useMemo(() => {
    const term = appointmentSearch.trim().toLowerCase();
    return appointments.filter((appointment) => {
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
  }, [appointments, appointmentSearch, clients, activeAccounts, technicianFilter, statusFilter, clientFilter, pestConcernFilter, dateFrom, dateTo]);

  const pestConcernOptions = useMemo(
    () => Array.from(new Set(appointments.map((appointment) => appointment.pestConcern).filter(Boolean))).sort(),
    [appointments]
  );

  const appointmentFor = (dateKey, hour) => appointments.filter((appointment) => {
    const date = new Date(appointment.scheduledAt);
    return localDateKey(date) === dateKey && date.getHours() === hour && visibleAppointments.some((entry) => entry.id === appointment.id);
  });

  const calendarPlacement = (dateKey, appointment) => {
    const dayAppointments = visibleAppointments
      .filter((entry) => localDateKey(new Date(entry.scheduledAt)) === dateKey)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    const lanes = [];
    const laneById = new Map();
    dayAppointments.forEach((entry) => {
      const entryStart = new Date(entry.scheduledAt).getTime();
      const entryEnd = entryStart + (entry.durationMinutes || 60) * 60000;
      const laneIndex = lanes.findIndex((laneEnd) => laneEnd <= entryStart);
      const assignedLane = laneIndex === -1 ? lanes.length : laneIndex;
      lanes[assignedLane] = entryEnd;
      laneById.set(entry.id, assignedLane);
    });

    const totalLanes = Math.max(1, lanes.length);
    const laneIndex = laneById.get(appointment.id) || 0;
    return {
      left: `calc(${(laneIndex / totalLanes) * 100}% + 0.3rem)`,
      width: `calc(${100 / totalLanes}% - 0.6rem)`,
    };
  };

  const moveAppointment = async (dateKey, time = "09:00") => {
    if (!draggedId) return;
    const current = appointments.find((appointment) => appointment.id === draggedId);
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

  const handleReportSubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const report = {
      findings: form.get("findings").trim(),
      treatmentPerformed: form.get("treatmentPerformed").trim(),
      recommendations: form.get("recommendations").trim(),
      followUpDate: form.get("followUpDate") || "",
    };
    if (!report.findings || !report.treatmentPerformed) {
      showError("Inspection findings and treatment performed are required.");
      return;
    }
    const result = await submitReport(selected.id, report);
    if (typeof result === "string") showError(result);
    setMessage(typeof result === "string" ? result : "Report submitted and service marked Completed.");
  };

  const scheduleFollowUp = () => {
    setCreateClientId(selected.clientId);
    setCreateOpen(true);
  };

  const handleStockSubmit = async (event) => {
    event.preventDefault();
    const entries = stockRows.filter((row) => row.itemId).map((row) => ({ itemId: row.itemId, amount: Number(row.amount) }));
    if (entries.length === 0 || entries.some((entry) => !Number.isInteger(entry.amount) || entry.amount <= 0)) {
      setMessage("Select at least one item and enter a positive whole-number quantity.");
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
      addStockUsed(selected.id, { itemId: entry.itemId, name: item?.name || "Inventory item", amount: entry.amount, unit: item?.unit || "", date: new Date().toISOString().slice(0, 10) });
    });
    setStockRows(STOCK_CATEGORIES.map((category) => ({ id: `stock-row-${category}-${Date.now()}`, category, itemId: "", amount: "" })));
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

  const renderAppointmentCard = (appointment, compact = false, placement = {}) => {
    const client = clients.find((entry) => entry.id === appointment.clientId);
    if (!client) return null;
    const selectedCard = appointment.id === selectedId;
    return (
      <button
        key={appointment.id}
        type="button"
        draggable
        onDragStart={async () => {
          draggedCardRef.current = false;
          setDraggedId(appointment.id);
          if (appointment.status !== "Reschedule") {
            const result = await updateAppointment({ ...appointment, status: "Reschedule" });
            if (typeof result === "string") setMessage(result);
          }
        }}
        onDragEnd={() => { draggedCardRef.current = true; setDraggedId(null); }}
        onClick={() => { if (draggedCardRef.current) { draggedCardRef.current = false; return; } setSelectedId(appointment.id); setTab("Overview"); }}
        style={{
          width: "100%", textAlign: "left", cursor: "grab", border: selectedCard ? `2px solid ${colors.brandLight}` : "1px solid #e8d9d9",
          borderRadius: "10px", padding: compact ? "0.45rem" : "0.65rem", background: selectedCard ? "#fff6f6" : "#ffffff",
          boxShadow: selectedCard ? "0 6px 16px rgba(127,17,17,0.12)" : "0 2px 5px rgba(15,23,42,0.04)",
          minHeight: compact ? undefined : `${Math.max(56, ((appointment.durationMinutes || 60) / 60) * 76 - 10)}px`,
          position: "relative", zIndex: selectedCard ? 2 : 1,
          opacity: draggedId === appointment.id ? 0.55 : 1,
          ...placement,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: colors.brand, fontSize: "0.68rem", fontWeight: 800 }}>
          <GripVertical size={12} /> {new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
        <div style={{ color: colors.ink, fontWeight: 800, fontSize: compact ? "0.72rem" : "0.8rem", marginTop: "0.25rem" }}>{client.name}</div>
        {!compact && <div style={{ color: colors.muted, fontSize: "0.68rem", marginTop: "0.2rem" }}>{formatDuration(appointment.durationMinutes || 60)}</div>}
        {!compact && <div style={{ color: colors.muted, fontSize: "0.68rem", marginTop: "0.2rem" }}>{appointment.pestConcern || "Inspection"}</div>}
        <span style={{ ...badgeStyle(appointment.status), display: "inline-block", marginTop: "0.4rem", fontSize: "0.62rem" }}>{appointment.status}</span>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}><div style={{ display: "flex", gap: "0.35rem", background: "#f8fafc", padding: "0.25rem", borderRadius: "10px" }}>{["calendar", "list", "technicians"].map((option) => <button key={option} type="button" onClick={() => setScheduleTab(option)} style={{ ...secondaryButton, border: "none", background: scheduleTab === option ? colors.brand : "transparent", color: scheduleTab === option ? "#fff" : colors.body, padding: "0.5rem 0.8rem" }}>{option === "calendar" ? "Calendar" : option === "list" ? "List" : "Technicians"}</button>)}</div>{scheduleTab === "calendar" && <div style={{ display: "flex", gap: "0.4rem", background: "#f8fafc", padding: "0.25rem", borderRadius: "10px" }}>{['week', 'month'].map((option) => <button key={option} type="button" onClick={() => setView(option)} style={{ ...secondaryButton, border: "none", background: view === option ? colors.brand : "transparent", color: view === option ? "#fff" : colors.body, padding: "0.55rem 0.8rem" }}>{option === "week" ? "Week" : "Month"}</button>)}</div>}</div>
          {scheduleTab === "list" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.65rem", alignItems: "end", marginBottom: "1rem", padding: "0.85rem", background: "#fffafa", border: "1px solid #eadede", borderRadius: "10px" }}><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800, gridColumn: "span 2" }}>Search appointments<input value={appointmentSearch} onChange={(event) => setAppointmentSearch(event.target.value)} placeholder="Client, address, technician, pest concern, ID" style={inputStyle} /></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Technician<select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} style={inputStyle}><option value="ALL">All technicians</option>{technicians.map((account) => <option key={account.id} value={account.id}>{account.name || account.username}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}><option value="ALL">All statuses</option>{APPOINTMENT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Client<select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} style={inputStyle}><option value="ALL">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Pest concern<select value={pestConcernFilter} onChange={(event) => setPestConcernFilter(event.target.value)} style={inputStyle}><option value="ALL">All pest concerns</option>{pestConcernOptions.map((concern) => <option key={concern} value={concern}>{concern}</option>)}</select></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Date from<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} style={inputStyle} /></label><label style={{ display: "grid", gap: "0.3rem", color: colors.muted, fontSize: "0.68rem", fontWeight: 800 }}>Date to<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} style={inputStyle} /></label>{(dateFrom || dateTo) && <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ ...secondaryButton, alignSelf: "end" }}>Clear dates</button>}</div>}
          {scheduleTab !== "list" && <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <button type="button" aria-label="Previous period" onClick={() => navigateCalendar(-1)} style={secondaryButton}><ChevronLeft size={16} /></button>
              <button type="button" aria-label="Next period" onClick={() => navigateCalendar(1)} style={secondaryButton}><ChevronRight size={16} /></button>
              <strong style={{ color: colors.ink }}>{scheduleTab === "technicians" || view === "week" ? `${weekStart.toLocaleDateString([], { month: "short", day: "numeric" })} - ${addDays(weekStart, 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : anchorDate.toLocaleDateString([], { month: "long", year: "numeric" })}</strong>
            </div>
          </div>}

          {scheduleTab === "list" ? <AppointmentListView appointments={visibleAppointments} clients={clients} accounts={activeAccounts} onSelect={(id) => { setSelectedId(id); setTab("Overview"); }} /> : scheduleTab === "technicians" ? <TechnicianAvailability accounts={technicians} appointments={visibleAppointments} weekDays={weekDays} clients={clients} /> : (view === "week" ? (
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: "780px", display: "grid", gridTemplateColumns: "64px repeat(7, minmax(95px, 1fr))", borderTop: "1px solid #eadede", borderLeft: "1px solid #eadede" }}>
                <div style={{ background: "#fffafa" }} />
                {weekDays.map((date) => <div key={localDateKey(date)} style={{ padding: "0.7rem 0.35rem", textAlign: "center", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", background: localDateKey(date) === localDateKey(new Date()) ? "#fff1f1" : "#fffafa" }}><div style={{ color: colors.muted, fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase" }}>{date.toLocaleDateString([], { weekday: "short" })}</div><div style={{ color: colors.ink, fontSize: "1.05rem", fontWeight: 800 }}>{date.getDate()}</div></div>)}
                {HOURS.map((hour) => <div key={hour} style={{ display: "contents" }}><div style={{ color: colors.muted, fontSize: "0.65rem", padding: "0.55rem 0.3rem", textAlign: "right", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede" }}>{formatTime(`${String(hour).padStart(2, "0")}:00`)}</div>{weekDays.map((date) => { const key = localDateKey(date); return <div key={`${key}-${hour}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); const offsetMinutes = Math.max(0, Math.min(59, Math.round(((event.clientY - bounds.top) / 76) * 60 / 10) * 10)); moveAppointment(key, `${String(hour).padStart(2, "0")}:${String(offsetMinutes).padStart(2, "0")}`); }} style={{ position: "relative", minHeight: "76px", padding: "0.3rem", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", background: draggedId ? "#fffdfd" : "#fff", backgroundImage: "linear-gradient(to bottom, transparent 49.5%, #f6eeee 50%, transparent 50.5%)" }}>{appointmentFor(key, hour).map((appointment) => { const startMinutes = new Date(appointment.scheduledAt).getMinutes(); const height = Math.max(30, ((appointment.durationMinutes || 60) / 60) * 76 - 6); const placement = calendarPlacement(key, appointment); return renderAppointmentCard(appointment, false, { position: "absolute", top: `${(startMinutes / 60) * 76 + 3}px`, ...placement, height: `${height}px`, minHeight: "0", overflow: "hidden" }); })}</div>; })}</div>)}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(90px, 1fr))", overflowX: "auto", minWidth: "680px", borderTop: "1px solid #eadede", borderLeft: "1px solid #eadede" }}>
              {monthCells.map((date) => { const key = localDateKey(date); const entries = visibleAppointments.filter((appointment) => localDateKey(new Date(appointment.scheduledAt)) === key); return <div key={key} onDragOver={(event) => event.preventDefault()} onDrop={() => moveAppointment(key)} style={{ minHeight: "112px", padding: "0.45rem", borderRight: "1px solid #eadede", borderBottom: "1px solid #eadede", background: date.getMonth() === anchorDate.getMonth() ? "#fff" : "#fafafa" }}><div style={{ color: date.getMonth() === anchorDate.getMonth() ? colors.ink : "#a3a3a3", fontWeight: 800, fontSize: "0.75rem", marginBottom: "0.3rem" }}>{date.getDate()}</div><div style={{ display: "grid", gap: "0.3rem" }}>{entries.map((appointment) => renderAppointmentCard(appointment, true))}</div></div>; })}
            </div>
          ))}
          <div style={{ display: "flex", gap: "1rem", color: colors.muted, fontSize: "0.72rem", marginTop: "0.85rem", alignItems: "center" }}><GripVertical size={14} /> Drag any appointment to reschedule it. Dropping it saves the new time as Confirmed.</div>
          {loading && <div role="status" style={{ marginTop: "0.75rem", color: colors.muted, fontWeight: 700, fontSize: "0.82rem" }}>Loading appointments...</div>}
          {(message || error) && <div role="status" style={{ marginTop: "0.75rem", color: error ? colors.danger : colors.success, fontWeight: 700, fontSize: "0.82rem" }}>{error || message}</div>}
          {clients.length === 0 && <div style={{ padding: "2rem 1rem", textAlign: "center", color: colors.muted }}>Client profiles will appear here once they are loaded.</div>}
          {appointmentSearch && visibleAppointments.length === 0 && <div style={{ padding: "1rem", textAlign: "center", color: colors.muted }}>No appointments match this search.</div>}
        </section>

        {selected && selectedClient && <AppointmentPanel key={`${selected.id}-${selected.status}-${selected.updatedAt || ""}`} appointment={selected} client={selectedClient} tab={tab} setTab={setTab} activeAccounts={technicians} appointments={appointments} canUpload={can("clientDocuments", "create")} canRemove={can("clientDocuments", "delete")} addDocument={addDocument} removeDocument={removeDocument} getDocumentUrl={getDocumentUrl} addAttachment={addAttachment} removeAttachment={removeAttachment} getAttachmentUrl={getAttachmentUrl} onSave={handleManualSave} onTimingSave={handleTimingSave} onReportSubmit={handleReportSubmit} onStockSubmit={handleStockSubmit} onScheduleFollowUp={scheduleFollowUp} inventory={inventory} stockRows={stockRows} setStockRows={setStockRows} onClose={() => setSelectedId(null)} />}
      </div>
      {createOpen && <CreateAppointmentModalV2 clients={clients} activeAccounts={technicians} initialClientId={createClientId} onClose={() => { setCreateOpen(false); setCreateClientId(""); }} onCreate={handleCreate} />}
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
    <div style={{ display: "grid", gap: "0.4rem" }}><strong style={labelStyle}>Technician</strong><select name="technicianId" value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} style={inputStyle}><option value="">Unassigned</option>{activeAccounts.map((account) => <option key={account.id} value={account.id} disabled={isBusy(account.id)}>{account.name || account.username}{isBusy(account.id) ? " - busy at this time" : ""}</option>)}</select>{conflicts.length > 0 && <span style={{ color: colors.danger, fontSize: "0.72rem", fontWeight: 700 }}>Conflict: this technician overlaps another appointment.</span>}</div>
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

function AppointmentPanel({ appointment, client, tab, setTab, activeAccounts, appointments, canUpload, canRemove, addDocument, removeDocument, getDocumentUrl, addAttachment, removeAttachment, getAttachmentUrl, onSave, onTimingSave, onReportSubmit, onStockSubmit, onScheduleFollowUp, inventory, stockRows, setStockRows, onClose }) {
  const busyTechnicians = busyTechnicianIds(appointments, appointment);
  if (tab === "Overview") {
    return <aside style={{ ...card, padding: 0, overflowY: "auto", maxHeight: "calc(100vh - 2rem)", position: "sticky", top: "1rem", border: "1px solid #eadede", boxShadow: "0 14px 34px rgba(75, 18, 18, 0.12)" }}>
      <div style={{ padding: "1.25rem 1.25rem 1rem", background: "linear-gradient(135deg, #7f1111, #b43d3d)", color: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: "0.68rem", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Appointment detail</div><h2 style={{ margin: "0.3rem 0", fontSize: "1.35rem" }}>{client.name}</h2><div style={{ opacity: 0.85, fontSize: "0.78rem" }}>{formatDateTime(appointment.scheduledAt)}</div></div><button type="button" aria-label="Close appointment detail" onClick={onClose} style={{ border: 0, background: "transparent", color: "#fff", cursor: "pointer" }}><X size={18} /></button></div></div>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid #eadede" }}>{TAB_LABELS.map((label) => <button type="button" key={label} onClick={() => setTab(label)} style={{ flex: 1, minWidth: "88px", border: 0, borderBottom: tab === label ? `3px solid ${colors.brand}` : "3px solid transparent", padding: "0.8rem 0.35rem", background: "#fff", color: tab === label ? colors.brand : colors.muted, fontWeight: 800, fontSize: "0.72rem", cursor: "pointer" }}>{label}</button>)}</div>
      <div style={{ padding: "1.25rem", background: "#fffdfd" }}><AppointmentOverviewForm key={appointment.id} appointment={appointment} client={client} activeAccounts={activeAccounts} busyTechnicians={busyTechnicians} appointments={appointments} onSave={onSave} /></div>
    </aside>;
  }
  return (
    <aside style={{ ...card, padding: 0, overflowY: "auto", maxHeight: "calc(100vh - 2rem)", position: "sticky", top: "1rem", border: "1px solid #eadede", boxShadow: "0 14px 34px rgba(75, 18, 18, 0.12)" }}>
      <div style={{ padding: "1.25rem 1.25rem 1rem", background: "linear-gradient(135deg, #7f1111, #b43d3d)", color: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ fontSize: "0.68rem", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Appointment detail</div><h2 style={{ margin: "0.3rem 0", fontSize: "1.35rem" }}>{client.name}</h2><div style={{ opacity: 0.85, fontSize: "0.78rem" }}>{formatDateTime(appointment.scheduledAt)}</div></div><button type="button" aria-label="Close appointment detail" onClick={onClose} style={{ border: 0, background: "transparent", color: "#fff", cursor: "pointer" }}><X size={18} /></button></div></div>
      <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid #eadede" }}>{TAB_LABELS.map((label) => <button type="button" key={label} onClick={() => setTab(label)} style={{ flex: 1, minWidth: "88px", border: 0, borderBottom: tab === label ? `3px solid ${colors.brand}` : "3px solid transparent", padding: "0.8rem 0.35rem", background: "#fff", color: tab === label ? colors.brand : colors.muted, fontWeight: 800, fontSize: "0.72rem", cursor: "pointer" }}>{label}</button>)}</div>
      <div style={{ padding: "1.25rem", maxHeight: "calc(100vh - 230px)", overflowY: "auto", background: "#fffdfd" }}>
        {tab === "Documents" && <ClientDocuments documents={client.documents || []} canUpload={canUpload} canRemove={canRemove} onUpload={(file) => addDocument(client.id, file)} onRemove={(document) => removeDocument(client.id, document)} onResolveUrl={getDocumentUrl} />}
        {tab === "Report" && <form onSubmit={onReportSubmit} style={{ display: "grid", gap: "1rem" }}><div style={{ padding: "0.85rem", borderRadius: "10px", background: "#f8fafc", color: colors.muted, fontSize: "0.78rem" }}><FileText size={15} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} /> Required fields finalize this service. Recommendations and follow-up scheduling are optional.</div><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Inspection findings<textarea name="findings" defaultValue={appointment.report} rows={5} placeholder="What did the technician observe?" style={{ ...inputStyle, resize: "vertical", whiteSpace: "pre-wrap" }} required /></label><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Treatment performed<textarea name="treatmentPerformed" defaultValue={appointment.treatmentPerformed} rows={5} placeholder="What treatment or work was completed?" style={{ ...inputStyle, resize: "vertical", whiteSpace: "pre-wrap" }} required /></label><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Recommendations / follow-up notes<textarea name="recommendations" defaultValue={appointment.recommendations} rows={3} placeholder="Optional recommendations" style={{ ...inputStyle, resize: "vertical" }} /></label><label style={{ display: "grid", gap: "0.35rem", color: colors.body, fontWeight: 700, fontSize: "0.82rem" }}>Follow-up date<input name="followUpDate" type="date" defaultValue={appointment.followUpDate} style={inputStyle} /></label><div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}><button type="submit" style={primaryButton}><Check size={15} /> {appointment.reportSubmitted ? "Update report" : "Submit report"}</button>{appointment.followUpDate && <button type="button" onClick={onScheduleFollowUp} style={secondaryButton}>Schedule follow-up</button>}</div>{appointment.reportSubmitted && <div style={{ color: colors.success, fontWeight: 700, fontSize: "0.8rem" }}>Saved{appointment.reportSubmittedAt ? ` on ${formatDateTime(appointment.reportSubmittedAt)}` : ""}. Service is Completed.</div>}</form>}
        {tab === "Report" && <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid #eadede" }}><ClientDocuments documents={appointment.attachments || []} canUpload={canUpload} canRemove={canRemove && !appointment.reportSubmitted} onUpload={(file) => addAttachment(appointment.id, file)} onRemove={(attachment) => removeAttachment(attachment)} onResolveUrl={getAttachmentUrl} title="Report attachments" hint="Before/after photos or signed documents — JPG, PNG, PDF up to 5MB" accept=".jpg,.jpeg,.png,.pdf" validate={validateAttachment} emptyMessage="No photos or documents attached to this report yet." />{appointment.reportSubmitted && <div style={{ marginTop: "0.6rem", color: colors.muted, fontSize: "0.72rem" }}>The report is finalized, so existing attachments can no longer be removed.</div>}</div>}
        {tab === "Stock-Out" && <StockOutForm appointment={appointment} inventory={inventory} stockRows={stockRows} setStockRows={setStockRows} onSubmit={onStockSubmit} />}
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
              return (
                <div key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 82px auto", gap: "0.45rem", alignItems: "center" }}>
                  <select aria-label={`${categoryLabel(category)} item`} value={row.itemId} onChange={(event) => updateRow(row.id, "itemId", event.target.value)} style={{ ...inputStyle, padding: "0.62rem 0.55rem", fontSize: "0.78rem" }} required={categoryRows.length === 1 && categoryItems.length > 0}>
                    <option value="">Select item</option>
                    {categoryItems.map((item) => <option key={item.id} value={item.id} disabled={selectedItemIds.has(item.id)}>{item.name} ({item.quantity} {item.unit})</option>)}
                  </select>
                  <input aria-label={`${categoryLabel(category)} quantity`} type="number" min="1" step="1" value={row.amount} onChange={(event) => updateRow(row.id, "amount", event.target.value)} placeholder="Qty" style={{ ...inputStyle, padding: "0.62rem 0.55rem", fontSize: "0.78rem" }} />
                  {categoryRows.length > 1 && <button type="button" aria-label={`Remove ${categoryLabel(category)} row`} onClick={() => removeRow(row.id)} style={{ border: 0, background: "transparent", color: colors.danger, cursor: "pointer", padding: "0.4rem" }}><X size={15} /></button>}
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
