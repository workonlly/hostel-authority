import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Login from "./auth/login";
import ChiefWarden from "./chief-warden/chief-warden";
import Warden from "./warden/warden";
import AdminLayout from "./attendant/AdminLayout";
import PendingPage from "./attendant/PendingPage";
import ApprovedPage from "./attendant/ApprovedPage";
import RejectedPage from "./attendant/RejectedPage";
import { apiFetch } from "./utils/api";
import "./App.css";

const AUTHORITY_ROLES = ["chief-warden", "warden", "attendant"];

function normalizeRole(role: string) {
  const r = (role || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (r === "attendent") return "attendant";
  if (r === "chief-warden" || r === "chief warden") return "chief-warden";
  return r;
}

/**
 * On app startup, call /api/authority/me to silently validate the session
 * using the HttpOnly cookie. Sessions persist across browser close/reopen
 * without ever storing tokens in localStorage.
 */
function useAuth() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    const existingRole = localStorage.getItem("role")?.toLowerCase();
    const existingUser = localStorage.getItem("user");

    if (!existingRole || !existingUser) {
      setAuthState("unauthenticated");
      return;
    }

    apiFetch("/api/authority/me", { method: "GET" })
      .then((data: any) => {
        if (data?.success && data?.user) {
          const user = data.user;
          const role = normalizeRole(user.role || user.status || existingRole);
          localStorage.setItem("user", JSON.stringify({ ...user, role }));
          localStorage.setItem("role", role);
          // Remove any tokens that may have been stored in the past
          localStorage.removeItem("token");
          localStorage.removeItem("refreshToken");
          localStorage.removeItem("sessionId");
          setAuthState("authenticated");
        } else {
          localStorage.removeItem("user");
          localStorage.removeItem("role");
          localStorage.removeItem("token");
          localStorage.removeItem("refreshToken");
          localStorage.removeItem("sessionId");
          setAuthState("unauthenticated");
        }
      })
      .catch(() => {
        localStorage.removeItem("user");
        localStorage.removeItem("role");
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("sessionId");
        setAuthState("unauthenticated");
      });
  }, []);

  return authState;
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const userStr = localStorage.getItem("user");
  const role = localStorage.getItem("role")?.toLowerCase();

  if (!userStr || !role) {
    return <Navigate to="/login" replace />;
  }

  const normalized = normalizeRole(role);

  if (!allowedRoles.includes(normalized)) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const userStr = localStorage.getItem("user");
  const role = localStorage.getItem("role")?.toLowerCase();

  if (userStr && role) {
    const normalized = normalizeRole(role);
    if (AUTHORITY_ROLES.includes(normalized)) {
      return <Navigate to={`/${normalized}`} replace />;
    }
  }

  return children;
}

function App() {
  const authState = useAuth();

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* LOGIN */}
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

        {/* CHIEF WARDEN */}
        <Route path="/chief-warden" element={
          <ProtectedRoute allowedRoles={["chief-warden"]}>
            <ChiefWarden />
          </ProtectedRoute>
        } />

        {/* WARDEN */}
        <Route path="/warden" element={
          <ProtectedRoute allowedRoles={["warden"]}>
            <Warden />
          </ProtectedRoute>
        } />

        {/* ATTENDANT (Nested Routes) */}
        <Route path="/attendant" element={
          <ProtectedRoute allowedRoles={["attendant"]}>
            <AdminLayout />
          </ProtectedRoute>
        }>
          <Route index element={<PendingPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="approved" element={<ApprovedPage />} />
          <Route path="rejected" element={<RejectedPage />} />
        </Route>

        {/* Redirect root to login */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
