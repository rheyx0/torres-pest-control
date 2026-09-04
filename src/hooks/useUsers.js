// Account list plus every account mutation.
//
// Reads from the same AuthContext as useAuth, because the logged-in user is
// one of the accounts — keeping them in one store is what makes currentUser
// update immediately when an admin edits their own row.

import { useAuthContext } from "../context/AuthContext";

export default function useUsers() {
  const {
    accounts,
    admins,
    staff,
    technicians,
    loading,
    error,
    refreshAccounts,
    createAccount,
    updateAccount,
    updateProfile,
    toggleAccountStatus,
    changeOwnPassword,
    resetAccountPassword,
  } = useAuthContext();

  return {
    users: accounts,
    admins,
    staff,
    technicians,
    loading,
    error,
    refresh: refreshAccounts,
    createAccount,
    updateAccount,
    updateProfile,
    toggleAccountStatus,
    changeOwnPassword,
    resetAccountPassword,
  };
}
