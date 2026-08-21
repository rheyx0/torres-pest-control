// User account list route.

import { useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import UserList from "../components/users/UserList";
import ResetPasswordDialog from "../components/users/ResetPasswordDialog";
import useAuth from "../hooks/useAuth";
import useUsers from "../hooks/useUsers";
import { useToast } from "../context/ToastContext";
import { SUBSYSTEMS } from "../utils/permissions";
import { pageShell, primaryButton } from "../styles/theme";

function UsersPage() {
  const { can } = useAuth();
  const { users, updateAccount, toggleAccountStatus, resetAccountPassword } = useUsers();
  const { showSuccess, showError } = useToast();
  const [resetTarget, setResetTarget] = useState(null);

  const canEdit = can(SUBSYSTEMS.USERS, "edit");
  const canCreate = can(SUBSYSTEMS.USERS, "create");

  const handleEdit = async (userId, fields) => {
    const result = await updateAccount(userId, fields);
    if (result === true) {
      showSuccess("Account updated.");
      return true;
    }
    showError(result);
    return result;
  };

  const handleToggleStatus = async (userId) => {
    const result = await toggleAccountStatus(userId);
    if (result === true) showSuccess("Account status updated.");
    else showError(result);
  };

  const handleResetPassword = async (userId, newPassword) => {
    const result = await resetAccountPassword(userId, newPassword);
    if (result === true) {
      showSuccess("Password reset. Share the new password with them directly.");
      return true;
    }
    showError(result);
    return result;
  };

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="System Access"
        title="User Accounts"
        actions={
          canCreate && (
            <Link to="/users/new" style={{ ...primaryButton, textDecoration: "none", display: "inline-block" }}>
              Create Account
            </Link>
          )
        }
      />

      <UserList
        users={users}
        canEdit={canEdit}
        onEdit={handleEdit}
        onToggleStatus={handleToggleStatus}
        onResetPassword={setResetTarget}
      />

      <ResetPasswordDialog
        user={resetTarget}
        onSubmit={handleResetPassword}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}

export default UsersPage;
