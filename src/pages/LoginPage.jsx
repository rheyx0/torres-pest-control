// Sign-in route. The form itself is components/auth/Login.

import { Navigate, useLocation } from "react-router-dom";
import Login from "../components/auth/Login";
import useAuth from "../hooks/useAuth";
import { appBackground } from "../styles/theme";

function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();

  // Already signed in? Go where they were headed, or the dashboard.
  if (isAuthenticated) {
    return <Navigate to={location.state?.from || "/"} replace />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: appBackground,
      }}
    >
      <Login onLogin={login} />
    </div>
  );
}

export default LoginPage;
