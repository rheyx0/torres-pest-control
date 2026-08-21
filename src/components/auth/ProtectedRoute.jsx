// Blocks routes for anyone who is not signed in.
//
// Previously nothing guarded the routes at all — App.js rendered the whole
// authenticated tree behind a single `!session ?` ternary, which worked, but
// left no place to express per-route rules. This is that place.

import { Navigate, useLocation } from "react-router-dom";
import useAuth from "../../hooks/useAuth";

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default ProtectedRoute;
