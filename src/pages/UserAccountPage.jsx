// The signed-in user's own profile route (/account).
//
// This is the single copy — the earlier structure had UserAccountPage listed
// under both pages/ and components/users/, which is how the previous set of
// duplicate files came about. The form half is components/users/ProfileForm.

import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import ProfileForm from "../components/users/ProfileForm";
import ChangePassword from "../components/settings/ChangePassword";
import useAuth from "../hooks/useAuth";
import useUsers from "../hooks/useUsers";
import { useToast } from "../context/ToastContext";
import { card, colors, pageShell } from "../styles/theme";
import { Shield, UserCircle } from "lucide-react";

function UserAccountPage() {
  const { currentUser } = useAuth();
  const { updateProfile, changeOwnPassword } = useUsers();
  const { showSuccess, showError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get("tab") === "security" ? "security" : "profile";

  const handleProfileSubmit = async (fields) => {
    const result = await updateProfile(fields);
    if (result === true) showSuccess("Your profile has been updated.");
    else showError(result);
  };

  const handleChangePassword = async (currentPassword, newPassword) => {
    const result = await changeOwnPassword(currentPassword, newPassword);
    if (result === true) {
      showSuccess("Your password has been updated. Please sign in again.");
      return true;
    }
    return result;
  };

  if (!currentUser) {
    return (
      <div style={pageShell}>
        <div style={card}>No active user found.</div>
      </div>
    );
  }

  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Account"
        title="User Account & Security"
      />

      {/* Tabs navigation */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: `2px solid #f0f0f0` }}>
        <button
          type="button"
          onClick={() => setSearchParams({})}
          style={{
            border: "none",
            background: "none",
            padding: "0.75rem 0.5rem",
            marginBottom: "-2px",
            borderBottom: activeTab === "profile" ? `3px solid ${colors.brandLight}` : "3px solid transparent",
            color: activeTab === "profile" ? colors.brandInk : "#6b7280",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.95rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
          }}
        >
          <UserCircle size={18} />
          Profile Information
        </button>

        <button
          type="button"
          onClick={() => setSearchParams({ tab: "security" })}
          style={{
            border: "none",
            background: "none",
            padding: "0.75rem 0.5rem",
            marginBottom: "-2px",
            borderBottom: activeTab === "security" ? `3px solid ${colors.brandLight}` : "3px solid transparent",
            color: activeTab === "security" ? colors.brandInk : "#6b7280",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.95rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
          }}
        >
          <Shield size={18} />
          Security & Password
        </button>
      </div>

      {activeTab === "profile" && (
        <ProfileForm user={currentUser} onSubmit={handleProfileSubmit} />
      )}

      {activeTab === "security" && (
        <div style={{ maxWidth: "600px" }}>
          <ChangePassword onSubmit={handleChangePassword} />
        </div>
      )}
    </div>
  );
}

export default UserAccountPage;
