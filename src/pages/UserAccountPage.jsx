// The signed-in user's own profile route (/account).
//
// This is the single copy — the earlier structure had UserAccountPage listed
// under both pages/ and components/users/, which is how the previous set of
// duplicate files came about. The form half is components/users/ProfileForm.

import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import ProfileForm from "../components/users/ProfileForm";
import useAuth from "../hooks/useAuth";
import useUsers from "../hooks/useUsers";
import { useToast } from "../context/ToastContext";
import { card, colors, pageShell } from "../styles/theme";

function UserAccountPage() {
  const { currentUser } = useAuth();
  const { updateProfile } = useUsers();
  const { showSuccess, showError } = useToast();

  const handleSubmit = async (fields) => {
    const result = await updateProfile(fields);
    if (result === true) showSuccess("Your profile has been updated.");
    else showError(result);
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
      <PageHeader eyebrow="Profile" title="User Account Profile" />
      <ProfileForm user={currentUser} onSubmit={handleSubmit} />

      <p style={{ marginTop: "1.25rem", color: colors.muted }}>
        Want to change your password?{" "}
        <Link to="/settings" style={{ color: colors.brandInk, fontWeight: 700 }}>
          Go to Settings
        </Link>
        .
      </p>
    </div>
  );
}

export default UserAccountPage;
