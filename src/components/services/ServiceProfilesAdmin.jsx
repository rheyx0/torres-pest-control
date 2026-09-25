// Admin panel for the service catalog (migration 047).
//
// A service is what the business sells — "Termite Control" — plus the
// materials it normally uses. Those materials PREFILL the appointment's
// Stock-Out tab; the technician still confirms what was actually used, so a
// default here never moves stock on its own.
//
// Deleting is safe for history: every appointment keeps the service name it
// was booked under (appointments.service_type), and only its link to this row
// is cleared. Retiring is offered first because it is reversible.

import { useMemo, useState } from "react";
import { Eye, EyeOff, PackageCheck, Pencil, Plus, Trash2, X } from "lucide-react";
import ConfirmDialog from "../common/ConfirmDialog";
import { Button, Field, Input, Modal, Select, Textarea } from "../ui";
import { useToast } from "../../context/ToastContext";
import useInventory from "../../hooks/useInventory";
import useServices from "../../hooks/useServices";
import { LIMITS } from "../../utils/constants";
import { validateDuration, validateMoney, validateQuantity } from "../../utils/validators";
import { card, colors } from "../../styles/theme";

const peso = (value) => `₱${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDuration = (minutes) => {
  if (!minutes) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours}h` : "", rest ? `${rest}m` : ""].filter(Boolean).join(" ");
};

const MAX_SERVICE_DURATION_MINUTES = 13 * 60;
const clampWholeNumber = (value, maximum) => {
  if (value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.min(maximum, Math.max(0, Math.floor(number))));
};

const TYPE_LABELS = { CHEMICAL: "Chemicals", MATERIAL: "Materials", EQUIPMENT: "Equipment" };

let rowCounter = 0;
const newRow = (itemId = "", defaultAmount = "") => ({ key: `material-${(rowCounter += 1)}`, itemId, defaultAmount: String(defaultAmount) });

/**
 * Pure validation for the service form, exported for tests. Returns
 * { field: message }; {} means the form can be saved.
 */
export function validateServiceForm(form, services = [], editingId = null) {
  const errors = {};
  const name = String(form.name || "").trim();
  if (!name) errors.name = "Service name is required.";
  else if (name.length > LIMITS.SHORT_TEXT_MAX) errors.name = `Keep the name under ${LIMITS.SHORT_TEXT_MAX} characters.`;
  else if (services.some((service) => service.id !== editingId && service.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = "A service with that name already exists.";
  }

  const priceError = validateMoney(form.defaultPrice, { label: "Default price" });
  if (priceError) errors.defaultPrice = priceError;

  if (form.defaultDurationMinutes !== "" && form.defaultDurationMinutes !== null && form.defaultDurationMinutes !== undefined) {
    const durationError = validateDuration(form.defaultDurationMinutes);
    if (durationError) errors.defaultDurationMinutes = durationError;
    else if (Number(form.defaultDurationMinutes) > MAX_SERVICE_DURATION_MINUTES) {
      errors.defaultDurationMinutes = "Default duration must fit within the 6 AM–7 PM service day (13 hours maximum).";
    }
  }

  const filled = (form.materials || []).filter((row) => row.itemId);
  const seen = new Set();
  filled.forEach((row) => {
    if (seen.has(row.itemId)) errors.materials = "List each inventory item once.";
    seen.add(row.itemId);
    const quantityError = validateQuantity(row.defaultAmount, { label: "Each material quantity" });
    if (quantityError && !errors.materials) errors.materials = quantityError;
  });
  return errors;
}

function ServiceModal({ initial, services, inventory, busy, onSave, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(() => ({
    name: initial?.name || "",
    description: initial?.description || "",
    defaultPrice: initial?.defaultPrice ?? "",
    defaultDurationMinutes: initial?.defaultDurationMinutes ?? "",
    materials: (initial?.materials || []).length
      ? initial.materials.map((material) => newRow(material.itemId, material.defaultAmount))
      : [newRow()],
  }));
  const [errors, setErrors] = useState({});
  const durationHours = form.defaultDurationMinutes === "" ? "" : Math.floor(Number(form.defaultDurationMinutes) / 60);
  const durationMinutes = form.defaultDurationMinutes === "" ? "" : Number(form.defaultDurationMinutes) % 60;

  const itemsById = useMemo(() => new Map(inventory.map((item) => [item.id, item])), [inventory]);
  // Disabled items stay selectable only if the service already lists them, so
  // editing an old service does not silently drop a row.
  const choosable = inventory.filter((item) => item.status !== "DISABLED" || form.materials.some((row) => row.itemId === item.id));
  const groups = ["CHEMICAL", "MATERIAL", "EQUIPMENT"]
    .map((type) => ({ type, items: choosable.filter((item) => item.type === type) }))
    .filter((group) => group.items.length);

  const set = (field, value) => {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setForm((current) => ({ ...current, [field]: value }));
  };
  const setDurationPart = (part, value) => {
    const nextPart = clampWholeNumber(value, part === "hours" ? 13 : 59);
    const otherPart = part === "hours" ? durationMinutes : durationHours;
    if (nextPart === "" && otherPart === "") {
      set("defaultDurationMinutes", "");
      return;
    }
    const hours = part === "hours" ? Number(nextPart) || 0 : Number(durationHours) || 0;
    const minutes = part === "minutes" ? Number(nextPart) || 0 : Number(durationMinutes) || 0;
    set("defaultDurationMinutes", String(Math.min(MAX_SERVICE_DURATION_MINUTES, hours * 60 + minutes)));
  };
  const updateRow = (key, patch) => {
    setErrors((current) => ({ ...current, materials: undefined }));
    setForm((current) => ({ ...current, materials: current.materials.map((row) => (row.key === key ? { ...row, ...patch } : row)) }));
  };
  const removeRow = (key) =>
    setForm((current) => {
      const rest = current.materials.filter((row) => row.key !== key);
      return { ...current, materials: rest.length ? rest : [newRow()] };
    });

  const estimatedCost = form.materials.reduce((sum, row) => {
    const item = itemsById.get(row.itemId);
    return sum + (item ? (Number(row.defaultAmount) || 0) * (Number(item.cost) || 0) : 0);
  }, 0);

  const handleSubmit = (event) => {
    event.preventDefault();
    const found = validateServiceForm(form, services, initial?.id || null);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      defaultPrice: form.defaultPrice === "" ? null : Number(form.defaultPrice),
      defaultDurationMinutes: form.defaultDurationMinutes === "" ? null : Number(form.defaultDurationMinutes),
      materials: form.materials
        .filter((row) => row.itemId)
        .map((row) => ({ itemId: row.itemId, defaultAmount: Number(row.defaultAmount) })),
    });
  };

  const alreadyChosen = (key) => new Set(form.materials.filter((row) => row.key !== key).map((row) => row.itemId).filter(Boolean));

  return (
    <Modal
      title={isEdit ? "Edit service" : "Add service"}
      eyebrow="Service profile"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="service-form" disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add service"}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: "1rem" }}>
        <Field label="Service name" required error={errors.name}>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            maxLength={LIMITS.SHORT_TEXT_MAX}
            placeholder="e.g. Termite Control"
            invalid={Boolean(errors.name)}
            autoFocus
          />
        </Field>

        <Field label="Description" hint="Optional. What the visit covers, shown to the office only.">
          <Textarea
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            maxLength={LIMITS.NOTES_MAX}
            rows={2}
          />
        </Field>

        {/* Pinned to the top, with one-line hints, so the two inputs sit on
            the same line: a stretched Field hands the extra height to its rows
            and pushes one input down whenever the hints wrap differently. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", alignItems: "start" }}>
          <Field label="Default price (₱)" hint="Prefills the booking form." error={errors.defaultPrice} style={{ alignContent: "start" }}>
            <Input
              type="number"
              min="0"
              max={LIMITS.MAX_PRICE}
              step="0.01"
              value={form.defaultPrice}
              onChange={(event) => set("defaultPrice", event.target.value)}
              placeholder="0.00"
              invalid={Boolean(errors.defaultPrice)}
            />
          </Field>
          <Field label="Default duration" hint="Hours and minutes, up to 13 h." error={errors.defaultDurationMinutes} style={{ alignContent: "start" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <Input aria-label="Default duration hours" type="number" min="0" max="13" step="1" value={durationHours} onChange={(event) => setDurationPart("hours", event.target.value)} placeholder="Hours" invalid={Boolean(errors.defaultDurationMinutes)} />
              <Input aria-label="Default duration minutes" type="number" min="0" max="59" step="1" value={durationMinutes} onChange={(event) => setDurationPart("minutes", event.target.value)} placeholder="Minutes" invalid={Boolean(errors.defaultDurationMinutes)} />
            </div>
          </Field>
        </div>

        <section style={{ display: "grid", gap: "0.6rem", padding: "0.9rem", border: `1px solid ${colors.line}`, borderRadius: "3.75px", background: colors.canvas }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <div>
              <strong style={{ color: colors.ink, fontSize: "0.85rem" }}>Default materials</strong>
              <div style={{ color: colors.muted, fontSize: "0.74rem", marginTop: "0.15rem" }}>
                Prefilled on the appointment's Stock-Out tab. The technician adjusts them to what was actually used.
              </div>
            </div>
            <Button size="sm" onClick={() => setForm((current) => ({ ...current, materials: [...current.materials, newRow()] }))}>
              <Plus size={14} /> Add material
            </Button>
          </div>

          {form.materials.map((row) => {
            const item = itemsById.get(row.itemId);
            const taken = alreadyChosen(row.key);
            return (
              <div key={row.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px auto", gap: "0.5rem", alignItems: "center" }}>
                <Select aria-label="Material" value={row.itemId} onChange={(event) => updateRow(row.key, { itemId: event.target.value })}>
                  <option value="">Select an inventory item</option>
                  {groups.map((group) => (
                    <optgroup key={group.type} label={TYPE_LABELS[group.type] || group.type}>
                      {group.items.map((option) => (
                        <option key={option.id} value={option.id} disabled={taken.has(option.id)}>
                          {option.name} ({option.unit}){option.status === "DISABLED" ? " — disabled" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Input
                  aria-label="Default quantity"
                  type="number"
                  min="0"
                  max={LIMITS.MAX_MOVEMENT_QTY}
                  step="any"
                  value={row.defaultAmount}
                  onChange={(event) => updateRow(row.key, { defaultAmount: event.target.value })}
                  placeholder={item ? `Qty (${item.unit})` : "Qty"}
                  disabled={!row.itemId}
                />
                <Button size="icon" variant="ghost" aria-label="Remove material" onClick={() => removeRow(row.key)}>
                  <X size={15} />
                </Button>
              </div>
            );
          })}

          {inventory.length === 0 && <span style={{ color: colors.muted, fontSize: "0.74rem" }}>No inventory items yet. Add them on the Inventory page first.</span>}
          {errors.materials && <span role="alert" style={{ color: colors.danger, fontSize: "0.76rem", fontWeight: 500 }}>{errors.materials}</span>}
          {estimatedCost > 0 && (
            <span style={{ color: colors.muted, fontSize: "0.74rem" }}>
              Estimated material cost per visit: <strong style={{ color: colors.ink }}>{peso(estimatedCost)}</strong> at current item costs.
            </span>
          )}
        </section>
      </form>
    </Modal>
  );
}

export default function ServiceProfilesAdmin() {
  const { showSuccess, showError } = useToast();
  const { services, loading, error, saveService, setServiceActive, deleteService } = useServices();
  const { inventory } = useInventory();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null closed, {} new, service to edit
  const [deleteTarget, setDeleteTarget] = useState(null);

  const itemsById = useMemo(() => new Map(inventory.map((item) => [item.id, item])), [inventory]);

  const handleSave = async (fields) => {
    setBusy(true);
    const result = await saveService(editing?.id || null, fields);
    setBusy(false);
    if (result !== true) {
      showError(result);
      return;
    }
    showSuccess(editing?.id ? "Service updated." : "Service added.");
    setEditing(null);
  };

  const handleToggle = async (service) => {
    setBusy(true);
    const result = await setServiceActive(service.id, !service.isActive);
    setBusy(false);
    if (result !== true) showError(result);
    else showSuccess(service.isActive ? "Service retired. It no longer appears on the booking form." : "Service restored.");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const result = await deleteService(deleteTarget.id);
    setBusy(false);
    setDeleteTarget(null);
    if (result !== true) showError(result);
    else showSuccess("Service deleted. Past appointments keep their service name.");
  };

  return (
    <section style={{ ...card, padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.15rem", color: colors.ink }}>Service Profiles</h2>
          <p style={{ margin: "0.25rem 0 0", color: colors.muted, fontSize: "0.82rem", maxWidth: "62ch" }}>
            The services offered on the booking form, and the materials each one normally uses. Booking a service prefills the appointment's Stock-Out tab.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing({})}>
          <Plus size={16} /> Add service
        </Button>
      </div>

      {loading && <div style={{ padding: "1.5rem", textAlign: "center", color: colors.muted }}>Loading…</div>}
      {!loading && error && (
        <div role="alert" style={{ padding: "0.9rem", borderRadius: "3.75px", background: colors.brandWash, color: colors.danger, fontSize: "0.84rem" }}>
          Could not load services: {error}. If this mentions a missing table, apply supabase/migrations/047-service-profiles-and-safeguards.sql.
        </div>
      )}
      {!loading && !error && services.length === 0 && (
        <div style={{ padding: "1.5rem", textAlign: "center", color: colors.muted, fontSize: "0.88rem" }}>No services yet. Add the first one.</div>
      )}

      <div style={{ display: "grid", gap: "0.5rem" }}>
        {services.map((service) => (
          <article
            key={service.id}
            data-testid="service-row"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "0.75rem",
              alignItems: "start",
              padding: "0.85rem 1rem",
              border: `1px solid ${colors.line}`,
              borderRadius: "3.75px",
              background: service.isActive ? colors.panel : colors.canvas,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <strong style={{ color: service.isActive ? colors.ink : colors.muted, fontSize: "0.94rem", overflowWrap: "anywhere" }}>{service.name}</strong>
                {!service.isActive && (
                  <span style={{ fontSize: "0.68rem", fontWeight: 500, color: colors.muted, background: colors.sunken, borderRadius: "999px", padding: "0.15rem 0.5rem" }}>Retired</span>
                )}
              </div>
              <div style={{ color: colors.muted, fontSize: "0.76rem", marginTop: "0.25rem", display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
                <span>Price: {service.defaultPrice === null ? "—" : peso(service.defaultPrice)}</span>
                <span>Duration: {formatDuration(service.defaultDurationMinutes)}</span>
                <span>
                  <PackageCheck size={12} style={{ verticalAlign: "-2px", marginRight: "0.25rem" }} />
                  {service.materials.length} material{service.materials.length === 1 ? "" : "s"}
                </span>
              </div>
              {service.materials.length > 0 && (
                <div style={{ color: colors.body, fontSize: "0.76rem", marginTop: "0.35rem", overflowWrap: "anywhere" }}>
                  {service.materials
                    .map((material) => {
                      const item = itemsById.get(material.itemId);
                      return item ? `${item.name} · ${material.defaultAmount} ${item.unit}` : `Unknown item · ${material.defaultAmount}`;
                    })
                    .join("  •  ")}
                </div>
              )}
              {service.description && <div style={{ color: colors.muted, fontSize: "0.76rem", marginTop: "0.3rem" }}>{service.description}</div>}
            </div>
            <div style={{ display: "flex", gap: "0.15rem" }}>
              <Button size="icon" variant="ghost" aria-label={`Edit ${service.name}`} title="Edit" onClick={() => setEditing(service)}>
                <Pencil size={15} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={service.isActive ? `Retire ${service.name}` : `Restore ${service.name}`}
                title={service.isActive ? "Retire (hide from the booking form)" : "Restore"}
                disabled={busy}
                onClick={() => handleToggle(service)}
              >
                {service.isActive ? <EyeOff size={15} /> : <Eye size={15} />}
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Delete ${service.name}`} title="Delete" onClick={() => setDeleteTarget(service)}>
                <Trash2 size={15} color={colors.danger} />
              </Button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <ServiceModal
          initial={editing}
          services={services}
          inventory={inventory}
          busy={busy}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete service"
        message={`Permanently delete "${deleteTarget?.name}" and its materials list? Past and upcoming appointments keep the service name they were booked under — only the Stock-Out prefill link is removed. To just hide it from the booking form, retire it instead.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
