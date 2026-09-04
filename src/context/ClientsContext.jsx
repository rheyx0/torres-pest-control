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
import { can, SUBSYSTEMS } from "../utils/permissions";

const ClientsContext = createContext(null);

export function ClientsProvider({ children }) {
  const { currentUser, session, sessionVerified } = useAuthContext();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const actor = currentUser?.name;
  const allowed = useCallback(
    (subsystem, action) => can(currentUser?.role, subsystem, action),
    [currentUser?.role]
  );

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
    if (!session || !sessionVerified) {
      setClients([]);
      setError("");
      return;
    }
    refresh();
  }, [session, sessionVerified, refresh]);

  const addClient = useCallback(
    async (form) => {
      if (!allowed(SUBSYSTEMS.CLIENTS, "create")) return "You do not have permission to create client profiles.";
      const { client, error: createError } = await clientService.createClient(form);
      if (createError) return createError;

      setClients((previous) => [client, ...previous]);
      addLog(actor, `Created client profile for ${client.name}.`, LOG_TYPES.CLIENT);
      return client;
    },
    [actor, allowed]
  );

  const archiveClient = useCallback(
    async (clientId) => {
      if (!allowed(SUBSYSTEMS.CLIENTS, "delete")) return "You do not have permission to archive client profiles.";
      const target = clients.find((client) => client.id === clientId);
      if (!target) return "Client not found.";
      const { client, error: archiveError } = await clientService.archiveClient(clientId, target.version);
      if (archiveError) return archiveError;
      setClients((previous) => previous.map((entry) => (entry.id === clientId ? client : entry)));
      addLog(actor, `Archived client profile for ${client.name}.`, LOG_TYPES.CLIENT);
      return true;
    },
    [actor, allowed, clients]
  );

  const updateClient = useCallback(
    async (clientId, form) => {
      if (!allowed(SUBSYSTEMS.CLIENTS, "edit")) return "You do not have permission to edit client profiles.";
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
    [actor, allowed]
  );

  const addDocument = useCallback(
    async (clientId, file) => {
      if (!allowed(SUBSYSTEMS.CLIENT_DOCUMENTS, "create")) return "You do not have permission to upload documents.";
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
    [actor, allowed]
  );

  const removeDocument = useCallback(
    async (clientId, document) => {
      if (!allowed(SUBSYSTEMS.CLIENT_DOCUMENTS, "delete")) return "You do not have permission to delete documents.";
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
    [actor, allowed]
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
      archiveClient,
      getClient,
      getDocumentUrl: clientService.getDocumentUrl,
    }),
    [clients, loading, error, refresh, addClient, updateClient, addDocument, removeDocument, archiveClient, getClient]
  );

  return <ClientsContext.Provider value={value}>{children}</ClientsContext.Provider>;
}

export function useClientsContext() {
  const context = useContext(ClientsContext);
  if (!context) throw new Error("useClientsContext must be used inside <ClientsProvider>.");
  return context;
}

export default ClientsContext;
