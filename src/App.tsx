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
import { initSessionSync } from "./utils/sessionSync";
import "./App.css";

function useAuth() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    let isMounted = true;

    apiFetch("/api/authority/me", { method: "GET" })
      .then((data: any) => {
        if (!isMounted) return;
        if (data?.success && data?.user) {
          const rawRole = data.user.role || data.user.status || "authority";
          let normalizedRole = rawRole.toLowerCase().replace(/[\s_]+/g, "-");
          if (normalizedRole === "attendent") normalizedRole = "attendant";
          
          localStorage.setItem("user", JSON.stringify(data.user));
          localStorage.setItem("role", normalizedRole);
          setAuthState("authenticated");
        } else {
          localStorage.removeItem("user");
          localStorage.removeItem("role");
          setAuthState("unauthenticated");
        }
      })
      .catch(() => {
        if (!isMounted) return;
        localStorage.removeItem("user");
        localStorage.removeItem("role");
        setAuthState("unauthenticated");
      });

    const cleanupSync = initSessionSync({
      onLogout: () => {
        if (isMounted) {
          setAuthState("unauthenticated");
        }
      },
      onLogin: (data) => {
        if (isMounted && data.role !== "student") {
          localStorage.setItem("user", JSON.stringify(data.user));
          localStorage.setItem("role", data.role);
          setAuthState("authenticated");
        }
      },
      onRoleConflict: () => {
        if (isMounted) {
          localStorage.removeItem("user");
          localStorage.removeItem("role");
          setAuthState("unauthenticated");
        }
      }
    });

    return () => {
      isMounted = false;
      cleanupSync();
    };
  }, []);

  return authState;
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const userStr = localStorage.getItem("user");
  const role = localStorage.getItem("role")?.toLowerCase();

  if (!userStr || !role) {
    return <Navigate to="/login" replace />;
  }

  // Handle variations in role naming from the backend
  const normalizedRole = role === "chief warden" ? "chief-warden" : role === "attendent" ? "attendant" : role;

  if (!allowedRoles.includes(normalizedRole)) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function App() {
  const authState = useAuth();

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <div className="text-gray-500 text-sm">Loading Authority Portal...</div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* LOGIN */}
        <Route path="/login" element={<Login />} />
        
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
          {/* Default to pending page */}
          <Route index element={<PendingPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="approved" element={<ApprovedPage />} />
          <Route path="rejected" element={<RejectedPage />} />
        </Route>

        {/* Redirect root based on user status (if logged in, else login) */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
