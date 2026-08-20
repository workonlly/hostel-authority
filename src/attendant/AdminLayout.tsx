import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AttendantSidebar from "./AttendantSidebar";
import { Menu } from "lucide-react";

import { apiFetch } from "../utils/api";
import { broadcastSessionLogout } from "../utils/sessionSync";

export default function AdminLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function handleLogout() {
    apiFetch("/api/authority/logout", { method: "POST" }).catch(() => {});
    broadcastSessionLogout();
    localStorage.clear();
    window.location.href = "/login";
  }

  function getTitle() {
    if (location.pathname.includes("/approved")) return "Approved Outpasses";
    if (location.pathname.includes("/rejected")) return "Rejected Outpasses";
    return "Pending Outpasses";
  }

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="h-screen flex bg-[#f9fafb] font-sans text-gray-800 overflow-hidden">
      {/* ================= MOBILE NAVIGATION OVERLAY ================= */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ================= SIDEBAR (Desktop + Mobile) ================= */}
      <div className={`fixed lg:static inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <AttendantSidebar logout={handleLogout} />
      </div>

      {/* ================= MAIN CONTENT AREA ================= */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        
        {/* MOBILE HEADER */}
        <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 shadow-sm flex items-center justify-between sticky top-0 z-30">
          <button 
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-[#5b0e0e] hover:bg-gray-100 rounded-lg"
          >
            <Menu size={24} />
          </button>
          <h1 className="text-lg font-bold text-[#5b0e0e]">
            {getTitle()}
          </h1>
          <div className="w-8" /> {/* Spacer */}
        </div>

        {/* DESKTOP HEADER */}
        <div className="hidden lg:flex bg-white border-b border-gray-200 px-8 py-5 shadow-sm items-center justify-between z-30">
          <h1 className="text-2xl font-bold text-[#5b0e0e]">
            {getTitle()}
          </h1>
        </div>

        {/* OUTLET CONTENT */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
