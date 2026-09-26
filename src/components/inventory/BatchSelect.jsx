// Which batch of a chemical a stock-out takes (migration 055).
//
// Left on "Soonest expiry first", the server picks: the crew's checked-out
// stock, then the shelf by expiry. Choosing a batch says "this is the
// container in my hand" — it goes first, the rest still by expiry. Below the
// picker, the plan: what will actually come out of which batch.
//
// Renders nothing for an item without batches (equipment, materials, or a
// database before 055), so callers can drop it in unconditionally.

import { batchLabel, batchName, describePlan, isExpired, liveBatches, planDraw, usableBatches } from "../../utils/batches";

const round = (value) => Math.round(value * 1e6) / 1e6;

function BatchSelect({
  item,
  batches = [],
  held = [],
  date,
  value,
  onChange,
  amount,
  visitId = "",
  includeExpired = false,
  showPlan = true,
  label = "Batch",
  autoLabel = "",
  selectStyle,
  noteStyle,
}) {
  if (!item || item.type !== "CHEMICAL" || !batches.some((batch) => batch.itemId === item.id)) return null;

  const onShelf = includeExpired ? liveBatches(batches, item.id) : usableBatches(batches, item.id, date);
  const heldByBatch = new Map();
  held.forEach(({ checkout, remaining }) => {
    if (checkout.itemId !== item.id || !checkout.batchId) return;
    heldByBatch.set(checkout.batchId, round((heldByBatch.get(checkout.batchId) || 0) + remaining));
  });
  const choiceIds = new Set([...onShelf.map((batch) => batch.id), ...heldByBatch.keys()]);
  const choices = batches
    .filter((batch) => choiceIds.has(batch.id) && (includeExpired || !isExpired(batch, date)))
    .sort((a, b) => (onShelf.indexOf(a) === -1 ? 1 : 0) - (onShelf.indexOf(b) === -1 ? 1 : 0));

  const wanted = Number(amount) || 0;
  const plan = showPlan && wanted > 0
    ? planDraw({ itemId: item.id, amount: wanted, onDate: date, batches, held, chosenBatchId: value, visitId })
    : null;
  const first = planDraw({ itemId: item.id, amount: 1e-6, onDate: date, batches, held, visitId }).portions[0];
  const firstBatch = first ? batches.find((batch) => batch.id === first.batchId) : null;

  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <select aria-label={label} value={value || ""} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        <option value="">{autoLabel || `Soonest expiry first${firstBatch ? ` — ${batchName(firstBatch)}` : ""}`}</option>
        {choices.map((batch) => {
          const shelf = onShelf.includes(batch) ? batch.quantity : 0;
          const out = heldByBatch.get(batch.id) || 0;
          const where = [shelf ? `${shelf} on the shelf` : "", out ? `${out} checked out` : ""].filter(Boolean).join(", ");
          return (
            <option key={batch.id} value={batch.id}>
              {batchLabel(batch)}{isExpired(batch, date) ? " · EXPIRED" : ""} · {where} {item.unit}
            </option>
          );
        })}
      </select>
      {plan?.error && <span role="alert" style={{ ...noteStyle, color: "#9a2d24" }}>{plan.error}</span>}
      {plan && !plan.error && plan.portions.length > 0 && (
        <span style={noteStyle}>Uses {describePlan(plan.portions, item.unit, batches)}.</span>
      )}
    </div>
  );
}

export default BatchSelect;
