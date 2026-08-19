import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ChiefWardenSidebar from "./ChiefWardenSidebar";
import WardensAllotment from "./WardensAllotment";
import GuardDevices from "./GuardDevices";
import { 
  FileText, 
  Clock, 
  AlertTriangle, 
  Search, 
  Download,
  Printer,
  Check,
  DoorOpen,
  Menu
} from "lucide-react";

/* ================= DEPARTMENT MAP ================= */
const DEPARTMENT_ALIASES: Record<string, string> = {
    'COMPUTER SCIENCE ENGINEERING': 'CSE',
    'COMPUTER SCIENCE & ENGINEERING': 'CSE',
    'CSE': 'CSE',
    'MECHANICAL ENGINEERING': 'ME',
    'ME': 'ME',
    'CIVIL ENGINEERING': 'CE',
    'CE': 'CE',
    'ELECTRICAL ENGINEERING': 'EE',
    'EE': 'EE',
    'ELECTRONICS & COMMUNICATION ENGINEERING': 'ECE',
    'ELECTRONICS AND COMMUNICATION ENGINEERING': 'ECE',
    'ECE': 'ECE',
    'MATHEMATICS & COMPUTING': 'MNC',
    'MATHEMATICS AND COMPUTING': 'MNC',
    'MNC': 'MNC',
    'ENGINEERING PHYSICS': 'ENGINEERING PHYSICS',
    'BPH': 'ENGINEERING PHYSICS',
    'MATERIAL SCIENCE': 'MATERIAL SCIENCE',
    'BMS': 'MATERIAL SCIENCE',
    'CHEMICAL ENGINEERING': 'CHEMICAL ENGINEERING',
    'CHEMICAL': 'CHEMICAL ENGINEERING',
    'CH': 'CHEMICAL ENGINEERING',
    'ARCHITECTURE': 'ARCHITECTURE',
    'BAR': 'ARCHITECTURE',
    'DUAL DEGREE CSE': 'DUAL DEGREE CSE',
    'DCS': 'DUAL DEGREE CSE',
    'DUAL DEGREE ELECTRONICS': 'DUAL DEGREE ELECTRONICS',
    'DEC': 'DUAL DEGREE ELECTRONICS',
};
const UNIQUE_DEPARTMENTS = Array.from(new Set(Object.values(DEPARTMENT_ALIASES))).sort();

/* ================= TYPES ================= */

interface Remark {
  id: string;
  text: string;
  author: string;
  created_at: string;
}

interface Outpass {
  id: string;
  name: string;
  roll_no: string;
  phone: string;
  department: string;
  hostel: string;
  place_of_visit: string;
  outpass_type: string;
  outp_status: string;
  std_status: string;
  created_at: string;
  departure_datetime?: string;
  arrival_datetime?: string;
  // Optional / extended fields - render "-" gracefully if the API doesn't send them yet.
  // Some of these only arrive once we fetch GET /api/chief-warden/outpasses/:id (the
  // monitor list endpoint returns a lighter-weight record).
  room?: string;
  email?: string;
  purpose?: string;
  parent_contact?: string;
  approved_at?: string;
  is_emergency?: boolean;
  // Needed to call GET /api/students/:id/history. Falls back to roll_no if absent.
  student_id?: string;
}

interface Complaint {
  id: string;
  title?: string;
  description: string;
  hostel: string;
  status: string;
  student_id?: string;
  student_name?: string;
  student_roll_no?: string;
  student_phone?: string;
  student_department?: string;
  date_created: string;
}

interface LateLog {
  id: string;
  student_id: string;
  name: string;
  roll_no: string;
  department: string;
  hostel?: string;
  place_of_visit?: string;
  departure_datetime?: string;
  arrival_datetime?: string;
  actual_arrival?: string;
  std_status?: string;
  created_at?: string;
  outpass_type?: string;
}

interface StudentProfile {
  id?: string;
  name?: string;
  roll_no?: string;
  department?: string;
  hostel?: string;
  room?: string;
  phone?: string;
  email?: string;
  parent_contact?: string;
  [key: string]: any;
}

interface StudentHistoryResult {
  profile: StudentProfile;
  outpasses: Outpass[];
  visit_logs: LateLog[];
  complaints: Complaint[];
}

type QuickFilterKey =
  | "All"
  | "Today"
  | "Yesterday"
  | "Emergency"
  | "Local"
  | "Home"
  | "Outstation"
  | "OutsideCampus"
  | "ReturnedToday";

/* ================= SMALL HELPERS ================= */

function isSameDay(dateStr?: string, ref?: Date) {
  if (!dateStr || !ref) return false;
  const d = new Date(dateStr);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function safeDate(dateStr?: string) {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "-";
  }
}

/* ================= HIGHLIGHT MATCHED SEARCH TEXT ================= */

function HighlightText({ text, query }: { text?: string; query: string }) {
  if (!text) return <>-</>;
  const q = query.trim();
  if (!q) return <>{text}</>;

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);

  if (idx === -1) return <>{text}</>;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);

  return (
    <>
      {before}
      <mark className="bg-amber-200/70 text-gray-900 rounded px-0.5">
        {match}
      </mark>
      {after}
    </>
  );
}

/* ================= STATUS PILL ================= */

function StatusPill({ pass }: { pass: Outpass }) {
  let label = "Rejected";
  let className = "bg-red-100 text-red-800 border-red-200/60";

  if (pass.std_status === "Out") {
    label = "Outside Campus";
    className = "bg-orange-100 text-orange-800 border-orange-200/60";
  } else if (pass.std_status === "In" && pass.outp_status === "Approved") {
    label = "Returned";
    className = "bg-blue-100 text-blue-800 border-blue-200/60";
  } else if (pass.outp_status === "Approved") {
    label = "Approved";
    className = "bg-green-100 text-green-800 border-green-200/60";
  } else if (pass.outp_status === "Pending") {
    label = "Pending";
    className = "bg-amber-100 text-amber-800 border-amber-200/60";
  }

  return (
    <span
      className={`inline-block text-[11px] px-3 py-1 rounded-full font-semibold border ${className}`}
    >
      {label}
    </span>
  );
}

function EmergencyBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-bold border-2 border-red-500 text-red-600 bg-white ml-1.5">
      ⚡ Emergency
    </span>
  );
}

/* ================= STAT CARD ================= */

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200/80 shadow-xs sm:shadow-sm p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-3 transition-all duration-300 hover:shadow-md shrink-0 min-w-[130px] sm:min-w-0">
      <div
        className="w-8 h-8 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl flex items-center justify-center text-sm sm:text-lg shrink-0"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <span className="scale-75 sm:scale-100">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-gray-400 truncate">
          {label}
        </p>
        <p
          className="text-base sm:text-2xl font-extrabold tabular-nums transition-all duration-500 leading-tight mt-0.5 sm:mt-0"
          style={{ color: accent }}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/* ================= FILTER CHIP ================= */

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition cursor-pointer whitespace-nowrap ${
        active
          ? "bg-[#6d0f16] text-white border-[#6d0f16]"
          : "bg-white text-gray-600 border-gray-200 hover:border-[#6d0f16]/40 hover:text-[#6d0f16]"
      }`}
    >
      {label}
    </button>
  );
}

/* ================= EMPTY STATE ================= */

function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="p-16 flex flex-col items-center justify-center text-center gap-3">
      <div className="w-16 h-16 rounded-2xl bg-[#6d0f16]/5 flex items-center justify-center text-3xl">
        🗂️
      </div>
      <h3 className="text-sm font-bold text-gray-700">{title}</h3>
      <p className="text-xs text-gray-400 max-w-xs">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-2 px-4 py-2 rounded-xl bg-[#6d0f16] text-white text-xs font-bold hover:bg-[#5a0c12] transition cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ================= TABLE SKELETON ================= */

function TableSkeleton({ rows = 6, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <tbody className="divide-y divide-gray-100">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((__, c) => (
                <td key={c} className="px-6 py-4">
                  <div
                    className="h-3 rounded-full bg-gray-100 animate-pulse"
                    style={{ width: c === 0 ? "70%" : "50%" }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200/80 shadow-xs sm:shadow-sm p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-3 shrink-0 min-w-[130px] sm:min-w-0">
      <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-gray-100 animate-pulse shrink-0" />
      <div className="flex-1 space-y-1.5 min-w-0">
        <div className="h-2 w-12 sm:w-16 rounded-full bg-gray-100 animate-pulse" />
        <div className="h-3.5 sm:h-4 w-8 sm:w-10 rounded-full bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}

/* ================= GENERIC INLINE SKELETON (drawer / modals) ================= */

function InlineSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-full bg-gray-100 animate-pulse"
          style={{ width: `${82 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

/* ================= GENERIC INLINE ERROR w/ RETRY ================= */

function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 shadow-xs text-xs font-medium flex items-center justify-between gap-3">
      <span>⚠️ {message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 transition cursor-pointer shrink-0"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ================= TIMELINE ITEM ================= */

function TimelineItem({
  icon,
  title,
  timestamp,
  description,
  isLast,
  accent,
}: {
  icon: any;
  title: string;
  timestamp?: string;
  description?: string;
  isLast?: boolean;
  accent: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs shrink-0 border-2"
          style={{ backgroundColor: `${accent}1a`, borderColor: accent, color: accent }}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
      </div>
      <div className={`pb-6 ${isLast ? "pb-0" : ""}`}>
        <p className="text-xs font-bold text-gray-800">{title}</p>
        {timestamp && (
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">
            {safeDate(timestamp)}
          </p>
        )}
        {description && (
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        )}
      </div>
    </div>
  );
}

/* ================= COMPONENT ================= */

function ChiefWarden() {
  const navigate = useNavigate();

  /* ================= STATES ================= */

  const [outpasses, setOutpasses] = useState<Outpass[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [escalatedComplaints, setEscalatedComplaints] = useState<Complaint[]>([]);
  const [lateLogs, setLateLogs] = useState<LateLog[]>([]);
  const [activeTab, setActiveTab] = useState<"outpasses" | "complaints" | "escalated" | "lateLogs" | "allotment" | "devices">("outpasses");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: hostels = [] } = useQuery({
    queryKey: ["hostelsList"],
    queryFn: async () => {
      const response: any = await apiFetch("/api/hostels");
      return Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.hostels)
        ? response.hostels
        : [];
    },
    staleTime: 1000 * 60 * 60 * 24,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("All");
  const [hostelFilter, setHostelFilter] = useState("All");
  const [campusFilter, setCampusFilter] = useState("All"); // "All", "Outside", "Inside"
  const [departmentFilter, setDepartmentFilter] = useState("All");

  /* ================= DYNAMIC TIME RANGE & DATE CONSTRAINTS ================= */
  const [fromTime, setFromTime] = useState("20:00"); // Start time (Default 8:00 PM)
  const [toTime, setToTime] = useState(""); // End time (Optional - Blank means end of day)
  const [selectedDate, setSelectedDate] = useState(""); // YYYY-MM-DD filter for specific date

  /* ================= QUICK FILTER CHIPS ================= */
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>("All");

  /* ================= PAGINATION STATE ================= */
  const [page, setPage] = useState(1);
  const limit = 8; // Items per page

  /* ================= VIEW DETAILS DRAWER ================= */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [selectedOutpass, setSelectedOutpass] = useState<Outpass | null>(null);

  /* ================= OUTPASS DETAIL FETCH (GET /api/chief-warden/outpasses/:id) =================
     Backs both the drawer's extended fields (room, email, purpose, parent_contact,
     approved_at) and the remarks list — the monitor list endpoint doesn't return
     either, so we fetch on demand when the drawer or remarks modal opens. */
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  /* ================= CHIEF WARDEN REMARKS MODAL ================= */
  const [remarksModalOpen, setRemarksModalOpen] = useState(false);
  const [remarksTarget, setRemarksTarget] = useState<Outpass | null>(null);
  const [remarksText, setRemarksText] = useState("");
  const [remarksByOutpass, setRemarksByOutpass] = useState<Record<string, Remark[]>>({});
  const [remarkSaving, setRemarkSaving] = useState(false);
  const REMARKS_MAX_LEN = 500;

  /* ================= HISTORY MODAL (GET /api/students/:id/history) ================= */
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Outpass | null>(null);
  const [historyResult, setHistoryResult] = useState<StudentHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  /* ================= FETCH ================= */

  useEffect(() => {
    fetchDashboard();
    fetchComplaints();
    fetchEscalatedComplaints();
    fetchLateLogs();
  }, []);

  /* ================= FETCH ESCALATED COMPLAINTS ================= */
  async function fetchEscalatedComplaints() {
    try {
      const response: any = await apiFetch("/complaint/escalated");

      const list = Array.isArray(response)
        ? response
        : Array.isArray(response?.complaints)
        ? response.complaints
        : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.data?.complaints)
        ? response.data.complaints
        : [];

      setEscalatedComplaints(list);
    } catch (err) {
      console.error("ESCALATED COMPLAINT FETCH ERROR:", err);
      setEscalatedComplaints([]);
    }
  }

  /* ================= FETCH DASHBOARD ================= */
  /* ================= FETCH DASHBOARD (GET /api/outpasses/monitor) ================= */

  async function fetchDashboard() {
    try {
      setLoading(true);
      setError("");

      const response: any = await apiFetch("/api/outpasses/monitor");
      console.log("Chief Warden Dashboard Raw Response:", response);

      const list = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.data?.outpasses)
        ? response.data.outpasses
        : Array.isArray(response?.outpasses)
        ? response.outpasses
        : [];

      setOutpasses(list);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to load dashboard");
      setOutpasses([]);
    } finally {
      setLoading(false);
    }
  }

  /* ================= FETCH COMPLAINTS (main tab list) ================= */

  async function fetchComplaints() {
    try {
      const response: any = await apiFetch("/complaint/all");

      const list = Array.isArray(response)
        ? response
        : Array.isArray(response?.complaints)
        ? response.complaints
        : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.data?.complaints)
        ? response.data.complaints
        : [];

      setComplaints(list);
    } catch (err) {
      console.error("COMPLAINT FETCH ERROR:", err);
      setComplaints([]);
    }
  }
  /* ================= FETCH LATE LOGS (GET /api/outpasses/late-returns) ================= */

  async function fetchLateLogs() {
    try {
      const response: any = await apiFetch("/api/outpasses/late-returns");

      const list = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.late_returns)
        ? response.late_returns
        : [];

      setLateLogs(list);
    } catch (err) {
      console.error("LATE LOGS FETCH ERROR:", err);
      setLateLogs([]);
    }
  }

  /* ================= OUTPASS DETAIL: GET /api/chief-warden/outpasses/:id =================
     Returns { outpass, remarks }. Used by the drawer and the remarks modal. */

  async function fetchOutpassDetail(id: string) {
    try {
      setDetailLoading(true);
      setDetailError("");

      const response: any = await apiFetch(`/api/chief-warden/outpasses/${id}`);

      const outpassData: Outpass | null =
        response?.outpass || response?.data?.outpass || null;
      const remarksData: Remark[] = Array.isArray(response?.remarks)
        ? response.remarks
        : Array.isArray(response?.data?.remarks)
        ? response.data.remarks
        : [];

      if (outpassData) {
        setSelectedOutpass((prev) =>
          prev && prev.id === id ? { ...prev, ...outpassData } : prev
        );
      }

      setRemarksByOutpass((prev) => ({ ...prev, [id]: remarksData }));
    } catch (err: any) {
      console.error("OUTPASS DETAIL FETCH ERROR:", err);
      setDetailError(err?.message || "Failed to load outpass details");
    } finally {
      setDetailLoading(false);
    }
  }

  /* ================= SAVE CHIEF WARDEN REMARK: POST /api/chief-warden/outpasses/:id/remarks ================= */

  async function saveRemark() {
  if (!remarksTarget) return;

  const trimmedRemark = remarksText.trim();

  if (!trimmedRemark) {
    setDetailError("Remark cannot be empty");
    return;
  }

  try {
    setRemarkSaving(true);
    setDetailError("");

    const response: any = await apiFetch(
      `/api/chief-warden/outpasses/${remarksTarget.id}/remarks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          remark: trimmedRemark,
        }),
      }
    );

    const savedRemark =
      response?.data?.remark ??
      response?.remark ??
      response?.data ??
      null;

    if (!savedRemark) {
      throw new Error("Invalid response from server");
    }

    setRemarksByOutpass((prev) => ({
      ...prev,
      [remarksTarget.id]: [
        ...(prev[remarksTarget.id] || []),
        savedRemark,
      ],
    }));

    setRemarksText("");
    setRemarksModalOpen(false);
  } catch (err: any) {
    console.error("REMARK SAVE ERROR:", err);
    setDetailError(err?.message || "Failed to save remark");
  } finally {
    setRemarkSaving(false);
  }
}
  /* ================= STUDENT HISTORY: GET /api/students/:id/history =================
     Returns { profile, outpasses, visit_logs, complaints }. */

  async function fetchStudentHistory(studentId: string) {
    if (!studentId) {
      setHistoryError("This record has no student identifier to look up.");
      setHistoryResult(null);
      return;
    }

    try {
      setHistoryLoading(true);
      setHistoryError("");

      const response: any = await apiFetch(`/api/students/${studentId}/history`);

      const data: StudentHistoryResult = {
        profile: response?.profile || response?.data?.profile || {},
        outpasses: Array.isArray(response?.outpasses)
          ? response.outpasses
          : Array.isArray(response?.data?.outpasses)
          ? response.data.outpasses
          : [],
        visit_logs: Array.isArray(response?.visit_logs)
          ? response.visit_logs
          : Array.isArray(response?.data?.visit_logs)
          ? response.data.visit_logs
          : [],
        complaints: Array.isArray(response?.complaints)
          ? response.complaints
          : Array.isArray(response?.data?.complaints)
          ? response.data.complaints
          : [],
      };

      setHistoryResult(data);
    } catch (err: any) {
      console.error("STUDENT HISTORY FETCH ERROR:", err);
      setHistoryError(err?.message || "Failed to load student history");
      setHistoryResult(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  /* ================= LOGOUT ================= */

  function logout() {
    localStorage.clear();
    navigate("/");
  }

  /* ================= HELPER FOR FORMATTING TIME ================= */
  function format12Hour(time24: string) {
    if (!time24) return "";
    const [h, m] = time24.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const displayHour = h % 12 || 12;
    const displayMin = m < 10 ? `0${m}` : m;
    return `${displayHour}:${displayMin} ${period}`;
  }

  /* ================= DRAWER / MODAL HANDLERS ================= */

  function openDrawer(pass: Outpass) {
    setSelectedOutpass(pass);
    setDrawerOpen(true);
    setDrawerClosing(false);
    setDetailError("");
    fetchOutpassDetail(pass.id);
  }

  function closeDrawer() {
    setDrawerClosing(true);
    setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
      setSelectedOutpass(null);
    }, 200);
  }

  function openRemarksModal(pass: Outpass) {
    setRemarksTarget(pass);
    setRemarksText("");
    setRemarksModalOpen(true);
    setDetailError("");
    if (!remarksByOutpass[pass.id]) {
      fetchOutpassDetail(pass.id);
    }
  }

  function closeRemarksModal() {
    setRemarksModalOpen(false);
    setRemarksTarget(null);
    setRemarksText("");
  }

  function openHistoryModal(pass: Outpass) {
    setHistoryTarget(pass);
    setHistoryModalOpen(true);
    setHistoryResult(null);
    setHistoryError("");
    fetchStudentHistory(pass.student_id || pass.roll_no);
  }

  function closeHistoryModal() {
    setHistoryModalOpen(false);
    setHistoryTarget(null);
    setHistoryResult(null);
    setHistoryError("");
  }

  function retryHistory() {
    if (historyTarget) {
      fetchStudentHistory(historyTarget.student_id || historyTarget.roll_no);
    }
  }

  function retryDetail() {
    if (selectedOutpass) {
      fetchOutpassDetail(selectedOutpass.id);
    } else if (remarksTarget) {
      fetchOutpassDetail(remarksTarget.id);
    }
  }

  /* ================= FILTER & PAGINATE OUTPASSES ================= */

  const filteredOutpasses = useMemo(() => {
    const safeOutpasses = Array.isArray(outpasses) ? outpasses : [];
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);

    return safeOutpasses.filter((pass: Outpass) => {
      const q = search.toLowerCase().trim();

      const matchesSearch =
        !q ||
        pass.name?.toLowerCase().includes(q) ||
        pass.roll_no?.toLowerCase().includes(q) ||
        pass.phone?.includes(q) ||
        pass.department?.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "All" || pass.outp_status === statusFilter;

      const matchesHostel =
        hostelFilter === "All" || pass.hostel === hostelFilter;

      const matchesCampus =
        campusFilter === "All" ||
        (campusFilter === "Outside" && pass.std_status === "Out") ||
        (campusFilter === "Inside" && pass.std_status !== "Out");

      const mappedDept = pass.department ? DEPARTMENT_ALIASES[pass.department.toUpperCase()] || pass.department : null;
      const matchesDepartment =
        departmentFilter === "All" || mappedDept === departmentFilter;

      const matchesDate =
        !selectedDate ||
        (pass.created_at && pass.created_at.startsWith(selectedDate)) ||
        (pass.departure_datetime && pass.departure_datetime.startsWith(selectedDate)) ||
        (pass.arrival_datetime && pass.arrival_datetime.startsWith(selectedDate));

      const matchesQuick =
        quickFilter === "All" ||
        (quickFilter === "Today" && isSameDay(pass.created_at, now)) ||
        (quickFilter === "Yesterday" && isSameDay(pass.created_at, yesterday)) ||
        (quickFilter === "Emergency" && !!pass.is_emergency) ||
        (quickFilter === "Local" && pass.outpass_type === "Local") ||
        (quickFilter === "Home" && pass.outpass_type === "Home") ||
        (quickFilter === "Outstation" && pass.outpass_type === "Outstation") ||
        (quickFilter === "OutsideCampus" && pass.std_status === "Out") ||
        (quickFilter === "ReturnedToday" &&
          pass.std_status !== "Out" &&
          isSameDay(pass.arrival_datetime, now));

      return (
        matchesSearch &&
        matchesStatus &&
        matchesHostel &&
        matchesCampus &&
        matchesDepartment &&
        matchesDate &&
        matchesQuick
      );
    });
  }, [outpasses, search, statusFilter, hostelFilter, campusFilter, departmentFilter, selectedDate, quickFilter]);

  /* ================= FILTER & PAGINATE COMPLAINTS ================= */

  const filteredComplaints = useMemo(() => {
    const safeComplaints = Array.isArray(complaints) ? complaints : [];

    return safeComplaints.filter((comp: Complaint) => {
      const q = search.toLowerCase().trim();

      const matchesSearch =
        !q ||
        comp.student_name?.toLowerCase().includes(q) ||
        comp.student_roll_no?.toLowerCase().includes(q) ||
        comp.title?.toLowerCase().includes(q) ||
        comp.description?.toLowerCase().includes(q);

      const matchesHostel =
        hostelFilter === "All" || comp.hostel === hostelFilter;

      const matchesDate =
        !selectedDate ||
        (comp.date_created && comp.date_created.startsWith(selectedDate));

      const mappedDept = comp.student_department ? DEPARTMENT_ALIASES[comp.student_department.toUpperCase()] || comp.student_department : null;
      const matchesDepartment =
        departmentFilter === "All" || mappedDept === departmentFilter;

      return matchesSearch && matchesHostel && matchesDate && matchesDepartment;
    });
  }, [complaints, search, hostelFilter, selectedDate, departmentFilter]);

  /* ================= FILTER & PAGINATE ESCALATED COMPLAINTS ================= */

  const filteredEscalated = useMemo(() => {
    const safeComplaints = Array.isArray(escalatedComplaints) ? escalatedComplaints : [];

    return safeComplaints.filter((comp: Complaint) => {
      const q = search.toLowerCase().trim();

      const matchesSearch =
        !q ||
        comp.student_name?.toLowerCase().includes(q) ||
        comp.student_roll_no?.toLowerCase().includes(q) ||
        comp.title?.toLowerCase().includes(q) ||
        comp.description?.toLowerCase().includes(q);

      const matchesHostel =
        hostelFilter === "All" || comp.hostel === hostelFilter;

      const matchesDate =
        !selectedDate ||
        (comp.date_created && comp.date_created.startsWith(selectedDate));

      const mappedDept = comp.student_department ? DEPARTMENT_ALIASES[comp.student_department.toUpperCase()] || comp.student_department : null;
      const matchesDepartment =
        departmentFilter === "All" || mappedDept === departmentFilter;

      return matchesSearch && matchesHostel && matchesDate && matchesDepartment;
    });
  }, [escalatedComplaints, search, hostelFilter, selectedDate, departmentFilter]);

  /* ================= FILTER & PAGINATE LATE LOGS (TIME RANGE) ================= */

  const filteredLateLogs = useMemo(() => {
    const safeLateLogs = Array.isArray(lateLogs) ? lateLogs : [];

    // Parse From Time
    const [fromH, fromM] = fromTime.split(":").map(Number);
    const startMinutes = (fromH || 0) * 60 + (fromM || 0);

    // Parse To Time (Default to End of Day 23:59 if blank)
    const [toH, toM] = toTime ? toTime.split(":").map(Number) : [23, 59];
    const endMinutes = (toH ?? 23) * 60 + (toM ?? 59);

    const lateFromOutpasses: LateLog[] = (Array.isArray(outpasses) ? outpasses : [])
      .filter((pass: Outpass) => {
        if (!pass.arrival_datetime) return false;
        const arrivalDate = new Date(pass.arrival_datetime);
        const totalMinutes = arrivalDate.getHours() * 60 + arrivalDate.getMinutes();

        // Return time must fall between fromTime and toTime
        const fallsInWindow = totalMinutes >= startMinutes && totalMinutes <= endMinutes;
        return fallsInWindow || pass.std_status === "Out";
      })
      .map((pass: Outpass) => ({
        id: pass.id,
        student_id: pass.student_id || pass.roll_no,
        name: pass.name,
        roll_no: pass.roll_no,
        department: pass.department,
        hostel: pass.hostel,
        place_of_visit: pass.place_of_visit,
        departure_datetime: pass.departure_datetime,
        arrival_datetime: pass.arrival_datetime,
        std_status: pass.std_status,
        created_at: pass.created_at,
        outpass_type: pass.outpass_type,
      }));

    const mergedMap = new Map<string, LateLog>();
    safeLateLogs.forEach((item) => mergedMap.set(item.id, item));
    lateFromOutpasses.forEach((item) => {
      if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
    });

    const combinedList = Array.from(mergedMap.values());

    return combinedList.filter((log: LateLog) => {
      const q = search.toLowerCase().trim();

      const matchesSearch =
        !q ||
        log.name?.toLowerCase().includes(q) ||
        log.roll_no?.toLowerCase().includes(q) ||
        log.department?.toLowerCase().includes(q);

      const matchesHostel =
        hostelFilter === "All" || log.hostel === hostelFilter;

      const matchesCampus =
        campusFilter === "All" ||
        (campusFilter === "Outside" && log.std_status === "Out") ||
        (campusFilter === "Inside" && log.std_status !== "Out");

      const matchesDate =
        !selectedDate ||
        (log.arrival_datetime && log.arrival_datetime.startsWith(selectedDate)) ||
        (log.departure_datetime && log.departure_datetime.startsWith(selectedDate)) ||
        (log.created_at && log.created_at.startsWith(selectedDate));

      const mappedDept = log.department ? DEPARTMENT_ALIASES[log.department.toUpperCase()] || log.department : null;
      const matchesDepartment =
        departmentFilter === "All" || mappedDept === departmentFilter;

      return matchesSearch && matchesHostel && matchesCampus && matchesDate && matchesDepartment;
    });
  }, [lateLogs, outpasses, search, hostelFilter, campusFilter, fromTime, toTime, selectedDate, departmentFilter]);

  /* ================= STATISTICS ================= */

  const stats = useMemo(() => {
    const safeOutpasses = Array.isArray(outpasses) ? outpasses : [];
    return {
      total: safeOutpasses.length,
      pending: safeOutpasses.filter((p) => p.outp_status === "Pending").length,
      approved: safeOutpasses.filter((p) => p.outp_status === "Approved").length,
      outside: safeOutpasses.filter((p) => p.std_status === "Out").length,
      lateReturns: (Array.isArray(lateLogs) ? lateLogs : []).length,
      complaintsCount: (Array.isArray(complaints) ? complaints : []).length,
      emergency: safeOutpasses.filter((p) => !!p.is_emergency || p.outpass_type === "Emergency").length,
    };
  }, [outpasses, lateLogs, complaints]);

  /* ================= TIMELINE FOR SELECTED OUTPASS ================= */

  const timelineEvents = useMemo(() => {
    if (!selectedOutpass) return [];

    const events: {
      icon: any;
      title: string;
      timestamp?: string;
      description?: string;
      accent: string;
      sortKey: number;
    }[] = [];

    if (selectedOutpass.created_at) {
      events.push({
        icon: "FileText",
        title: "Outpass Created",
        timestamp: selectedOutpass.created_at,
        accent: "#6d0f16",
        sortKey: new Date(selectedOutpass.created_at).getTime(),
      });
    }

    if (selectedOutpass.outp_status === "Approved") {
      const ts = selectedOutpass.approved_at || selectedOutpass.created_at;
      events.push({
        icon: "Check",
        title: "Approved",
        timestamp: ts,
        accent: "#16a34a",
        sortKey: ts ? new Date(ts).getTime() : 0,
      });
    } else if (selectedOutpass.outp_status === "Rejected") {
      events.push({
        icon: "X",
        title: "Rejected",
        timestamp: selectedOutpass.approved_at || selectedOutpass.created_at,
        accent: "#dc2626",
        sortKey: new Date(
          selectedOutpass.approved_at || selectedOutpass.created_at || 0
        ).getTime(),
      });
    }

    if (selectedOutpass.departure_datetime) {
      events.push({
        icon: "User",
        title: "Student Exit",
        timestamp: selectedOutpass.departure_datetime,
        accent: "#ea580c",
        sortKey: new Date(selectedOutpass.departure_datetime).getTime(),
      });
    }

    if (selectedOutpass.arrival_datetime) {
      events.push({
        icon: "MapPin",
        title: "Student Return",
        timestamp: selectedOutpass.arrival_datetime,
        accent: "#2563eb",
        sortKey: new Date(selectedOutpass.arrival_datetime).getTime(),
      });
    }

    const remarks = remarksByOutpass[selectedOutpass.id] || [];
    remarks.forEach((r) => {
      events.push({
        icon: "Info",
        title: `Chief Warden Remark — ${r.author}`,
        timestamp: r.created_at,
        description: r.text,
        accent: "#7c3aed",
        sortKey: new Date(r.created_at).getTime(),
      });
    });

    return events.sort((a, b) => a.sortKey - b.sortKey);
  }, [selectedOutpass, remarksByOutpass]);

  /* ================= DOWNLOAD PDF REPORT ================= */

  const downloadPDFReport = () => {
    const doc = new jsPDF("landscape");

    doc.setFontSize(16);
    doc.setTextColor(109, 15, 22);
    doc.text("Late Returns & Movement Report", 14, 15);

    doc.setFontSize(10);
    doc.setTextColor(100);
    const dateText = selectedDate || "All Dates";
    const rangeText = `${format12Hour(fromTime)} to ${toTime ? format12Hour(toTime) : "End of Day"}`;
    doc.text(`Date: ${dateText} | Time Range: ${rangeText} | Hostel: ${hostelFilter}`, 14, 22);

    const tableHeaders = [
      [
        "Roll No",
        "Student Name",
        "Department",
        "Hostel",
        "Destination",
        "Departure",
        "Expected Arrival",
        "Campus Status",
      ],
    ];

    const tableRows = filteredLateLogs.map((item) => [
      item.roll_no || "-",
      item.name || "-",
      item.department || "-",
      item.hostel || "-",
      item.place_of_visit || "-",
      item.departure_datetime
        ? new Date(item.departure_datetime).toLocaleString("en-IN", {
            dateStyle: "short",
            timeStyle: "short",
          })
        : "-",
      item.arrival_datetime
        ? new Date(item.arrival_datetime).toLocaleString("en-IN", {
            dateStyle: "short",
            timeStyle: "short",
          })
        : "-",
      item.std_status === "Out" ? "Outside Campus" : "Inside Campus",
    ]);

    autoTable(doc, {
      head: tableHeaders,
      body: tableRows,
      startY: 28,
      theme: "striped",
      headStyles: { fillColor: [109, 15, 22], textColor: 255 },
      styles: { fontSize: 8, cellPadding: 2 },
    });

    const fileDate = selectedDate || "All_Dates";
    doc.save(`Late_Returns_Report_${fileDate}.pdf`);
  };

  /* ================= EXPORT CSV ================= */

 const exportCSV = () => {
  const headers = [
    "Roll No",
    "Student Name",
    "Department",
    "Hostel",
    "Destination",
    "Departure",
    "Expected Arrival",
    "Campus Status",
  ];

  const escapeCsv = (val: unknown): string =>
    `"${String(val ?? "-").replace(/"/g, '""')}"`;

  const rows = filteredLateLogs.map((item) =>
    [
      item.roll_no ?? "-",
      item.name ?? "-",
      item.department ?? "-",
      item.hostel ?? "-",
      item.place_of_visit ?? "-",
      item.departure_datetime ? safeDate(item.departure_datetime) : "-",
      item.arrival_datetime ? safeDate(item.arrival_datetime) : "-",
      item.std_status === "Out" ? "Outside Campus" : "Inside Campus",
    ]
      .map((v) => escapeCsv(v))
      .join(",")
  );

  const csvContent = [headers.map(escapeCsv).join(","), ...rows].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  const fileDate = selectedDate || "All_Dates";

  link.href = url;
  link.download = `Late_Returns_Report_${fileDate}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

  /* ================= PRINT REPORT ================= */

  const printReport = () => {
    const rangeText = `${format12Hour(fromTime)} to ${toTime ? format12Hour(toTime) : "End of Day"}`;
    const dateText = selectedDate || "All Dates";

    const rowsHtml = filteredLateLogs
      .map(
        (item) => `
        <tr>
          <td>${item.roll_no || "-"}</td>
          <td>${item.name || "-"}</td>
          <td>${item.department || "-"}</td>
          <td>${item.hostel || "-"}</td>
          <td>${item.place_of_visit || "-"}</td>
          <td>${item.departure_datetime ? safeDate(item.departure_datetime) : "-"}</td>
          <td>${item.arrival_datetime ? safeDate(item.arrival_datetime) : "-"}</td>
          <td>${item.std_status === "Out" ? "Outside Campus" : "Inside Campus"}</td>
        </tr>`
      )
      .join("");

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Late Returns & Movement Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #1f2937; }
            h1 { color: #6d0f16; font-size: 20px; margin-bottom: 4px; }
            p.meta { color: #6b7280; font-size: 12px; margin-top: 0; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #6d0f16; color: #fff; text-align: left; padding: 8px; }
            td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
            tr:nth-child(even) { background: #f9fafb; }
          </style>
        </head>
        <body>
          <h1>Late Returns & Movement Report</h1>
          <p class="meta">Date: ${dateText} | Time Range: ${rangeText} | Hostel: ${hostelFilter}</p>
          <table>
            <thead>
              <tr>
                <th>Roll No</th><th>Student Name</th><th>Department</th><th>Hostel</th>
                <th>Destination</th><th>Departure</th><th>Expected Arrival</th><th>Campus Status</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Dynamic Pagination calculations based on Active Tab
  const activeListLength =
    activeTab === "outpasses"
      ? filteredOutpasses.length
      : activeTab === "complaints"
      ? filteredComplaints.length
      : activeTab === "escalated"
      ? filteredEscalated.length
      : filteredLateLogs.length;

  const totalPages = Math.ceil(activeListLength / limit) || 1;

  const paginatedOutpasses = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredOutpasses.slice(start, start + limit);
  }, [filteredOutpasses, page, limit]);

  const paginatedComplaints = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredComplaints.slice(start, start + limit);
  }, [filteredComplaints, page, limit]);

  const paginatedEscalated = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredEscalated.slice(start, start + limit);
  }, [filteredEscalated, page, limit]);

  const paginatedLateLogs = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredLateLogs.slice(start, start + limit);
  }, [filteredLateLogs, page, limit]);

  const handleTabSwitch = (tab: any) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleFilterChange = (setter: any, val: any) => {
    setter(val);
    setPage(1);
  };

  const quickFilterChips: { key: QuickFilterKey; label: string }[] = [
    { key: "All", label: "All" },
    { key: "Today", label: "Today" },
    { key: "Yesterday", label: "Yesterday" },
    { key: "Emergency", label: "Emergency" },
    { key: "Local", label: "Local" },
    { key: "Home", label: "Home" },
    { key: "Outstation", label: "Outstation" },
    { key: "OutsideCampus", label: "Outside Campus" },
    { key: "ReturnedToday", label: "Returned Today" },
  ];

  /* ================= LOADING (SKELETON) ================= */

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-800">
        <div className="bg-[#6d0f16] text-white px-8 py-4 shadow-md flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-white/10 animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-48 rounded-full bg-white/20 animate-pulse" />
              <div className="h-2.5 w-64 rounded-full bg-white/10 animate-pulse" />
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto p-4 sm:p-8 space-y-6">
          <div className="flex overflow-x-auto gap-2.5 pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 sm:gap-4 scrollbar-none">
            {Array.from({ length: 7 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>

          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200/80">
              <div className="h-4 w-48 rounded-full bg-gray-100 animate-pulse" />
            </div>
            <TableSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#f9fafb] font-sans text-gray-800">
      <ChiefWardenSidebar 
        activeTab={activeTab} 
        setActiveTab={handleTabSwitch} 
        logout={logout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* ================= TOP HEADER ================= */}
        <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 shadow-sm flex flex-wrap justify-between items-center gap-3 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-1 rounded-xl text-gray-700 hover:bg-gray-100 md:hidden cursor-pointer transition"
              title="Open Navigation"
            >
              <Menu size={22} />
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-[#5b0e0e] capitalize">
              {activeTab === "lateLogs" ? "Late Returns" : activeTab} Dashboard
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* EXPORT BUTTONS */}
            {activeTab === "lateLogs" && (
              <>
                <button
                  onClick={downloadPDFReport}
                  disabled={filteredLateLogs.length === 0}
                  className="bg-[#5b0e0e] text-white hover:bg-[#741616] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Download size={16} /> PDF
                </button>
                <button
                  onClick={exportCSV}
                  disabled={filteredLateLogs.length === 0}
                  className="bg-white text-[#5b0e0e] border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText size={16} /> CSV
                </button>
                <button
                  onClick={printReport}
                  disabled={filteredLateLogs.length === 0}
                  className="bg-white text-[#5b0e0e] border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer size={16} /> Print
                </button>
              </>
            )}
          </div>
        </div>

        {/* ================= CONTENT ================= */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
        {activeTab === "allotment" && <WardensAllotment />}
        {activeTab === "devices" && <GuardDevices />}
        
        {activeTab !== "allotment" && activeTab !== "devices" && (
          <>
            {/* ================= STATISTICS CARDS ================= */}
            <div className="flex overflow-x-auto gap-2.5 pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 sm:gap-4 scrollbar-none">
              <StatCard label="Total Outpasses" value={stats.total} icon={<FileText size={24} />} accent="#6d0f16" />
              <StatCard label="Pending" value={stats.pending} icon={<Clock size={24} />} accent="#d97706" />
              <StatCard label="Approved" value={stats.approved} icon={<Check size={24} />} accent="#16a34a" />
              <StatCard label="Outside Campus" value={stats.outside} icon={<DoorOpen size={24} />} accent="#ea580c" />
              <StatCard label="Late Returns" value={stats.lateReturns} icon={<Clock size={24} />} accent="#dc2626" />
              <StatCard label="Complaints" value={stats.complaintsCount} icon={<AlertTriangle size={24} />} accent="#2563eb" />
              <StatCard label="Emergency" value={stats.emergency} icon={<AlertTriangle size={24} />} accent="#b91c1c" />
            </div>

        {/* ================= FILTERS & TIME RANGE ================= */}

        <div className="bg-white rounded-3xl shadow-sm border border-gray-200/80 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search by name, roll no, or phone..."
                value={search}
                onChange={(e) =>
                  handleFilterChange(setSearch, e.target.value)
                }
                className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 pl-10 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition"
              />
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <Search size={16} />
              </span>
            </div>

            {activeTab === "outpasses" && (
              <select
                value={statusFilter}
                onChange={(e) =>
                  handleFilterChange(setStatusFilter, e.target.value)
                }
                className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer"
              >
                <option value="All">All Outpass Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            )}

            {activeTab !== "complaints" && activeTab !== "escalated" && (
              <select
                value={campusFilter}
                onChange={(e) =>
                  handleFilterChange(setCampusFilter, e.target.value)
                }
                className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer"
              >
                <option value="All">All Locations (Inside & Outside)</option>
                <option value="Outside">Outside Campus</option>
                <option value="Inside">Inside Campus</option>
              </select>
            )}

            <select
              value={hostelFilter}
              onChange={(e) =>
                handleFilterChange(setHostelFilter, e.target.value)
              }
              className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer"
            >
              <option value="All">All Hostels</option>
              {hostels.map((hostel: any, index: number) => {
                const displayName = hostel.name || hostel.hostel_name;
                return (
                  <option key={hostel.id || index} value={displayName}>
                    {displayName}
                  </option>
                );
              })}
            </select>

            <select
              value={departmentFilter}
              onChange={(e) =>
                handleFilterChange(setDepartmentFilter, e.target.value)
              }
              className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer"
            >
              <option value="All">All Departments</option>
              {UNIQUE_DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* QUICK FILTER CHIPS */}
          {activeTab === "outpasses" && (
            <div className="flex flex-wrap gap-2 pt-1">
              {quickFilterChips.map((chip) => (
                <FilterChip
                  key={chip.key}
                  label={chip.label}
                  active={quickFilter === chip.key}
                  onClick={() => handleFilterChange(setQuickFilter, chip.key)}
                />
              ))}
            </div>
          )}

          {/* DYNAMIC TIME RANGE (FROM -> TO) & DATE PICKER */}
          <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* DATE PICKER */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Date:
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) =>
                    handleFilterChange(setSelectedDate, e.target.value)
                  }
                  className="bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-700 rounded-xl px-3 py-2 outline-none focus:border-[#6d0f16] transition"
                />
                {selectedDate && (
                  <button
                    onClick={() => handleFilterChange(setSelectedDate, "")}
                    className="text-xs text-red-600 font-semibold hover:underline cursor-pointer"
                  >
                    Clear Date
                  </button>
                )}
              </div>

              {/* TIME RANGE: FROM & TO */}
              {activeTab === "lateLogs" && (
                <div className="flex items-center gap-3 bg-gray-50/80 p-2 border border-gray-200 rounded-2xl">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                      From:
                    </label>
                    <input
                      type="time"
                      value={fromTime}
                      onChange={(e) =>
                        handleFilterChange(setFromTime, e.target.value)
                      }
                      className="bg-white border border-gray-200 text-xs font-semibold text-gray-700 rounded-xl px-2.5 py-1.5 outline-none focus:border-[#6d0f16] transition"
                    />
                  </div>

                  <span className="text-gray-400 font-bold text-xs">→</span>

                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                      To:
                    </label>
                    <input
                      type="time"
                      value={toTime}
                      onChange={(e) =>
                        handleFilterChange(setToTime, e.target.value)
                      }
                      placeholder="End of Day"
                      className="bg-white border border-gray-200 text-xs font-semibold text-gray-700 rounded-xl px-2.5 py-1.5 outline-none focus:border-[#6d0f16] transition"
                    />
                  </div>

                  <span className="text-xs font-bold text-[#6d0f16] px-1">
                    ({format12Hour(fromTime)} - {toTime ? format12Hour(toTime) : "End of Day"})
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 font-medium">
              Showing logs for: <span className="font-bold text-gray-700">{selectedDate || "All Dates"}</span>
            </p>
          </div>
        </div>

        {/* ================= TABS ================= */}

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => handleTabSwitch("outpasses")}
            className={`px-6 py-3 rounded-2xl text-xs font-bold transition shadow-xs cursor-pointer ${
              activeTab === "outpasses"
                ? "bg-[#6d0f16] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Outpasses ({filteredOutpasses.length})
          </button>

          <button
            onClick={() => handleTabSwitch("complaints")}
            className={`px-6 py-3 rounded-2xl text-xs font-bold transition shadow-xs cursor-pointer ${
              activeTab === "complaints"
                ? "bg-[#6d0f16] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Complaints ({filteredComplaints.length})
          </button>

          <button
            onClick={() => handleTabSwitch("escalated")}
            className={`px-6 py-3 rounded-2xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5 ${
              activeTab === "escalated"
                ? "bg-[#6d0f16] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Problems Not Resolved
          </button>

          <button
            onClick={() => handleTabSwitch("lateLogs")}
            className={`px-6 py-3 rounded-2xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5 ${
              activeTab === "lateLogs"
                ? "bg-[#6d0f16] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span></span> Late Logs ({format12Hour(fromTime)} - {toTime ? format12Hour(toTime) : "End"}) ({filteredLateLogs.length})
          </button>
        </div>

        {/* ================= ERROR ================= */}

        {error && <InlineError message={error} onRetry={fetchDashboard} />}

        {/* ================= OUTPASS TABLE ================= */}

        {activeTab === "outpasses" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200/80 flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#6d0f16]">
                Student Outpass Records
              </h2>
              <span className="text-xs font-semibold text-gray-500">
                {filteredOutpasses.length} Records Total
              </span>
            </div>

            {filteredOutpasses.length === 0 ? (
              <EmptyState
                title="No outpass records found"
                message="Try adjusting your filters or search terms, or clear them to see all records."
                actionLabel="Clear Filters"
                onAction={() => {
                  setSearch("");
                  setStatusFilter("All");
                  setHostelFilter("All");
                  setCampusFilter("All");
                  setDepartmentFilter("All");
                  setSelectedDate("");
                  setQuickFilter("All");
                }}
              />
            ) : (
              <div className="overflow-x-auto max-h-[560px]">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3.5 bg-gray-50">Student</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden md:table-cell">Department</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden lg:table-cell">Hostel</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden lg:table-cell">Destination</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden md:table-cell">Type</th>
                      <th className="px-6 py-3.5 bg-gray-50">Status</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden sm:table-cell">Date</th>
                      <th className="px-6 py-3.5 bg-gray-50">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {paginatedOutpasses.map((pass: Outpass) => {
                      const isEmergency =
                        !!pass.is_emergency || pass.outpass_type === "Emergency";
                      const isSelected = selectedOutpass?.id === pass.id;

                      return (
                        <tr
                          key={pass.id}
                          className={`transition-colors duration-150 ${
                            isSelected ? "bg-[#6d0f16]/5" : "hover:bg-gray-50/80"
                          }`}
                        >
                          <td className="px-6 py-4">
                            <div>
                              <h3
                                className="font-bold text-[#6d0f16] cursor-pointer hover:underline flex items-center flex-wrap"
                                onClick={() => openHistoryModal(pass)}
                              >
                                <HighlightText text={pass.name} query={search} />
                                {isEmergency && <EmergencyBadge />}
                              </h3>
                              <p className="text-xs text-gray-400">
                                <HighlightText text={pass.roll_no} query={search} />
                              </p>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-xs font-medium text-gray-600 hidden md:table-cell">
                            {pass.department || "-"}
                          </td>

                          <td className="px-6 py-4 text-xs font-medium text-gray-600 hidden lg:table-cell">
                            {pass.hostel || "-"}
                          </td>

                          <td className="px-6 py-4 text-xs font-medium text-gray-600 hidden lg:table-cell">
                            {pass.place_of_visit || "-"}
                          </td>

                          <td className="px-6 py-4 hidden md:table-cell">
                            <span className="bg-gray-100 text-gray-700 text-[11px] px-3 py-1 rounded-full font-semibold">
                              {pass.outpass_type}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <StatusPill pass={pass} />
                          </td>

                          <td className="px-6 py-4 text-xs text-gray-500 font-medium hidden sm:table-cell">
                            {pass.created_at
                              ? new Date(pass.created_at).toLocaleDateString(
                                  "en-IN"
                                )
                              : "-"}
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => openDrawer(pass)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#6d0f16]/5 text-[#6d0f16] text-[11px] font-bold hover:bg-[#6d0f16] hover:text-white transition cursor-pointer"
                              >
                                View
                              </button>
                              <button
                                onClick={() => openRemarksModal(pass)}
                                className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-bold hover:bg-blue-600 hover:text-white transition cursor-pointer"
                              >
                                Remarks
                              </button>
                              <button
                                onClick={() => openHistoryModal(pass)}
                                className="px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-bold hover:bg-gray-700 hover:text-white transition cursor-pointer"
                              >
                                History
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= COMPLAINT TABLE ================= */}

        {activeTab === "complaints" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200/80 flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#6d0f16]">
                Hostel Complaints
              </h2>
              <span className="text-xs font-semibold text-gray-500">
                {filteredComplaints.length} Complaints Total
              </span>
            </div>

            {filteredComplaints.length === 0 ? (
              <EmptyState
                title="No complaints found"
                message="Nothing matches your current search or filters."
                actionLabel="Clear Search"
                onAction={() => setSearch("")}
              />
            ) : (
              <div className="overflow-x-auto max-h-[560px]">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3.5 bg-gray-50">Student</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden md:table-cell">Hostel</th>
                      <th className="px-6 py-3.5 bg-gray-50">Complaint</th>
                      <th className="px-6 py-3.5 bg-gray-50">Status</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden sm:table-cell">Date</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {paginatedComplaints.map((comp: Complaint) => (
                      <tr
                        key={comp.id}
                        className="hover:bg-gray-50/80 transition-colors duration-150"
                      >
                        <td className="px-6 py-4">
                          <div>
                            <h3
                              className="font-bold text-[#6d0f16] cursor-pointer hover:underline"
                              onClick={() =>
                                comp.student_id &&
                                openHistoryModal({
                                  id: "",
                                  student_id: comp.student_id,
                                  name: comp.student_name || "",
                                  roll_no: comp.student_roll_no || "",
                                  phone: "",
                                  department: comp.student_department || "",
                                  hostel: comp.hostel,
                                  place_of_visit: "",
                                  outpass_type: "",
                                  outp_status: "",
                                  std_status: "",
                                  created_at: "",
                                } as Outpass)
                              }
                            >
                              <HighlightText text={comp.student_name} query={search} />
                            </h3>
                            <p className="text-xs text-gray-400">
                              <HighlightText text={comp.student_roll_no} query={search} />
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-4 text-xs font-medium text-gray-600 hidden md:table-cell">
                          {comp.hostel || "-"}
                        </td>

                        <td className="px-6 py-4 max-w-md">
                          <div>
                            <p className="font-semibold text-gray-800 text-xs">
                              <HighlightText text={comp.title || "Complaint"} query={search} />
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                              <HighlightText text={comp.description} query={search} />
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${
                              comp.status === "resolved"
                                ? "bg-green-100 text-green-800 border-green-200/60"
                                : "bg-amber-100 text-amber-800 border-amber-200/60"
                            }`}
                          >
                            {comp.status}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-xs text-gray-500 font-medium hidden sm:table-cell">
                          {comp.date_created
                            ? new Date(comp.date_created).toLocaleDateString(
                                "en-IN"
                              )
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= ESCALATED COMPLAINTS TABLE ================= */}

        {activeTab === "escalated" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200/80 flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#6d0f16]">
                Problems Not Resolved
              </h2>
              <span className="text-xs font-semibold text-gray-500">
                {filteredEscalated.length} High Priority
              </span>
            </div>

            {filteredEscalated.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-medium">
                No unresolved problems. All good!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-3.5">Student</th>
                      <th className="px-6 py-3.5">Hostel</th>
                      <th className="px-6 py-3.5">Complaint</th>
                      <th className="px-6 py-3.5">Status</th>
                      <th className="px-6 py-3.5">Date Raised</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {paginatedEscalated.map((comp: Complaint) => {
                      const daysOld = Math.floor((new Date().getTime() - new Date(comp.date_created).getTime()) / (1000 * 3600 * 24));
                      
                      return (
                      <tr
                        key={comp.id}
                        className="hover:bg-gray-50/80 transition bg-white"
                      >
                        <td className="px-6 py-4">
                          <div>
                            <h3 
                              className="font-bold text-[#6d0f16] cursor-pointer hover:underline"
                              onClick={() => fetchStudentHistory(comp.student_id || '')}
                            >
                              {comp.student_name || "-"}
                            </h3>
                            <p className="text-xs text-gray-400">
                              {comp.student_roll_no || "-"}
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-4 text-xs font-bold text-gray-700">
                          {comp.hostel || "-"}
                        </td>

                        <td className="px-6 py-4 max-w-md">
                          <div>
                            <p className="font-semibold text-gray-800 text-sm">
                              {comp.title || "Complaint"}
                            </p>
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {comp.description}
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className="text-[11px] px-3 py-1 rounded-full font-bold border bg-red-100 text-red-800 border-red-200"
                          >
                            Unresolved
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-gray-800">
                              {comp.date_created
                                ? new Date(comp.date_created).toLocaleDateString(
                                    "en-IN", { month: "short", day: "numeric", year: "numeric" }
                                  )
                                : "-"}
                            </span>
                            <span className="text-[10px] text-red-600 font-bold uppercase mt-1">
                              {daysOld} Days Overdue
                            </span>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= LATE LOGS TABLE ================= */}

        {activeTab === "lateLogs" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200/80 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-[#6d0f16]">
                  Late Campus Entries & Movement Logs
                </h2>
                <p className="text-xs text-gray-500">
                  Time Window: {format12Hour(fromTime)} to {toTime ? format12Hour(toTime) : "End of Day"}
                </p>
              </div>
              <span className="text-xs font-semibold text-gray-500">
                {filteredLateLogs.length} Records Found
              </span>
            </div>

            {filteredLateLogs.length === 0 ? (
              <EmptyState
                title="No late entries found"
                message="No overdue returns or movement logs for this time range yet."
              />
            ) : (
              <div className="overflow-x-auto max-h-[560px]">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3.5 bg-gray-50">Student</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden md:table-cell">Hostel</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden lg:table-cell">Destination</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden lg:table-cell">Departure</th>
                      <th className="px-6 py-3.5 bg-gray-50">Expected Return</th>
                      <th className="px-6 py-3.5 bg-gray-50">Campus Status</th>
                      <th className="px-6 py-3.5 bg-gray-50 hidden sm:table-cell">Time Flag</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {paginatedLateLogs.map((log: LateLog) => (
                      <tr
                        key={log.id}
                        className="hover:bg-red-50/30 transition-colors duration-150"
                      >
                        <td className="px-6 py-4">
                          <div>
                            <h3
                              className="font-bold text-[#6d0f16] cursor-pointer hover:underline"
                              onClick={() =>
                                log.student_id &&
                                openHistoryModal({
                                  id: log.id,
                                  student_id: log.student_id,
                                  name: log.name,
                                  roll_no: log.roll_no,
                                  phone: "",
                                  department: log.department,
                                  hostel: log.hostel || "",
                                  place_of_visit: log.place_of_visit || "",
                                  outpass_type: log.outpass_type || "",
                                  outp_status: "",
                                  std_status: log.std_status || "",
                                  created_at: log.created_at || "",
                                } as Outpass)
                              }
                            >
                              <HighlightText text={log.name} query={search} />
                            </h3>
                            <p className="text-xs text-gray-400">
                              <HighlightText text={log.roll_no} query={search} />
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-4 text-xs font-medium text-gray-600 hidden md:table-cell">
                          {log.hostel || "-"}
                        </td>

                        <td className="px-6 py-4 text-xs font-medium text-gray-600 hidden lg:table-cell">
                          {log.place_of_visit || "-"}
                        </td>

                        <td className="px-6 py-4 text-xs text-gray-600 font-medium hidden lg:table-cell">
                          {log.departure_datetime
                            ? new Date(log.departure_datetime).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "-"}
                        </td>

                        <td className="px-6 py-4 text-xs text-gray-600 font-medium">
                          {log.arrival_datetime
                            ? new Date(log.arrival_datetime).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "-"}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${
                              log.std_status === "Out"
                                ? "bg-orange-100 text-orange-800 border-orange-200"
                                : "bg-green-100 text-green-800 border-green-200"
                            }`}
                          >
                            {log.std_status === "Out" ? "Outside Campus" : "Inside Campus"}
                          </span>
                        </td>

                        <td className="px-6 py-4 hidden sm:table-cell">
                          <span className="bg-red-100 text-red-800 border border-red-200/60 text-[11px] px-3 py-1 rounded-full font-bold">
                            ⚠️ {format12Hour(fromTime)} - {toTime ? format12Hour(toTime) : "End"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= PAGINATION CONTROLS ================= */}

        {activeListLength > 0 && (
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-gray-500 font-medium">
              Showing page <span className="font-bold text-gray-800">{page}</span> of{" "}
              <span className="font-bold text-gray-800">{totalPages}</span> ({activeListLength} items)
            </p>

            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="px-3.5 py-1.5 rounded-xl border border-gray-300 text-xs font-semibold bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition shadow-xs cursor-pointer"
              >
                Previous
              </button>

              <span className="text-xs font-semibold px-2 text-gray-600">
                {page} / {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="px-3.5 py-1.5 rounded-xl border border-gray-300 text-xs font-semibold bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition shadow-xs cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
        </>
      )}
      </div>

      {/* ================= VIEW DETAILS DRAWER ================= */}

      {drawerOpen && selectedOutpass && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
              drawerClosing ? "opacity-0" : "opacity-100"
            }`}
            onClick={closeDrawer}
          />

          <div
            className={`relative w-full sm:w-[480px] max-w-full h-full bg-gray-50 shadow-2xl overflow-y-auto transition-transform duration-200 ease-out ${
              drawerClosing ? "translate-x-full" : "translate-x-0"
            }`}
          >
            <div className="bg-[#6d0f16] text-white px-6 py-5 sticky top-0 z-10 flex justify-between items-start">
              <div>
                <h2 className="text-lg font-extrabold flex items-center flex-wrap gap-1">
                  {selectedOutpass.name}
                  {(selectedOutpass.is_emergency ||
                    selectedOutpass.outpass_type === "Emergency") && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border-2 border-white/70 font-bold ml-1">
                      ⚡ Emergency
                    </span>
                  )}
                </h2>
                <p className="text-xs text-white/70 mt-0.5">
                  {selectedOutpass.roll_no} • {selectedOutpass.department || "-"}
                </p>
              </div>
              <button
                onClick={closeDrawer}
                className="text-white/80 hover:text-white text-xl leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* STATUS */}
              <div className="flex items-center gap-2">
                <StatusPill pass={selectedOutpass} />
                {detailLoading && (
                  <span className="text-[11px] text-gray-400 font-semibold">
                    Loading full details…
                  </span>
                )}
              </div>

              {detailError && (
                <InlineError message={detailError} onRetry={retryDetail} />
              )}

              {/* STUDENT INFO */}
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                  Student Information
                </h3>
                <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <dt className="text-gray-400 font-medium">Roll No</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.roll_no || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Department</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.department || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Hostel</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.hostel || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Room</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.room || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Phone</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.phone || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Email</dt>
                    <dd className="font-semibold text-gray-800 truncate">{selectedOutpass.email || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Parent Contact</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.parent_contact || "-"}</dd>
                  </div>
                </dl>
              </div>

              {/* OUTPASS INFO */}
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                  Outpass Details
                </h3>
                <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <dt className="text-gray-400 font-medium">Outpass Type</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.outpass_type || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Destination</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.place_of_visit || "-"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-gray-400 font-medium">Purpose</dt>
                    <dd className="font-semibold text-gray-800">{selectedOutpass.purpose || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Departure</dt>
                    <dd className="font-semibold text-gray-800">
                      {safeDate(selectedOutpass.departure_datetime)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Expected Arrival</dt>
                    <dd className="font-semibold text-gray-800">
                      {safeDate(selectedOutpass.arrival_datetime)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 font-medium">Approval Timestamp</dt>
                    <dd className="font-semibold text-gray-800">
                      {safeDate(selectedOutpass.approved_at)}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* TIMELINE */}
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">
                  Complete Timeline
                </h3>

                {detailLoading && timelineEvents.length === 0 ? (
                  <InlineSkeleton lines={4} />
                ) : timelineEvents.length === 0 ? (
                  <p className="text-xs text-gray-400">No timeline events available yet.</p>
                ) : (
                  <div>
                    {timelineEvents.map((ev, i) => (
                      <TimelineItem
                        key={i}
                        icon={ev.icon}
                        title={ev.title}
                        timestamp={ev.timestamp}
                        description={ev.description}
                        accent={ev.accent}
                        isLast={i === timelineEvents.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => openRemarksModal(selectedOutpass)}
                className="w-full py-3 rounded-2xl bg-[#6d0f16] text-white text-xs font-bold hover:bg-[#5a0c12] transition cursor-pointer"
              >
                + Add Chief Warden Remark
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= CHIEF WARDEN REMARKS MODAL ================= */}

      {remarksModalOpen && remarksTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 transition-opacity duration-200"
            onClick={closeRemarksModal}
          />

          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            <div className="bg-[#6d0f16] text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-sm">Chief Warden Remarks</h2>
                <p className="text-xs text-white/70">
                  {remarksTarget.name} • {remarksTarget.roll_no}
                </p>
              </div>
              <button
                onClick={closeRemarksModal}
                className="text-white/80 hover:text-white text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {detailError && (
                <InlineError message={detailError} onRetry={retryDetail} />
              )}

              {/* PREVIOUS REMARKS */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                  Previous Remarks
                </h3>

                {detailLoading && !remarksByOutpass[remarksTarget.id] ? (
                  <InlineSkeleton lines={2} />
                ) : (remarksByOutpass[remarksTarget.id] || []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No remarks added yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(remarksByOutpass[remarksTarget.id] || [])
                      .slice()
                      .reverse()
                      .map((r) => (
                        <div
                          key={r.id}
                          className="bg-gray-50 border border-gray-200/80 rounded-xl p-3"
                        >
                          <p className="text-xs text-gray-700">{r.text}</p>
                          <p className="text-[10px] text-gray-400 font-semibold mt-1">
                            {r.author} • {safeDate(r.created_at)}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* NEW REMARK */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                  Add New Remark
                </h3>
                <textarea
                  value={remarksText}
                  onChange={(e) =>
                    setRemarksText(e.target.value.slice(0, REMARKS_MAX_LEN))
                  }
                  rows={5}
                  placeholder="Write a remark about this outpass..."
                  className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition resize-none"
                />
                <div className="flex justify-end mt-1">
                  <span
                    className={`text-[10px] font-semibold ${
                      remarksText.length >= REMARKS_MAX_LEN
                        ? "text-red-500"
                        : "text-gray-400"
                    }`}
                  >
                    {remarksText.length} / {REMARKS_MAX_LEN}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={closeRemarksModal}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={saveRemark}
                disabled={!remarksText.trim() || remarkSaving}
                className="px-4 py-2 rounded-xl bg-[#6d0f16] text-white text-xs font-bold hover:bg-[#5a0c12] disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {remarkSaving ? "Saving…" : "Save Remark"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= HISTORY MODAL ================= */}

      {historyModalOpen && historyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 transition-opacity duration-200"
            onClick={closeHistoryModal}
          />

          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="bg-[#6d0f16] text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-sm">Student History</h2>
                <p className="text-xs text-white/70">
                  {historyTarget.name} • {historyTarget.roll_no}
                </p>
              </div>
              <button
                onClick={closeHistoryModal}
                className="text-white/80 hover:text-white text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {historyLoading && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-2xl p-4">
                      <InlineSkeleton lines={2} />
                    </div>
                    <div className="bg-gray-50 rounded-2xl p-4">
                      <InlineSkeleton lines={2} />
                    </div>
                  </div>
                  <InlineSkeleton lines={4} />
                </div>
              )}

              {!historyLoading && historyError && (
                <InlineError message={historyError} onRetry={retryHistory} />
              )}

              {!historyLoading && !historyError && historyResult && (
                <>
                  {/* PROFILE */}
                  <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                      Student Profile
                    </h3>
                    <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs">
                      <div>
                        <dt className="text-gray-400 font-medium">Roll No</dt>
                        <dd className="font-semibold text-gray-800">
                          {historyResult.profile?.roll_no || historyTarget.roll_no || "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-400 font-medium">Department</dt>
                        <dd className="font-semibold text-gray-800">
                          {historyResult.profile?.department || historyTarget.department || "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-400 font-medium">Hostel</dt>
                        <dd className="font-semibold text-gray-800">
                          {historyResult.profile?.hostel || historyTarget.hostel || "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-400 font-medium">Room</dt>
                        <dd className="font-semibold text-gray-800">
                          {historyResult.profile?.room || "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-400 font-medium">Phone</dt>
                        <dd className="font-semibold text-gray-800">
                          {historyResult.profile?.phone || historyTarget.phone || "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-400 font-medium">Parent Contact</dt>
                        <dd className="font-semibold text-gray-800">
                          {historyResult.profile?.parent_contact || "-"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* SUMMARY COUNTS */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-green-50 border border-green-200/60 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-extrabold text-green-700">
                        {historyResult.outpasses.filter((p) => p.outp_status === "Approved").length}
                      </p>
                      <p className="text-[11px] font-bold text-green-700/70 uppercase tracking-wider">
                        Approved Outpasses
                      </p>
                    </div>
                    <div className="bg-red-50 border border-red-200/60 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-extrabold text-red-700">
                        {historyResult.outpasses.filter((p) => p.outp_status === "Rejected").length}
                      </p>
                      <p className="text-[11px] font-bold text-red-700/70 uppercase tracking-wider">
                        Rejected Outpasses
                      </p>
                    </div>
                  </div>

                  {/* SPREADSHEET VIEW FOR OUTPASSES */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                      Outpass History ({historyResult.outpasses.length})
                    </h3>
                    {historyResult.outpasses.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No previous outpasses.</p>
                    ) : (
                      <div className="overflow-x-auto border border-gray-200/80 rounded-xl shadow-sm">
                        <table className="w-full text-left text-xs whitespace-nowrap">
                          <thead className="bg-gray-50 border-b border-gray-200/80 text-gray-500 font-bold uppercase tracking-wider">
                            <tr>
                              <th className="px-4 py-3">Type</th>
                              <th className="px-4 py-3">Destination & Purpose</th>
                              <th className="px-4 py-3">Departure (Out)</th>
                              <th className="px-4 py-3">Arrival (In)</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3">Campus</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {historyResult.outpasses.map((p) => (
                              <tr key={p.id} className="hover:bg-gray-50/50 transition">
                                <td className="px-4 py-3 font-semibold text-gray-700">
                                  {p.outpass_type}
                                  {p.is_emergency && <span className="ml-1 text-red-500">⚡</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={`${p.place_of_visit || "Local"} - ${p.purpose || ""}`}>
                                  <span className="font-semibold">{p.place_of_visit || "Local"}</span>
                                  {p.purpose && <span className="text-gray-400 ml-1">- {p.purpose}</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-600">
                                  {safeDate(p.departure_datetime)}
                                </td>
                                <td className="px-4 py-3 text-gray-600">
                                  {safeDate(p.arrival_datetime)}
                                </td>
                                <td className="px-4 py-3">
                                  <StatusPill pass={p} />
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${p.std_status === 'Out' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                    {p.std_status || "In"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
export default ChiefWarden;