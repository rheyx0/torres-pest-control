// Reads the system activity log and re-renders when any service writes to it.
//
// The subscription is why services can call addLog() directly instead of
// having a React setter threaded down to them.

import { useEffect, useState } from "react";
import { getLogs, subscribe } from "../services/logService";

export default function useLogs(limit = null) {
  const [logs, setLogs] = useState(() => getLogs());

  useEffect(() => subscribe(setLogs), []);

  return limit ? logs.slice(0, limit) : logs;
}
