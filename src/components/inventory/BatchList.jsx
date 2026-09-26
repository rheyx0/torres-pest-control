// A chemical's batches (migration 055), soonest expiry first — the order stock
// leaves in. Shown in the item's detail.
//
// Admin actions, each inline under its batch:
//   Write off   an expired batch's leftovers leave with reason EXPIRED;
//   Edit        correct the lot number or expiry (a typo on Stock In, or the
//               real details of the opening batch);
//   Split       move part of a batch into a new one with its own lot and
//               expiry — how the opening batch becomes the real batches.

import { useState } from "react";
import { batchName, byExpiry, isExpired } from "../../utils/batches";
import { formatDate } from "../../utils/formatters";

const cell = { padding: "0.55rem 0.6rem", borderTop: "1px solid #efe9e0", fontSize: "0.82rem", color: "#50463c", verticalAlign: "top" };
const head = { ...cell, borderTop: 0, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#96897b", fontWeight: 500, textAlign: "left" };
const input = { border: "1px solid #e6dfd3", borderRadius: "3.75px", padding: "0.4rem 0.5rem", fontSize: "0.8rem", width: "100%", boxSizing: "border-box" };
const small = { border: "1px solid #e6dfd3", background: "#ffffff", borderRadius: "3.75px", padding: "0.3rem 0.55rem", fontSize: "0.74rem", cursor: "pointer", color: "#211b15" };

function BatchList({ item, batches, today, canManage, onWriteOff, onUpdate, onSplit }) {
  const [open, setOpen] = useState(null); // { batchId, mode: "edit" | "split" | "writeoff" }
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Used-up batches stay in the history; this is what is on the shelf.
  const list = batches.filter((batch) => batch.itemId === item.id && batch.quantity > 0).sort(byExpiry);

  const start = (batch, mode) => {
    setError("");
    setOpen({ batchId: batch.id, mode });
    setValues(mode === "edit"
      ? { lotNumber: batch.lotNumber, expirationDate: batch.expirationDate }
      : { amount: "", lotNumber: "", expirationDate: "", note: "" });
  };

  const run = async (call) => {
    setBusy(true);
    setError("");
    const result = await call();
    setBusy(false);
    if (result === true) setOpen(null);
    else setError(typeof result === "string" ? result : "That did not save.");
  };

  const submit = (batch) => {
    if (open.mode === "writeoff") return run(() => onWriteOff(batch, values.note));
    if (open.mode === "edit") return run(() => onUpdate(batch, { lotNumber: values.lotNumber, expirationDate: values.expirationDate }));
    const amount = Number(values.amount);
    if (!(amount > 0) || amount >= batch.quantity) {
      setError(`Split off more than 0 and less than the ${batch.quantity} ${item.unit} in this batch.`);
      return undefined;
    }
    if (!values.lotNumber.trim() || !values.expirationDate) {
      setError("Enter the new batch's lot number and expiry.");
      return undefined;
    }
    return run(() => onSplit(batch, { amount, lotNumber: values.lotNumber.trim(), expirationDate: values.expirationDate }));
  };

  if (list.length === 0) {
    return <p style={{ margin: 0, color: "#96897b", fontSize: "0.85rem" }}>No batches on the shelf. The next delivery on Stock In starts one.</p>;
  }

  const set = (name) => (event) => setValues((current) => ({ ...current, [name]: event.target.value }));

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <p style={{ margin: 0, color: "#96897b", fontSize: "0.78rem" }}>
        {list.length} batch{list.length === 1 ? "" : "es"} on the shelf. Stock is used from the top down: soonest expiry first.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
          <thead>
            <tr>
              <th style={head}>Batch</th>
              <th style={head}>Lot no.</th>
              <th style={head}>Expires</th>
              <th style={head}>Received</th>
              <th style={{ ...head, textAlign: "right" }}>Left</th>
              {canManage && <th style={head}><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((batch) => {
              const expired = isExpired(batch, today);
              const editing = open?.batchId === batch.id;
              return [
                <tr key={batch.id} style={{ background: expired ? "#f9ecea" : undefined }}>
                  <td style={cell}>
                    <div style={{ color: "#211b15", fontWeight: 500 }}>{batch.reference}</div>
                    {batch.isOpening && <div style={{ fontSize: "0.7rem", color: "#96897b" }}>Opening stock</div>}
                  </td>
                  <td style={cell}>{batch.lotNumber || <span style={{ color: "#96897b" }}>No lot printed</span>}</td>
                  <td style={{ ...cell, color: expired ? "#9a2d24" : cell.color, fontWeight: expired ? 600 : 400 }}>
                    {batch.expirationDate ? formatDate(batch.expirationDate) : "—"}{expired ? " · EXPIRED" : ""}
                  </td>
                  <td style={cell}>{formatDate(batch.receivedDate)}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#211b15" }}>
                    {batch.quantity} / {batch.quantityReceived} {item.unit}
                  </td>
                  {canManage && (
                    <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                      {expired && (
                        <button type="button" style={{ ...small, color: "#9a2d24", marginRight: "0.3rem" }} onClick={() => start(batch, "writeoff")}>Write off</button>
                      )}
                      <button type="button" style={{ ...small, marginRight: "0.3rem" }} onClick={() => start(batch, "edit")}>Edit</button>
                      <button type="button" style={small} onClick={() => start(batch, "split")}>Split</button>
                    </td>
                  )}
                </tr>,
                editing && (
                  <tr key={`${batch.id}-form`}>
                    <td colSpan={canManage ? 6 : 5} style={{ ...cell, background: "#faf7ee" }}>
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        {open.mode === "writeoff" && (
                          <span>
                            Write off the {batch.quantity} {item.unit} left in {batchName(batch)}? It leaves the shelf as expired stock.
                          </span>
                        )}
                        {open.mode === "split" && (
                          <span>Move part of {batch.reference} into a new batch — for stock that turns out to be a different lot.</span>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.5rem" }}>
                          {open.mode === "split" && (
                            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.74rem" }}>
                              Quantity ({item.unit})
                              <input aria-label="Quantity to split off" type="number" min="0" step="any" value={values.amount} onChange={set("amount")} style={input} />
                            </label>
                          )}
                          {open.mode !== "writeoff" && (
                            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.74rem" }}>
                              Lot no.
                              <input aria-label="Lot number" value={values.lotNumber} onChange={set("lotNumber")} style={input} placeholder={open.mode === "edit" ? "Blank if none printed" : ""} />
                            </label>
                          )}
                          {open.mode !== "writeoff" && (
                            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.74rem" }}>
                              Expiry
                              <input aria-label="Batch expiry" type="date" min={batch.receivedDate || undefined} value={values.expirationDate} onChange={set("expirationDate")} style={input} />
                            </label>
                          )}
                          {open.mode === "writeoff" && (
                            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.74rem" }}>
                              Note
                              <input aria-label="Write-off note" value={values.note} onChange={set("note")} style={input} placeholder="Optional — e.g. disposed of per label" />
                            </label>
                          )}
                        </div>
                        {error && <span role="alert" style={{ color: "#9a2d24", fontSize: "0.78rem", fontWeight: 500 }}>{error}</span>}
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button type="button" disabled={busy} style={{ ...small, background: "#8b1e1e", color: "#ffffff", borderColor: "#8b1e1e" }} onClick={() => submit(batch)}>
                            {busy ? "Saving…" : open.mode === "writeoff" ? "Write off" : open.mode === "edit" ? "Save batch" : "Split batch"}
                          </button>
                          <button type="button" style={small} onClick={() => setOpen(null)}>Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default BatchList;
