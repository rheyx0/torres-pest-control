// Client profiles and their documents.
//
// Now Supabase-backed rather than localStorage, so every mutator is async and
// returns either `true` or an error string — the same contract the account
// mutators in AuthContext use.
//
// State is kept locally and patched after each successful write rather than
// refetching the whole list, so the UI stays responsive.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as clientService from "../services/clientService";
import { addLog, LOG_TYPES } from "../services/logService";
import { useAuthContext } from "./AuthContext";

const ClientsContext = createContext(null);

export function ClientsProvider({ children }) {
  const { currentUser, session } = useAuthContext();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const actor = currentUser?.name;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    const result = await clientService.fetchClients();
    if (result.error) setError(result.error);
    else setClients(result.clients);

    setLoading(false);
    return result;
  }, []);

  // Load once there's a session; clear on logout so the next user doesn't
  // briefly see the previous one's data.
  useEffect(() => {
    if (!session) {
      setClients([]);
      setError("");
      return;
    }
    refresh();
  }, [session, refresh]);

  const addClient = useCallback(
    async (form) => {
      const { client, error: createError } = await clientService.createClient(form);
      if (createError) return createError;

      setClients((previous) => [client, ...previous]);
      addLog(actor, `Created client profile for ${client.name}.`, LOG_TYPES.CLIENT);
      return client;
    },
    [actor]
  );

  const updateClient = useCallback(
    async (clientId, form) => {
      const { client, error: updateError } = await clientService.updateClient(clientId, form);
      if (updateError) return updateError;

      // The row comes back without documents; keep the ones already loaded.
      setClients((previous) =>
        previous.map((entry) =>
          entry.id === clientId ? { ...client, documents: entry.documents } : entry
        )
      );
      addLog(actor, `Updated client profile for ${client.name}.`, LOG_TYPES.CLIENT);
      return true;
    },
    [actor]
  );

  const addDocument = useCallback(
    async (clientId, file) => {
      const { document, error: uploadError } = await clientService.uploadDocument(clientId, file);
      if (uploadError) return uploadError;

      setClients((previous) =>
        previous.map((client) =>
          client.id === clientId
            ? { ...client, documents: [document, ...(client.documents || [])] }
            : client
        )
      );
      addLog(actor, `Uploaded "${document.name}".`, LOG_TYPES.DOCUMENT);
      return true;
    },
    [actor]
  );

  const removeDocument = useCallback(
    async (clientId, document) => {
      const { error: deleteError } = await clientService.deleteDocument(document);
      if (deleteError) return deleteError;

      setClients((previous) =>
        previous.map((client) =>
          client.id === clientId
            ? { ...client, documents: (client.documents || []).filter((doc) => doc.id !== document.id) }
            : client
        )
      );
      addLog(actor, `Removed "${document.name}".`, LOG_TYPES.DOCUMENT);
      return true;
    },
    [actor]
  );

  const getClient = useCallback(
    (clientId) => clients.find((client) => client.id === clientId) || null,
    [clients]
  );

  const value = useMemo(
    () => ({
      clients,
      loading,
      error,
      refresh,
      addClient,
      updateClient,
      addDocument,
      removeDocument,
      getClient,
      getDocumentUrl: clientService.getDocumentUrl,
    }),
    [clients, loading, error, refresh, addClient, updateClient, addDocument, removeDocument, getClient]
  );

  return <ClientsContext.Provider value={value}>{children}</ClientsContext.Provider>;
}

export function useClientsContext() {
  const context = useContext(ClientsContext);
  if (!context) throw new Error("useClientsContext must be used inside <ClientsProvider>.");
  return context;
}

export default ClientsContext;
