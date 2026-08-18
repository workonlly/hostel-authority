const isRenderHost = typeof window !== "undefined" && window.location.hostname.includes("onrender.com");
const DEFAULT_URL = isRenderHost ? "https://hostel-backend-cveq.onrender.com" : "http://localhost:4000";
const BASE_URL = (import.meta.env.VITE_API_URL || DEFAULT_URL).replace(/\/$/, "");

export async function apiFetch(
  endpoint,
  options = {}
) {

  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  const response = await fetch(
    `${BASE_URL}${endpoint}`,
    {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        role: role || "",
        ...(token ? { Authorization: `Bearer ${token}`, token } : {}),
        ...(options.headers || {}),
      },
    }
  );

  /* ================= AUTO LOGOUT ================= */

  const isAuthEndpoint = 
    endpoint.startsWith("/api/auth/") || 
    endpoint.startsWith("/api/authority/login") ||
    endpoint.startsWith("/api/authority/refresh");

  if (
    !isAuthEndpoint &&
    response.status === 401
  ) {
    localStorage.clear();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const text =
    await response.text();

  let data = {};

  try {

    data = text
      ? JSON.parse(text)
      : {};

  } catch {

    throw new Error(
      "Invalid server response"
    );
  }

  if (!response.ok) {

    const err = new Error(
      data.message ||
      data.error ||
      "Request failed"
    );
    err.data = data;
    throw err;
  }

  return data;
}