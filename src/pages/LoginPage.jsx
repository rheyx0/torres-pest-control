// Sign-in route. The form itself is components/auth/Login.

import { Navigate, useLocation } from "react-router-dom";
import Login from "../components/auth/Login";
import useAuth from "../hooks/useAuth";

function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();

  // Already signed in? Go where they were headed, or the dashboard.
  if (isAuthenticated) {
    return <Navigate to={location.state?.from || "/"} replace />;
  }

  return (
    <div className="login-page">
      <main className="login-form-panel">
        <Login onLogin={login} />
      </main>
    </div>
  );
}

export default LoginPage;
