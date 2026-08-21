// Inventory items. Same shape as ClientsContext — Supabase-backed, async
// mutators that resolve to `true` or an error string.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as inventoryService from "../services/inventoryService";
import { addLog, LOG_TYPES } from "../services/logService";
import { useAuthContext } from "./AuthContext";

const InventoryContext = createContext(null);

export function InventoryProvider({ children }) {
  const { currentUser, session } = useAuthContext();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (!session) {
      setInventory([]);
      setError("");
      return;
    }
    refresh();
  }, [session, refresh]);

  const addItem = useCallback(
    async (form) => {
      const { item, error: createError } = await inventoryService.createItem(form);
      if (createError) return createError;

      setInventory((previous) => [item, ...previous]);
      addLog(actor, `Added "${item.name}" to inventory.`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor]
  );

  const updateItem = useCallback(
    async (itemId, form) => {
      const { item, error: updateError } = await inventoryService.updateItem(itemId, form);
      if (updateError) return updateError;

      setInventory((previous) => previous.map((entry) => (entry.id === itemId ? item : entry)));
      addLog(actor, `Updated "${item.name}".`, LOG_TYPES.INVENTORY);
      return true;
    },
    [actor]
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

  const value = useMemo(
    () => ({ inventory, loading, error, refresh, addItem, updateItem, removeItem }),
    [inventory, loading, error, refresh, addItem, updateItem, removeItem]
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventoryContext() {
  const context = useContext(InventoryContext);
  if (!context) throw new Error("useInventoryContext must be used inside <InventoryProvider>.");
  return context;
}

export default InventoryContext;
