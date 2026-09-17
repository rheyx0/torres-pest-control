import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as notificationService from "../services/notificationService";
import { useAuthContext } from "./AuthContext";

const NotificationsContext = createContext(null);

const POLL_INTERVAL_MS = 60000;

export function NotificationsProvider({ children }) {
  const { session, sessionVerified } = useAuthContext();
  const [notifications, setNotifications] = useState([]);

  const refresh = useCallback(async () => {
    const result = await notificationService.fetchNotifications();
    if (!result.error) setNotifications(result.notifications);
    return result;
  }, []);

  useEffect(() => {
    if (!session || !sessionVerified) {
      setNotifications([]);
      return undefined;
    }
    refresh();
    const intervalId = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [session, sessionVerified, refresh]);

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((entry) => entry.readAt ? entry : { ...entry, readAt }));
    const result = await notificationService.markAllRead();
    if (result.error) refresh();
    return result;
  }, [refresh]);

  const unreadCount = useMemo(
    () => notifications.filter((entry) => !entry.readAt).length,
    [notifications]
  );

  const value = useMemo(
    () => ({ notifications, unreadCount, refresh, markAllRead }),
    [notifications, unreadCount, refresh, markAllRead]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used inside <NotificationsProvider>.");
  return context;
}

export default NotificationsContext;
