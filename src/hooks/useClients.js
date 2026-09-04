// Client list, mutators, and the search/filter helper.
//
//   const { clients, filter } = useClients();
//   const visible = filter({ searchTerm, classification });

import { useCallback } from "react";
import { useClientsContext } from "../context/ClientsContext";
import { filterClients } from "../services/clientService";

export default function useClients() {
  const context = useClientsContext();

  const filter = useCallback(
    (options) => filterClients(context.clients, options),
    [context.clients]
  );

  return { ...context, filter };
}
