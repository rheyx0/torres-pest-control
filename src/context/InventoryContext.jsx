// Inventory items. Same shape as ClientsContext — Supabase-backed, async
// mutators that resolve to `true` or an error string.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as inventoryService from "../services/inventoryService";
import { addLog, LOG_TYPES } from "../services/logService";
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

  useEffect(() => {
    if (!session || !sessionVerified) {
      setInventory([]);
      setError("");
      return;
    }
    refresh();
  }, [session, sessionVerified, refresh]);

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
   * The only path that changes quantity. Runs as one server-side
   * transaction (stock_in()), so the movement row and the quantity bump
   * can't drift apart even under concurrent Stock Ins.
   */
  const stockIn = useCallback(
    async (itemId, { amount, date, reference, intakeBranchOrStation, idempotencyKey, unitCost }) => {
      const target = inventory.find((entry) => entry.id === itemId);
      const result = await inventoryService.stockIn(itemId, {
        amount,
        date,
        reference,
        actor,
        actorId: currentUser?.id,
        intakeBranchOrStation,
        idempotencyKey,
        unitCost,
      });
      if (result.error) return result.error;

      setInventory((previous) =>
        previous.map((entry) =>
          entry.id === itemId
            ? { ...entry, quantity: result.newQuantity, cost: unitCost !== undefined ? Number(unitCost) : entry.cost }
            : entry
        )
      );
      setMovements((previous) => [
        { ...result.movement, itemName: target?.name || "Unknown item", itemUnit: target?.unit || "" },
        ...previous,
      ]);
      addLog(actor, `Stocked in ${result.movement.amount} ${target?.unit || ""} of "${target?.name || "an item"}".`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor, currentUser?.id, inventory]
  );

  const refreshMovements = useCallback(async () => {
    setMovementsLoading(true);
    setMovementsError("");

    const result = await inventoryService.fetchMovements();
    if (result.error) setMovementsError(result.error);
    else setMovements(result.movements);

    setMovementsLoading(false);
    return result;
  }, []);

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
      stockIn,
      movements,
      movementsLoading,
      movementsError,
      refreshMovements,
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
      stockIn,
      movements,
      movementsLoading,
      movementsError,
      refreshMovements,
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
