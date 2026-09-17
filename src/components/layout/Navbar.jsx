// Slim top bar above the page content.
//
// Shows who is signed in and gives the profile/settings shortcuts a home that
// isn't the sidebar. Kept deliberately light — the sidebar is still primary
// navigation.

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, UserCog, ShieldCheck, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { useNotifications } from "../../context/NotificationsContext";
import { formatDateTime } from "../../utils/formatters";

const ROLE_LABELS = {
  ADMIN: "ADMIN",
  STAFF: "STAFF",
  TECHNICIAN: "TECHNICIAN",
};

const roleBadgeColors = {
  ADMIN: { background: "#f5f3ff", color: "#6d28d9", border: "1px solid rgba(167, 139, 250, 0.5)" },
  STAFF: { background: "#eff6ff", color: "#1d4ed8", border: "1px solid rgba(147, 197, 253, 0.6)" },
  TECHNICIAN: { background: "#ecfeff", color: "#0f766e", border: "1px solid rgba(103, 232, 249, 0.7)" },
};

function Navbar() {
  const { currentUser, logout: logoutUser } = useAuth();
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  if (!currentUser) return null;

  const userAvatar = currentUser.avatarUrl || null;

  const profileInitials = (currentUser.name || currentUser.username || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const handleAction = (path) => {
    setMenuOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    try {
      await logoutUser();
    } finally {
      navigate("/login");
    }
  };

  const toggleBell = () => {
    setMenuOpen(false);
    setBellOpen((open) => {
      if (!open && unreadCount > 0) markAllRead();
      return !open;
    });
  };

  const openNotification = (notification) => {
    setBellOpen(false);
    if (notification.appointmentId) navigate("/scheduling");
  };

  return (
    <header
      ref={menuRef}
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "1rem",
        padding: "0 0 1.5rem",
        borderBottom: "1px solid rgba(127, 17, 17, 0.1)",
        marginBottom: "1.5rem",
        flexWrap: "wrap",
        position: "relative",
      }}
    >
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button
          type="button"
          onClick={toggleBell}
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "2.4rem",
            height: "2.4rem",
            borderRadius: "999px",
            border: "1px solid rgba(148, 163, 184, 0.28)",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
            cursor: "pointer",
            color: "#0f172a",
          }}
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-0.25rem",
                right: "-0.25rem",
                minWidth: "1.1rem",
                height: "1.1rem",
                padding: "0 0.25rem",
                borderRadius: "999px",
                background: "#b91c1c",
                color: "#fff",
                fontSize: "0.62rem",
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {bellOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 0.7rem)",
              right: 0,
              width: "20rem",
              maxHeight: "22rem",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: "1rem",
              border: "1px solid rgba(148, 163, 184, 0.28)",
              boxShadow: "0 18px 36px rgba(15, 23, 42, 0.12)",
              padding: "0.7rem",
              zIndex: 50,
            }}
          >
            <div style={{ padding: "0.2rem 0.4rem 0.6rem", borderBottom: "1px solid rgba(148,163,184,0.2)", fontWeight: 800, fontSize: "0.8rem", color: "#0f172a" }}>
              Notifications
            </div>
            {notifications.length === 0 ? (
              <div style={{ padding: "1rem 0.4rem", color: "#64748b", fontSize: "0.82rem" }}>Nothing yet.</div>
            ) : (
              <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                {notifications.map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    onClick={() => openNotification(notification)}
                    style={{
                      display: "grid",
                      gap: "0.2rem",
                      width: "100%",
                      textAlign: "left",
                      padding: "0.6rem 0.65rem",
                      borderRadius: "0.6rem",
                      border: "1px solid rgba(148, 163, 184, 0.2)",
                      background: notification.readAt ? "#fff" : "#fff7f7",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ color: "#0f172a", fontSize: "0.82rem", fontWeight: 600 }}>{notification.message}</span>
                    <span style={{ color: "#64748b", fontSize: "0.7rem" }}>{formatDateTime(notification.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={() => { setBellOpen(false); setMenuOpen((value) => !value); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.7rem",
            padding: "0.35rem 0.75rem 0.35rem 0.45rem",
            borderRadius: "999px",
            border: "1px solid rgba(148, 163, 184, 0.28)",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
            cursor: "pointer",
            color: "#0f172a",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              width: "2.4rem",
              height: "2.4rem",
              borderRadius: "999px",
              overflow: "hidden",
              border: "1px solid rgba(148, 163, 184, 0.3)",
              background: "#f8fafc",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {userAvatar ? (
              <img
                src={userAvatar}
                alt={currentUser.name || currentUser.username || "User profile"}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: "100%",
                  background: "linear-gradient(135deg, #e2e8f0 0%, #c7d2fe 100%)",
                  color: "#334155",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                }}
              >
                {profileInitials || "U"}
              </span>
            )}
          </span>

          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1, minWidth: 0 }}>
            <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
              {currentUser.name || currentUser.username || "User"}
            </span>
            <span
              style={{
                ...roleBadgeColors[currentUser.role],
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.22rem 0.5rem",
                borderRadius: "999px",
                fontSize: "0.62rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                lineHeight: 1.1,
              }}
            >
              {ROLE_LABELS[currentUser.role] || currentUser.role}
            </span>
          </span>

          <ChevronDown size={14} style={{ color: "#64748b", flexShrink: 0 }} />
        </button>

        {menuOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 0.7rem)",
              right: 0,
              width: "16rem",
              background: "#ffffff",
              borderRadius: "1rem",
              border: "1px solid rgba(148, 163, 184, 0.28)",
              boxShadow: "0 18px 36px rgba(15, 23, 42, 0.12)",
              padding: "0.7rem",
              color: "#0f172a",
              zIndex: 50,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.4rem 0.2rem 0.9rem", borderBottom: "1px solid rgba(148,163,184,0.2)" }}>
              <span
                style={{
                  display: "inline-flex",
                  width: "2.7rem",
                  height: "2.7rem",
                  borderRadius: "999px",
                  overflow: "hidden",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background: "#f8fafc",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {userAvatar ? (
                  <img
                    src={userAvatar}
                    alt={currentUser.name || currentUser.username || "User profile"}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "100%",
                      height: "100%",
                      background: "linear-gradient(135deg, #e2e8f0 0%, #c7d2fe 100%)",
                      color: "#334155",
                      fontSize: "0.82rem",
                      fontWeight: 800,
                    }}
                  >
                    {profileInitials || "U"}
                  </span>
                )}
              </span>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.96rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#0f172a" }}>
                  {currentUser.name || currentUser.username || "User"}
                </div>
                <div
                  style={{
                    ...roleBadgeColors[currentUser.role],
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0.22rem 0.5rem",
                    borderRadius: "999px",
                    fontSize: "0.62rem",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    marginTop: "0.18rem",
                  }}
                >
                  {ROLE_LABELS[currentUser.role] || currentUser.role}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                onClick={() => handleAction("/account")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  width: "100%",
                  padding: "0.72rem 0.8rem",
                  borderRadius: "0.7rem",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "#f8fafc",
                  color: "#0f172a",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                <UserCog size={15} />
                Edit Profile
              </button>

              <button
                type="button"
                onClick={() => handleAction("/account?tab=security")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  width: "100%",
                  padding: "0.72rem 0.8rem",
                  borderRadius: "0.7rem",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "#f8fafc",
                  color: "#0f172a",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                <ShieldCheck size={15} />
                Change Password
              </button>

              <button
                type="button"
                onClick={handleLogout}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  width: "100%",
                  padding: "0.72rem 0.8rem",
                  borderRadius: "0.7rem",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  background: "#f8fafc",
                  color: "#0f172a",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "1.8rem",
                    height: "1.8rem",
                    borderRadius: "999px",
                    background: "#f8fafc",
                    color: "#0f172a",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                  }}
                >
                  <LogOut size={14} />
                </span>
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export default Navbar;
