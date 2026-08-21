// Session, current user, and permission checks.
//
//   const { currentUser, can, logout } = useAuth();
//   if (can(SUBSYSTEMS.USERS, "edit")) { ... }

import { useAuthContext } from "../context/AuthContext";

export default function useAuth() {
  const { session, currentUser, loading, error, can, login, logout } = useAuthContext();
  return {
    session,
    currentUser,
    role: currentUser?.role || null,
    isAuthenticated: Boolean(session),
    loading,
    error,
    can,
    login,
    logout,
  };
}
