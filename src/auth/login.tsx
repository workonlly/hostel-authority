import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect already-logged-in authority users away from the login page
  useEffect(() => {
    const role = localStorage.getItem("role")?.toLowerCase();
    const user = localStorage.getItem("user");
    if (user && role) {
      const normalized = role === "chief warden" ? "chief-warden" : role === "attendent" ? "attendant" : role;
      if (["chief-warden", "warden", "attendant"].includes(normalized)) {
        navigate(`/${normalized}`, { replace: true });
      }
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill all fields");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const data = await apiFetch("/api/authority/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      // Only store non-sensitive display data — tokens live in HttpOnly cookies set by the server
      localStorage.setItem("user", JSON.stringify(data.user));

      const rawRole = data.user.role || data.user.status || "authority";
      let normalizedRole = rawRole.toLowerCase().replace(/[\s_]+/g, "-");
      if (normalizedRole === "attendent") {
        normalizedRole = "attendant";
      }
      localStorage.setItem("role", normalizedRole);

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
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#f5f5f5]">
      {/* ================= LEFT ================= */}
      <div className="hidden md:flex w-1/2 bg-[#5b0e0e] text-white items-center justify-center p-16">
        <div>
          <div className="flex items-center gap-3 justify-center mb-5">
            {/* The user may not have /l.png in the authority app, so it might show a broken image, but I'll use it to match the frontend */}
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

          {/* ERROR */}
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

          {/* EMAIL */}
          <input
            type="email"
            name="email"
            placeholder="Authority Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 p-3 rounded-md mb-4 outline-none focus:border-[#5b0e0e]"
          />

          {/* PASSWORD */}
          <input
            type="password"
            name="password"
            value={password}
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
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
