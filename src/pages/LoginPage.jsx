// Sign-in route. The form itself is components/auth/Login.

import { Navigate, useLocation } from "react-router-dom";
import Login from "../components/auth/Login";
import useAuth from "../hooks/useAuth";

function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();

  if (isAuthenticated) {
    return <Navigate to={location.state?.from || "/"} replace />;
  }

  return (
    <div className="standalone-login-page">
      <Login onLogin={login} />
    </div>
  );
}

export default LoginPage;
