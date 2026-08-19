import { Link, useLocation } from "react-router-dom";

function Sidebar({ currentUser, onLogout }) {
  const location = useLocation();

  const navItems = [
    { label: "Admin Dashboard", path: "/" },
    { label: "Client Profiles", path: "/clients" },
    { label: "Create Client Profile", path: "/clients/new" },
    { label: "User Accounts", path: "/users" },
    ...(currentUser?.role === "ADMIN" ? [{ label: "Create Account", path: "/users/new" }] : []),
    { label: "User Account Profile", path: "/account" },
    { label: "Inventory", path: "/inventory" },
  ];

  const styles = {
    sidebar: {
      width: "264px",
      minHeight: "100vh",
      background: "linear-gradient(180deg, #7f1111 0%, #561313 100%)",
      padding: "1.4rem 1rem 1.2rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.5rem",
      boxShadow: "18px 0 40px rgba(86, 19, 19, 0.18)",
    },
    logoWrap: {
      marginBottom: "1.5rem",
      padding: "0.85rem 0.8rem 1rem",
      borderBottom: "1px solid rgba(255,255,255,0.18)",
    },
    logo: {
      color: "#fff",
      fontWeight: "800",
      fontSize: "1.15rem",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      lineHeight: 1.3,
    },
    small: {
      display: "block",
      opacity: 0.8,
      fontSize: "0.68rem",
      fontWeight: 600,
      letterSpacing: "0.12em",
      marginTop: "0.4rem",
    },
    link: {
      display: "block",
      padding: "0.82rem 0.9rem",
      borderRadius: "12px",
      color: "rgba(255,255,255,0.88)",
      textDecoration: "none",
      fontSize: "0.92rem",
      fontWeight: 600,
      transition: "all 0.2s ease",
      border: "1px solid transparent",
    },
    activeLink: {
      background: "rgba(255,255,255,0.14)",
      borderColor: "rgba(255,255,255,0.12)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
      color: "#fff",
    },
    userInfo: {
      marginTop: "auto",
      padding: "0.85rem 0.9rem",
      borderTop: "1px solid rgba(255,255,255,0.18)",
      color: "rgba(255,255,255,0.75)",
      fontSize: "0.78rem",
    },
    logoutButton: {
      display: "block",
      width: "100%",
      textAlign: "left",
      marginTop: "0.5rem",
      padding: "0.82rem 0.9rem",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.18)",
      background: "transparent",
      color: "rgba(255,255,255,0.88)",
      fontSize: "0.92rem",
      fontWeight: 600,
      cursor: "pointer",
    },
  };

  return (
    <div style={styles.sidebar}>
      <div style={styles.logoWrap}>
        <div style={styles.logo}>Torres</div>
        <span style={styles.small}>PEST CONTROL</span>
      </div>
      {navItems.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          style={{
            ...styles.link,
            ...(location.pathname === item.path ? styles.activeLink : {}),
          }}
        >
          {item.label}
        </Link>
      ))}
      <div style={styles.userInfo}>
        {currentUser && (
          <>
            Logged in as <strong>{currentUser.name}</strong> ({currentUser.role})
          </>
        )}
        <button type="button" onClick={onLogout} style={styles.logoutButton}>
          Logout
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
