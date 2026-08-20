import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";
import { broadcastSessionLogin } from "../utils/sessionSync";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sessionConflict, setSessionConflict] = useState<{ currentRole: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const executeLogin = async (forceLogout = false) => {
    setError("");
    setSessionConflict(null);
    setLoading(true);

    try {
      const data = await apiFetch("/api/authority/login", {
        method: "POST",
        body: JSON.stringify({ email, password, forceLogout }),
      });

      if (data.token || data.accessToken) {
        localStorage.setItem("token", data.token || data.accessToken);
      }
      localStorage.setItem("user", JSON.stringify(data.user));
      
      const rawRole = data.user.role || data.user.status || "authority";
      let normalizedRole = rawRole.toLowerCase().replace(/[\s_]+/g, "-");
      if (normalizedRole === "attendent") {
        normalizedRole = "attendant";
      }
      localStorage.setItem("role", normalizedRole);

      // Broadcast login event to other tabs
      broadcastSessionLogin({
        role: normalizedRole,
        user: data.user,
        sessionId: data.sessionId,
      });

      // Route based on status
      if (normalizedRole === "chief-warden") {
        navigate("/chief-warden");
      } else if (normalizedRole === "warden") {
        navigate("/warden");
      } else if (normalizedRole === "attendant") {
        navigate("/attendant");
      } else {
        navigate("/");
      }
    } catch (err: any) {
      console.error(err);
      if (err.data?.conflict || err.status === 409) {
        setSessionConflict({
          currentRole: err.data?.currentRole || "student",
          message: err.data?.message || err.message,
        });
      } else {
        setError(err.message || "An error occurred during login");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill all fields");
      return;
    }
    await executeLogin(false);
  };

  return (
    <div className="min-h-screen flex bg-[#f5f5f5]">
      {/* ================= LEFT ================= */}
      <div className="hidden md:flex w-1/2 bg-[#5b0e0e] text-white items-center justify-center p-16">
        <div>
          <div className="flex items-center gap-3 justify-center mb-5">
            <img
              src="/l.png"
              alt="nithlogo"
              width={80}
              height={80}
              className="object-contain"
            />
            <h1 className="text-5xl font-bold">Authority Portal</h1>
          </div>
          <p className="text-lg text-gray-200 leading-8 text-center">
            Secure access for Wardens, Attendants, and Guards to manage hostel operations.
          </p>
        </div>
      </div>

      {/* ================= RIGHT ================= */}
      <div className="flex w-full md:w-1/2 items-center justify-center px-6">
        <form
          onSubmit={handleLogin}
          className="bg-white w-full max-w-md rounded-xl shadow-sm border border-gray-200 p-10"
        >
          <h2 className="text-3xl font-semibold text-[#5b0e0e] mb-8 text-center">
            Login
          </h2>

          {/* SESSION CONFLICT BANNER */}
          {sessionConflict && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-5 text-amber-900 text-sm">
              <div className="font-semibold flex items-center gap-1.5 mb-1">
                <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Active Session Detected
              </div>
              <p className="mb-3 text-xs leading-relaxed text-amber-800">
                {sessionConflict.message || `An active session for '${sessionConflict.currentRole}' is currently running in this browser.`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => executeLogin(true)}
                  disabled={loading}
                  className="flex-1 bg-[#5b0e0e] text-white text-xs font-semibold py-2 px-3 rounded hover:bg-[#741616] transition disabled:opacity-50"
                >
                  Log out previous session & Proceed
                </button>
                <button
                  type="button"
                  onClick={() => setSessionConflict(null)}
                  className="border border-gray-300 text-gray-700 text-xs font-semibold py-2 px-3 rounded hover:bg-gray-100 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ERROR */}
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

          {/* EMAIL */}
          <input
            type="email"
            name="email"
            placeholder="Authority Mail"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSessionConflict(null);
            }}
            className="w-full border border-gray-300 p-3 rounded-md mb-4 outline-none focus:border-[#5b0e0e]"
          />

          {/* PASSWORD */}
          <input
            type="password"
            name="password"
            value={password}
            placeholder="Password"
            onChange={(e) => {
              setPassword(e.target.value);
              setSessionConflict(null);
            }}
            className="w-full border border-gray-300 p-3 rounded-md mb-6 outline-none focus:border-[#5b0e0e]"
          />

          {/* BUTTON */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#5b0e0e] hover:bg-[#741616] transition text-white py-3 rounded-md disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>

        </form>
      </div>
    </div>
  );
}

