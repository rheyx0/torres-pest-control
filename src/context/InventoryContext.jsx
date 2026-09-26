// Inventory items. Same shape as ClientsContext — Supabase-backed, async
// mutators that resolve to `true` or an error string.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as inventoryService from "../services/inventoryService";
import * as appointmentService from "../services/appointmentService";
import { addLog, LOG_TYPES } from "../services/logService";
import { STOCK_OUT_REASON_LABELS } from "../utils/constants";
import { todayISO, validateMovementDate, validateQuantity } from "../utils/validators";
import { useAuthContext } from "./AuthContext";

const InventoryContext = createContext(null);

export function InventoryProvider({ children }) {
  const { currentUser, session, sessionVerified } = useAuthContext();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState("");
  // Chemical batches (migration 055); empty before it.
  const [batches, setBatches] = useState([]);

  const actor = currentUser?.name;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    const result = await inventoryService.fetchInventory();
    if (result.error) setError(result.error);
    else setInventory(result.inventory);

    setLoading(false);
    return result;
  }, []);

  const refreshMovements = useCallback(async () => {
    setMovementsLoading(true);
    setMovementsError("");

    const result = await inventoryService.fetchMovements();
    if (result.error) setMovementsError(result.error);
    else setMovements(result.movements);

    setMovementsLoading(false);
    return result;
  }, []);

  const refreshBatches = useCallback(async () => {
    const result = await inventoryService.fetchBatches();
    if (!result.error) setBatches(result.batches);
    return result;
  }, []);

  // After anything that moves stock: the shelf, the log and the batches all
  // changed, and a chemical's movement can be several rows.
  const reloadStock = useCallback(
    () => Promise.all([refresh(), refreshMovements(), refreshBatches()]),
    [refresh, refreshMovements, refreshBatches]
  );

  useEffect(() => {
    if (!session || !sessionVerified) {
      setInventory([]);
      setMovements([]);
      setBatches([]);
      setError("");
      setMovementsError("");
      return;
    }
    refresh();
    refreshBatches();
  }, [session, sessionVerified, refresh, refreshBatches]);

  const addItem = useCallback(
    async (form) => {
      const { item, error: createError } = await inventoryService.createItem(form, currentUser?.id, inventory);
      if (createError) return createError;

      setInventory((previous) => [item, ...previous]);
      addLog(actor, `Added "${item.name}" to inventory.`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor, currentUser?.id, inventory]
  );

  const updateItem = useCallback(
    async (itemId, form) => {
      const { item, error: updateError } = await inventoryService.updateItem(itemId, form, inventory);
      if (updateError) return updateError;

      setInventory((previous) => previous.map((entry) => (entry.id === itemId ? item : entry)));
      addLog(actor, `Updated "${item.name}".`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor, inventory]
  );

  const removeItem = useCallback(
    async (itemId) => {
      const target = inventory.find((entry) => entry.id === itemId);
      const { error: deleteError } = await inventoryService.deleteItem(itemId);
      if (deleteError) return deleteError;

      setInventory((previous) => previous.filter((entry) => entry.id !== itemId));
      addLog(actor, `Removed "${target?.name || "an item"}" from inventory.`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor, inventory]
  );

  /** Edit only ever changes Name / Type / Unit — see updateItemBasics(). */
  const updateItemBasics = useCallback(
    async (itemId, form) => {
      const { item, error: updateError } = await inventoryService.updateItemBasics(itemId, form);
      if (updateError) return updateError;

      setInventory((previous) => previous.map((entry) => (entry.id === itemId ? item : entry)));
      addLog(actor, `Edited "${item.name}".`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor]
  );

  const setItemStatus = useCallback(
    async (itemId, status) => {
      const { item, error: statusError } = await inventoryService.setItemStatus(itemId, status);
      if (statusError) return statusError;

      setInventory((previous) => previous.map((entry) => (entry.id === itemId ? item : entry)));
      const verb = status === inventoryService.INVENTORY_STATUS.DISABLED ? "Disabled" : "Enabled";
      addLog(actor, `${verb} "${item.name}".`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor]
  );

  /**
   * A whole delivery at once. One RPC, one transaction — partial success is
   * impossible, so local state is only touched after the server has committed
   * every line.
   */
  const stockInMany = useCallback(
    async (entries, { date, reference, intakeBranchOrStation, idempotencyKey }) => {
      const result = await inventoryService.stockInBatch(entries, {
        date,
        reference,
        intakeBranchOrStation,
        idempotencyKey,
      });
      if (result.error) return result.error;

      setInventory((previous) => previous.map((entry) => {
        const movement = result.movements.find((row) => row.itemId === entry.id);
        if (!movement) return entry;
        const requested = entries.find((row) => row.itemId === entry.id);
        return {
          ...entry,
          quantity: movement.newQuantity,
          // The server's word on the item's expiry after this delivery.
          ...(movement.expirationDate !== undefined ? { expirationDate: movement.expirationDate } : {}),
          cost: requested?.unitCost === "" || requested?.unitCost === undefined || requested?.unitCost === null
            ? entry.cost
            : Number(requested.unitCost),
        };
      }));

      setMovements((previous) => [
        ...result.movements.map((movement) => {
          const target = inventory.find((entry) => entry.id === movement.itemId);
          return { ...movement, itemName: target?.name || "Unknown item", itemUnit: target?.unit || "" };
        }),
        ...previous,
      ]);

      // A chemical line became a batch (migration 055).
      refreshBatches();

      addLog(
        actor,
        `Stocked in ${result.movements.length} item${result.movements.length === 1 ? "" : "s"} against ${reference}.`,
        LOG_TYPES.INVENTORY
      );
      return true;
    },
    [actor, inventory, refreshBatches]
  );

  /**
   * Stock leaving for a reason other than an appointment. A chemical leaves by
   * batch (migration 055), so one stock-out can be several rows: the lists
   * are reloaded rather than patched.
   */
  const stockOutManual = useCallback(
    async (itemId, { amount, date, reason, technicianId, note, forAppointmentId, batchId }) => {
      const target = inventory.find((entry) => entry.id === itemId);
      if (!target) return "Inventory item not found.";
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return "Enter a quantity greater than zero.";
      if (Number(amount) > Number(target.quantity)) return "Requested quantity exceeds available stock.";
      if (reason === "TECHNICIAN_CHECKOUT" && !technicianId) return "Select the technician the stock was checked out to.";

      const result = await inventoryService.stockOutManual(itemId, { amount, date, reason, technicianId, note, forAppointmentId, batchId });
      if (result.error) return result.error;

      await reloadStock();
      addLog(actor, `Stocked out ${amount} ${target.unit} of "${target.name}" (${STOCK_OUT_REASON_LABELS[reason] || reason}).`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor, inventory, reloadStock]
  );

  // A visit's materials. The server draws first from what the visit's crew
  // checked out (054), then the shelf by batch, soonest expiry first (055), so
  // whether there is "enough" is its call, not a comparison with the shelf
  // here — and one line can come back as several rows. The lists are
  // reloaded rather than patched.
  const stockOutMany = useCallback(
    async (appointmentId, entries, date = todayISO()) => {
      const dateError = validateMovementDate(date);
      if (dateError) return dateError;
      for (const entry of entries) {
        const target = inventory.find((item) => item.id === entry.itemId);
        if (!target) return "Inventory item not found.";
        // Decimals are allowed on the way out (migration 036): 0.4 L applied
        // is the honest figure.
        const quantityError = validateQuantity(entry.amount, { label: "Stock-out quantity" });
        if (quantityError) return quantityError;
      }

      const result = await appointmentService.stockOutBatch(appointmentId, entries, date);
      if (result.error) return result.error;
      if (!result.movements.length) return "Stock Out did not return a saved movement.";
      await reloadStock();
      return result.movements;
    },
    [inventory, reloadStock]
  );

  /** Checked-out stock back on the shelf, with a reason (migration 054). */
  const returnCheckout = useCallback(
    async (checkout, { amount, reason, appointmentId, note, date }) => {
      const quantityError = validateQuantity(amount, { label: "Quantity returned" });
      if (quantityError) return quantityError;
      const dateError = validateMovementDate(date);
      if (dateError) return dateError;

      const result = await inventoryService.returnCheckout(checkout.id, { amount, reason, appointmentId, note, date });
      if (result.error) return result.error;
      await reloadStock();
      addLog(actor, `Returned ${amount} ${checkout.itemUnit || ""} of "${checkout.itemName}" to stock.`.replace("  ", " "), LOG_TYPES.INVENTORY);
      return true;
    },
    [actor, reloadStock]
  );

  /** A counted difference; for a chemical, on `batchId` or by expiry (migration 055). */
  const stockCorrection = useCallback(async (itemId, delta, reason, { batchId } = {}) => {
    const target = inventory.find((entry) => entry.id === itemId);
    if (!target) return "Inventory item not found.";
    if (!Number.isInteger(Number(delta)) || Number(delta) === 0) return "Correction must be a non-zero whole number.";
    // The same cap as every other movement (LIMITS, migrations 047 and 058).
    const sizeError = validateQuantity(Math.abs(Number(delta)), { label: "A correction" });
    if (sizeError) return sizeError;
    if (Number(target.quantity) + Number(delta) < 0) return "Correction cannot make stock negative.";
    const result = await inventoryService.stockCorrection(itemId, delta, reason, { batchId });
    if (result.error) return result.error;
    await reloadStock();
    return true;
  }, [inventory, reloadStock]);

  // Admin batch tools (migration 055). Each resolves to true or an error.
  const batchAction = useCallback(async (call, logLine) => {
    const result = await call();
    if (result.error) return result.error;
    await reloadStock();
    if (logLine) addLog(actor, logLine, LOG_TYPES.INVENTORY);
    return true;
  }, [actor, reloadStock]);

  const writeOffBatch = useCallback(
    (batch, note) => batchAction(() => inventoryService.writeOffBatch(batch.id, note), `Wrote off expired batch ${batch.lotNumber || batch.reference}.`),
    [batchAction]
  );
  const updateBatch = useCallback(
    (batch, changes) => batchAction(() => inventoryService.updateBatch(batch.id, changes), `Corrected batch ${batch.reference}.`),
    [batchAction]
  );
  const splitBatch = useCallback(
    (batch, split) => batchAction(() => inventoryService.splitBatch(batch.id, split), `Split ${split.amount} off batch ${batch.reference}.`),
    [batchAction]
  );

  useEffect(() => {
    if (session && sessionVerified) refreshMovements();
  }, [session, sessionVerified, refreshMovements]);

  const value = useMemo(
    () => ({
      inventory,
      loading,
      error,
      refresh,
      addItem,
      updateItem,
      updateItemBasics,
      removeItem,
      setItemStatus,
      stockInMany,
      stockOutManual,
      stockOutMany,
      returnCheckout,
      stockCorrection,
      movements,
      movementsLoading,
      movementsError,
      refreshMovements,
      batches,
      refreshBatches,
      writeOffBatch,
      updateBatch,
      splitBatch,
    }),
    [
      inventory,
      loading,
      error,
      refresh,
      addItem,
      updateItem,
      updateItemBasics,
      removeItem,
      setItemStatus,
      stockInMany,
      stockOutManual,
      stockOutMany,
      returnCheckout,
      stockCorrection,
      movements,
      movementsLoading,
      movementsError,
      refreshMovements,
      batches,
      refreshBatches,
      writeOffBatch,
      updateBatch,
      splitBatch,
    ]
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventoryContext() {
  const context = useContext(InventoryContext);
  if (!context) throw new Error("useInventoryContext must be used inside <InventoryProvider>.");
  return context;
}

export default InventoryContext;
