import { useInventoryContext } from "../context/InventoryContext";

export default function useInventory() {
  return useInventoryContext();
}
