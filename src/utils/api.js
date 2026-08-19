const isRenderHost = typeof window !== "undefined" && window.location.hostname.includes("onrender.com");
const DEFAULT_URL = isRenderHost ? "https://hostel-backend-cveq.onrender.com" : "http://localhost:4000";
const BASE_URL = (import.meta.env.VITE_API_URL || DEFAULT_URL).replace(/\/$/, "");

export async function apiFetch(
  endpoint,
  options = {}
) {
  // Role is non-sensitive display data stored in localStorage for routing.
  // Tokens are in HttpOnly cookies and are sent automatically by the browser
  // via credentials: "include" — we never read or forward them from JavaScript.
  const role = localStorage.getItem("role");

  const response = await fetch(
    `${BASE_URL}${endpoint}`,
    {
      ...options,
      credentials: "include", // sends HttpOnly cookies automatically
      headers: {
        "Content-Type": "application/json",
        role: role || "",
        ...(options.headers || {}),
      },
    }
  );

  /* ================= AUTO LOGOUT ================= */

  const isAuthEndpoint =
    endpoint.startsWith("/api/auth/") ||
    endpoint.startsWith("/api/authority/login") ||
    endpoint.startsWith("/api/authority/refresh") ||
    endpoint.includes("/me");

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