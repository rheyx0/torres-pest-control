// Session + account state for the whole app.
//
// Previously all of this lived in App.js as useState/useEffect blocks, and
// every route received accounts and mutators as props. Holding it here means
// RoleBasedRoute can ask "what role is the current user" without being handed
// the answer, and pages read what they need via useAuth()/useUsers().

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as authService from "../services/authService";
import * as userService from "../services/userService";
import { addLog, LOG_TYPES } from "../services/logService";
import { ACCOUNT_STATUS, ROLES } from "../utils/constants";
import { can as checkPermission } from "../utils/permissions";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => authService.loadSession());
  const [admins, setAdmins] = useState([]);
  const [staff, setStaff] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionVerified, setSessionVerified] = useState(!session);

  useEffect(() => {
    authService.saveSession(session);
  }, [session]);

  useEffect(() => {
    let active = true;

    async function verify() {
      if (!session) {
        setSessionVerified(true);
        return;
      }

      setSessionVerified(false);
      const result = await authService.validateSession(session.token);
      if (!active) return;

      if (result.error) {
        setSession(null);
        setSessionVerified(true);
        return;
      }

      setSession((previous) => ({ ...previous, ...result.profile, id: result.profile.id, role: result.profile.role }));
      setSessionVerified(true);
    }

    verify();

    return () => {
      active = false;
    };
  }, [session?.token]);

  const accounts = useMemo(
    () => [...admins, ...staff, ...technicians],
    [admins, staff, technicians]
  );

  const currentUser = useMemo(() => {
    if (!session) return null;
    return accounts.find((account) => account.id === session.id) || null;
  }, [session, accounts]);

  const setCollectionFor = useCallback((role) => {
    if (role === ROLES.ADMIN) return setAdmins;
    if (role === ROLES.STAFF) return setStaff;
    return setTechnicians;
  }, []);

  const refreshAccounts = useCallback(async () => {
    setLoading(true);
    setError("");

    const result = await userService.fetchAllAccounts();
    if (result.error) {
      setError(result.error);
    } else {
      setAdmins(result.admins);
      setStaff(result.staff);
      setTechnicians(result.technicians);
    }

    setLoading(false);
    return result;
  }, []);

  // Load accounts whenever a session appears; clear them when it goes.
  useEffect(() => {
    if (!session || !sessionVerified) {
      setAdmins([]);
      setStaff([]);
      setTechnicians([]);
      setError("");
      return;
    }
    refreshAccounts();
  }, [session, sessionVerified, refreshAccounts]);

  const login = useCallback(async (email, password) => {
    const { session: nextSession, profile, error: loginError } = await authService.login(email, password);
    if (loginError) return loginError;

    setSession(nextSession);
    addLog(profile.name, "Logged in.", LOG_TYPES.AUTH);
    return true;
  }, []);

  const logout = useCallback(async () => {
    if (currentUser) addLog(currentUser.name, "Logged out.", LOG_TYPES.AUTH);
    await authService.logout(session?.token);
    setSession(null);
  }, [currentUser, session?.token]);

  const createAccount = useCallback(
    async (role, fields) => {
      const { account, error: createError } = await userService.createAccount(session?.token, role, fields);
      if (createError) return createError;

      setCollectionFor(role)((previous) => [...previous, account]);
      addLog(
        currentUser?.name,
        `Created ${role.toLowerCase()} account for ${fields.name}.`,
        LOG_TYPES.ADMIN
      );
      return true;
    },
    [currentUser, session?.token, setCollectionFor]
  );

  const updateAccount = useCallback(
    async (userId, updatedFields) => {
      const target = accounts.find((account) => account.id === userId);
      if (!target) return "Account not found.";

      const { error: updateError, updatedAt, account: savedAccount } = await userService.updateAccount(session?.token, target, updatedFields);
      if (updateError) return updateError;

      const nextAccount = savedAccount || { ...target, ...updatedFields, updatedAt };
      setAdmins((previous) => previous.filter((account) => account.id !== userId));
      setStaff((previous) => previous.filter((account) => account.id !== userId));
      setTechnicians((previous) => previous.filter((account) => account.id !== userId));
      setCollectionFor(nextAccount.role)((previous) => [...previous, nextAccount]);
      addLog(currentUser?.name, `Updated account for ${target.name}.`, LOG_TYPES.ADMIN);
      return true;
    },
    [accounts, currentUser, session?.token, setCollectionFor]
  );

  const updateProfile = useCallback(
    async (updatedFields) => {
      if (!currentUser) return "No active user.";

      const { error: updateError, updatedAt } = await userService.updateAccount(session?.token, currentUser, updatedFields);
      if (updateError) return updateError;

      setCollectionFor(currentUser.role)((previous) =>
        previous.map((account) =>
          account.id === currentUser.id ? { ...account, ...updatedFields, updatedAt } : account
        )
      );
      // Self-edits were previously not logged at all.
      addLog(currentUser.name, "Updated their own profile.", LOG_TYPES.ADMIN);
      return true;
    },
    [currentUser, session?.token, setCollectionFor]
  );

  const toggleAccountStatus = useCallback(
    async (userId) => {
      const target = accounts.find((account) => account.id === userId);
      if (!target) return "Account not found.";

      const nextStatus =
        target.status === ACCOUNT_STATUS.ACTIVE ? ACCOUNT_STATUS.INACTIVE : ACCOUNT_STATUS.ACTIVE;

      if (nextStatus === ACCOUNT_STATUS.INACTIVE && userService.isLastActiveAdmin(target, accounts)) {
        return "At least one active admin account is required.";
      }

      const { error: statusError, updatedAt } = await userService.setAccountStatus(session?.token, target, nextStatus);
      if (statusError) return statusError;

      setCollectionFor(target.role)((previous) =>
        previous.map((account) =>
          account.id === userId ? { ...account, status: nextStatus, updatedAt } : account
        )
      );
      addLog(currentUser?.name, `${target.name} account marked ${nextStatus}.`, LOG_TYPES.ADMIN);
      return true;
    },
    [accounts, currentUser, session?.token, setCollectionFor]
  );

  /** Self-service change: verifies the current password first. */
  const changeOwnPassword = useCallback(
    async (currentPassword, newPassword) => {
      if (!currentUser) return "No active user.";

      const { error: passwordError } = await userService.changePassword(session?.token, currentPassword, newPassword);
      if (passwordError) return passwordError;

      addLog(currentUser.name, "Changed their password.", LOG_TYPES.AUTH);
      setSession(null);
      return true;
    },
    [currentUser, session?.token]
  );

  /** Admin-initiated reset: no current password needed. */
  const resetAccountPassword = useCallback(
    async (userId, newPassword) => {
      const target = accounts.find((account) => account.id === userId);
      if (!target) return "Account not found.";

      const { error: passwordError } = await userService.resetPassword(session?.token, target.id, newPassword);
      if (passwordError) return passwordError;

      addLog(currentUser?.name, `Reset the password for ${target.name}.`, LOG_TYPES.AUTH);
      return true;
    },
    [accounts, currentUser, session?.token]
  );

  const can = useCallback(
    (subsystem, action = "view") => checkPermission(currentUser?.role, subsystem, action),
    [currentUser]
  );

  const value = useMemo(
    () => ({
      session,
      sessionVerified,
      currentUser,
      accounts,
      admins,
      staff,
      technicians,
      loading,
      error,
      can,
      login,
      logout,
      refreshAccounts,
      createAccount,
      updateAccount,
      updateProfile,
      toggleAccountStatus,
      changeOwnPassword,
      resetAccountPassword,
    }),
    [
      session,
      sessionVerified,
      currentUser,
      accounts,
      admins,
      staff,
      technicians,
      loading,
      error,
      can,
      login,
      logout,
      refreshAccounts,
      createAccount,
      updateAccount,
      updateProfile,
      toggleAccountStatus,
      changeOwnPassword,
      resetAccountPassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuthContext must be used inside <AuthProvider>.");
  return context;
}

export default AuthContext;
