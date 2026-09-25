// Settings route — hosts the change-password form.
//
// Lives in pages/ rather than components/settings/ so the rule "pages/ are
// routes, components/ are pieces" holds everywhere.
// Settings route — restructured layout with application preferences and security navigation.

import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import ChangePassword from "../components/settings/ChangePassword";
import useUsers from "../hooks/useUsers";
import { useToast } from "../context/ToastContext";
import useAuth from "../hooks/useAuth";
import { card, colors, fieldGrid, pageShell, primaryButton } from "../styles/theme";
import { Globe, Lock, ShieldCheck, UserCheck } from "lucide-react";

function SettingsPage() {
  const { changeOwnPassword } = useUsers();
  const { showSuccess } = useToast();
  const { currentUser } = useAuth();

  const handleChangePassword = async (currentPassword, newPassword) => {
    const result = await changeOwnPassword(currentPassword, newPassword);
    if (result === true) {
      showSuccess("Your password has been updated.");
      return true;
    }
    return result;
  };

  return (
    <div style={pageShell}>
      {/* One page, one <h1>. This rendered two PageHeaders both titled
          "Settings", which read as two pages spliced together and gave the
          document two competing top-level headings. */}
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Your sign-in details, and the formatting standards the whole app uses."
      />

      <div style={{ display: "grid", gap: "1.5rem", maxWidth: "800px" }}>
        <ChangePassword onSubmit={handleChangePassword} />
        {/* Account Security Card */}
        <section style={{ ...card, padding: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "3.75px",
                background: "#fee2e2",
                color: "#9a2d24",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <Lock size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.15rem", color: colors.ink }}>
                Password & Security
              </h2>
              <p style={{ margin: "0 0 1.25rem", color: colors.muted, lineHeight: 1.5, fontSize: "0.9rem" }}>
                Password update and authentication controls have been unified into your personal account profile.
                You can change your password and view account activity anytime.
              </p>
              <Link
                to="/account?tab=security"
                style={{
                  ...primaryButton,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.9rem",
                }}
              >
                <ShieldCheck size={17} />
                Manage Password & Security in My Profile
              </Link>
            </div>
          </div>
        </section>

        {/* Regional & Localization Settings */}
        <section style={{ ...card, padding: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "1rem" }}>
            <Globe size={20} color={colors.brandInk} />
            <h2 style={{ margin: 0, fontSize: "1.15rem", color: colors.ink }}>
              Regional & Formatting Standards
            </h2>
          </div>
          <p style={{ margin: "0 0 1.25rem", color: colors.muted, fontSize: "0.88rem" }}>
            System-wide standards configured for Torres Pest Control operations:
          </p>

          <div style={{ ...fieldGrid }}>
            <div style={{ padding: "0.85rem", background: "#efe9e0", borderRadius: "3.75px", border: "1px solid #efe9e0" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#96897b", textTransform: "uppercase" }}>
                Currency Metric
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 500, color: "#211b15", marginTop: "0.25rem" }}>
                ₱ (PHP - Philippine Peso)
              </div>
            </div>

            <div style={{ padding: "0.85rem", background: "#efe9e0", borderRadius: "3.75px", border: "1px solid #efe9e0" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#96897b", textTransform: "uppercase" }}>
                Mobile Number Format
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 500, color: "#211b15", marginTop: "0.25rem" }}>
                09XXXXXXXXX (11 digits)
              </div>
            </div>

            <div style={{ padding: "0.85rem", background: "#efe9e0", borderRadius: "3.75px", border: "1px solid #efe9e0" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#96897b", textTransform: "uppercase" }}>
                Standard Time Zone
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 500, color: "#211b15", marginTop: "0.25rem" }}>
                Asia/Manila (UTC+08:00)
              </div>
            </div>
          </div>
        </section>

        {/* Current Session Summary */}
        <section style={{ ...card, padding: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.75rem" }}>
            <UserCheck size={20} color={colors.brandInk} />
            <h2 style={{ margin: 0, fontSize: "1.15rem", color: colors.ink }}>
              Current Session
            </h2>
          </div>
          <div style={{ color: colors.body, fontSize: "0.92rem", lineHeight: 1.6 }}>
            Signed in as <strong>{currentUser?.name || currentUser?.username || currentUser?.email}</strong> with role{" "}
            <span style={{ fontWeight: 500, color: colors.brandInk }}>{currentUser?.role}</span>.
          </div>
        </section>
      </div>
    </div>
  );
}

export default SettingsPage;
