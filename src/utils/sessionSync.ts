/**
 * Cross-Tab Session Synchronization Utility for Authority Portal
 */

const CHANNEL_NAME = "hostel_auth_session_channel";

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch (e) {
    console.warn("BroadcastChannel not available:", e);
  }
}

export interface SessionPayload {
  role?: string;
  user?: any;
  sessionId?: string;
}

/**
 * Broadcasts an authority login event to other tabs
 */
export function broadcastSessionLogin(payload: SessionPayload) {
  const message = {
    type: "AUTH_LOGIN",
    timestamp: Date.now(),
    role: payload.role || "authority",
    user: payload.user,
    sessionId: payload.sessionId,
  };

  try {
    broadcastChannel?.postMessage(message);
  } catch (e) {}

  try {
    localStorage.setItem("session_sync_event", JSON.stringify(message));
  } catch (e) {}
}

/**
 * Broadcasts a logout event to all other tabs
 */
export function broadcastSessionLogout() {
  const message = {
    type: "AUTH_LOGOUT",
    timestamp: Date.now(),
  };

  try {
    broadcastChannel?.postMessage(message);
  } catch (e) {}

  try {
    localStorage.setItem("session_sync_event", JSON.stringify(message));
  } catch (e) {}
}

export interface SessionSyncHandlers {
  onLogout?: () => void;
  onRoleConflict?: (conflictRole: string) => void;
  onLogin?: (data: any) => void;
}

/**
 * Initializes cross-tab listeners in App.tsx
 */
export function initSessionSync({ onLogout, onRoleConflict, onLogin }: SessionSyncHandlers) {
  if (typeof window === "undefined") return () => {};

  const handleMessage = (data: any) => {
    if (!data || !data.type) return;

    if (data.type === "AUTH_LOGOUT") {
      if (onLogout) {
        onLogout();
      } else {
        localStorage.removeItem("user");
        localStorage.removeItem("role");
        localStorage.removeItem("token");
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    } else if (data.type === "AUTH_LOGIN") {
      const isStudentLogin = data.role === "student";
      // If another tab logged in as a Student, Authority portal should handle conflict
      if (isStudentLogin) {
        if (onRoleConflict) {
          onRoleConflict(data.role);
        } else {
          localStorage.removeItem("user");
          localStorage.removeItem("role");
          if (window.location.pathname !== "/login") {
            window.location.href = "/login";
          }
        }
      } else if (onLogin) {
        onLogin(data);
      }
    }
  };

  const bcListener = (event: MessageEvent) => {
    handleMessage(event.data);
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener("message", bcListener);
  }

  const storageListener = (event: StorageEvent) => {
    if (event.key === "session_sync_event" && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        handleMessage(parsed);
      } catch (e) {}
    } else if (event.key === "role" && event.newValue === "student") {
      handleMessage({ type: "AUTH_LOGIN", role: "student" });
    }
  };

  window.addEventListener("storage", storageListener);

  return () => {
    if (broadcastChannel) {
      broadcastChannel.removeEventListener("message", bcListener);
    }
    window.removeEventListener("storage", storageListener);
  };
}
