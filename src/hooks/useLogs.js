// Reads the system activity log (migration 059: the system_logs table).
//
// Reloads when this browser writes an entry (logService's subscription) and
// every 30 seconds while open, so entries other people make show up too.

import { useCallback, useEffect, useState } from "react";
import { fetchLogs, subscribe } from "../services/logService";

const REFRESH_MS = 30000;

export default function useLogs(limit = 500) {
  const [state, setState] = useState({ logs: [], loading: true, error: "", shared: true });

  const load = useCallback(async () => {
    const result = await fetchLogs(limit);
    setState({ logs: result.logs, loading: false, error: result.error || "", shared: result.shared });
  }, [limit]);

  useEffect(() => {
    load();
    const unsubscribe = subscribe(load);
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [load]);

  return { ...state, reload: load };
}
