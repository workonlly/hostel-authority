import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";
import { broadcastSessionLogout } from "../utils/sessionSync";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import WardenSidebar from "./WardenSidebar";
import AttendantsAllotment from "./AttendantsAllotment";
import { 
  Download,
  Search,
  Menu
} from "lucide-react";

/* ================= TYPES ================= */

interface Remark {
  id?: string;
  role: string;
  name: string;
  timestamp: string;
  message: string;
}

interface Outpass {
  id: string;
  name: string;
  roll_no: string;
  phone: string;
  email?: string;
  department: string;
  hostel: string;
  room?: string;
  place_of_visit: string;
  purpose?: string;
  parent_contact?: string;
  outpass_type: string;
  outp_status: string;
  std_status: string;
  emergency?: boolean;
  created_at: string;
  approved_at?: string;
  departure_datetime?: string;
  arrival_datetime?: string;
  remarks?: Remark[];
}

interface Complaint {
  id: string;
  title?: string;
  description: string;
  hostel: string;
  status: string;
  student_name?: string;
  student_roll_no?: string;
  date_created: string;
}

interface LateLog {
  id: string;
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

type ActionTarget = { type: "single" | "bulk"; id?: string } | null;

/* ================= HELPERS ================= */

function formatDateTime(value?: string) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "-";
  }
}

// Extracts a human-readable error message from a failed apiFetch call, covering
// auth failures, permission failures, network failures, and standard backend
// error payload shapes.
function getApiErrorMessage(err: any, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;

  const status = err.status || err.response?.status;
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";

  if (typeof TypeError !== "undefined" && err instanceof TypeError) {
    return "Network error. Please check your connection and try again.";
  }

  if (err.data?.message) return err.data.message;
  if (err.response?.data?.message) return err.response.data.message;

  if (err.message) {
    try {
      const parsed = JSON.parse(err.message);
      if (parsed?.message) return parsed.message;
      if (parsed?.error) return parsed.error;
    } catch {
      // not JSON, fall through
    }
    return err.message;
  }

  return fallback;
}

function extractFieldErrors(err: any): Record<string, string> {
  const errors = err?.data?.errors || err?.response?.data?.errors;
  if (errors && typeof errors === "object" && !Array.isArray(errors)) {
    return errors;
  }
  return {};
}

// Normalizes rows coming back from endpoints that alias the outpass primary
// key as `outpass_id` (e.g. POST /api/students/hostel-status and
// POST /api/students/range) into the `id` field the rest of this component
// (Outpass interface, approve/reject/details handlers, row keys, checkboxes)
// expects. Endpoints that already return `o.*` (e.g. GET /api/outpasses/monitor)
// already have `id` and pass through unchanged.
function normalizeOutpassId(o: any) {
  return { ...o, id: o?.id ?? o?.outpass_id };
}

/* ================= COMPONENT ================= */

export default function Warden() {
  const navigate = useNavigate();

  // Extract assigned warden hostel from localStorage or logged-in user profile
  const [assignedHostel] = useState<string>(() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      return user?.hostel || user?.hostel_name || "Boys Hostel A";
    } catch {
      return "Boys Hostel A";
    }
  });

  const [outpasses, setOutpasses] = useState<Outpass[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [lateLogs, setLateLogs] = useState<LateLog[]>([]);
  const [activeTab, setActiveTab] = useState<
    "outpasses" | "complaints" | "lateLogs" | "allotment"
  >("outpasses");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Pending"); // Pending selected by default
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [outpassTypeFilter, setOutpassTypeFilter] = useState("All");

  /* ================= BACKEND STATUS FILTER STATE ================= */
  // Status filtering is now resolved server-side via POST /api/students/hostel-status.
  // These results replace the base `outpasses` list whenever a non-range-search
  // status filter is applied; other filters (search/department/type/date) still
  // apply on top of them on the frontend, same as before.
  const [statusResults, setStatusResults] = useState<Outpass[] | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  // Guards against stale/out-of-order responses when the status filter is
  // changed rapidly (prevents an older, slower response from clobbering a
  // newer one) and de-dupes concurrent requests for the same filter.
  const statusRequestIdRef = useRef(0);

  // Background refresh indicator for the monitor table only — distinct from
  // the full-page `loading` spinner, which should only ever show on the very
  // first mount so approve/reject/bulk refreshes don't blank the whole screen.
  const [monitorRefreshing, setMonitorRefreshing] = useState(false);

  /* ================= DYNAMIC TIME RANGE & DATE CONSTRAINTS ================= */
  const [fromTime, setFromTime] = useState("20:00"); // Start time (Default 8:00 PM)
  const [toTime, setToTime] = useState(""); // End time (Optional - Blank means end of day)
  const [selectedDate, setSelectedDate] = useState(""); // YYYY-MM-DD filter for specific date

  /* ================= BACKEND RANGE SEARCH STATE ================= */
  const [rangeFrom, setRangeFrom] = useState(""); // datetime-local string
  const [rangeTo, setRangeTo] = useState(""); // datetime-local string
  const [rangeResults, setRangeResults] = useState<Outpass[]>([]);
  const [isRangeActive, setIsRangeActive] = useState(false);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");

  /* ================= BULK SELECTION STATE ================= */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* ================= VIEW DETAILS MODAL STATE ================= */
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState<Outpass | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  /* ================= APPROVE MODAL STATE ================= */
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<ActionTarget>(null);
  const [approveRemark, setApproveRemark] = useState("");
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approveFieldErrors, setApproveFieldErrors] = useState<Record<string, string>>({});

  /* ================= REJECT MODAL STATE ================= */
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ActionTarget>(null);
  const [rejectRemark, setRejectRemark] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectError, setRejectError] = useState("");
  const [rejectFieldErrors, setRejectFieldErrors] = useState<Record<string, string>>({});

  /* ================= APPOINT ATTENDANT MODAL STATE ================= */
  const [isAppointModalOpen, setIsAppointModalOpen] = useState(false);
  const [appointForm, setAppointForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [appointFieldErrors, setAppointFieldErrors] = useState<Record<string, string>>({});
  const [appointLoading, setAppointLoading] = useState(false);
  const [appointMsg, setAppointMsg] = useState({ type: "", text: "" });

  /* ================= OUTPASS SETTINGS MODAL STATE ================= */
  // Unified modal for all outpass-related configuration (currently: submission deadline).
  const [isOutpassSettingsModalOpen, setIsOutpassSettingsModalOpen] = useState(false);
  const [outpassCutoffTime, setOutpassCutoffTime] = useState("17:00");
  const [outpassSettingsLoading, setOutpassSettingsLoading] = useState(false); // loading current values (GET)
  const [outpassSettingsSaving, setOutpassSettingsSaving] = useState(false); // saving (PATCH)
  const [outpassSettingsError, setOutpassSettingsError] = useState("");

  /* ================= TOAST STATE (shared/reusable) ================= */
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
  }

  /* ================= PAGINATION STATE ================= */
  const [page, setPage] = useState(1);
  const limit = 6; // Items per page

  /* ================= DOWNLOAD LOADING STATE ================= */
  const [downloadingOutpassReport, setDownloadingOutpassReport] = useState(false);
  const [downloadingLateReport, setDownloadingLateReport] = useState(false);

  /* ================= FETCH DATA ================= */

  useEffect(() => {
    fetchOutpasses();
    fetchComplaints();
    fetchLateLogs();
  }, []);

  // Fetch current outpass settings whenever the settings modal is opened
  useEffect(() => {
    if (isOutpassSettingsModalOpen) {
      fetchOutpassSettings();
    }
  }, [isOutpassSettingsModalOpen]);

  // Serves both the Outpass Management table and the Monitor Dashboard.
  // `silent` refreshes (used after approve/reject/bulk actions, and by the
  // status-filter effect) use the small inline `monitorRefreshing` indicator
  // instead of the full-page `loading` spinner, so the table/modals don't
  // flash away and the current page/scroll position is preserved.
  async function fetchOutpasses(opts: { silent?: boolean } = {}) {
    try {
      if (!opts.silent) setLoading(true);
      setMonitorRefreshing(true);
      setError("");

      const res: any = await apiFetch("/api/outpasses/monitor");

      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.outpasses)
        ? res.outpasses
        : Array.isArray(res?.data?.outpasses)
        ? res.data.outpasses
        : [];

      // /api/outpasses/monitor already returns the raw `outpass` row (o.*),
      // so `id` is already present here — normalizeOutpassId is a no-op for
      // this endpoint but kept for consistency/safety.
      setOutpasses(list.map(normalizeOutpassId));
    } catch (err: any) {
      console.log("Failed to load outpasses:", err);
      setOutpasses([]);
      const message = getApiErrorMessage(err, "Failed to load outpasses. Please try again.");
      setError(message);
      if (opts.silent) showToast("error", message);
    } finally {
      if (!opts.silent) setLoading(false);
      setMonitorRefreshing(false);
    }
  }

  async function fetchComplaints() {
    try {
      const res: any = await apiFetch("/complaint/all");

      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.complaints)
        ? res.complaints
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.complaints)
        ? res.data.complaints
        : [];

      setComplaints(list);
    } catch (err) {
      console.log("Complaint API failed:", err);
      setComplaints([]);
      showToast("error", getApiErrorMessage(err, "Failed to load complaints."));
    }
  }

  async function fetchLateLogs() {
    try {
      const res: any = await apiFetch("/api/outpasses/late-returns");

      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.late_returns)
        ? res.late_returns
        : [];

      setLateLogs(list);
    } catch (err) {
      console.log("Late logs fetch failed:", err);
      setLateLogs([]);
      showToast("error", getApiErrorMessage(err, "Failed to load late returns."));
    }
  }

  // GET /api/management/outpass-cutoff — populates the deadline field when the
  // Outpass Settings modal is opened. The backend identifies the Warden's hostel
  // from the JWT, so no hostel info is sent or needed here.
  async function fetchOutpassSettings() {
    try {
      setOutpassSettingsLoading(true);
      setOutpassSettingsError("");

      const res: any = await apiFetch("/api/management/outpass-cutoff");

      // Backend returns HH:MM:SS (e.g. "17:00:00") — strip the seconds for the
      // HTML time input, which expects HH:MM.
      const rawCutoff: string = res?.data?.cutoffTime ?? "17:00:00";
      const cutoffHHMM = rawCutoff.slice(0, 5);

      setOutpassCutoffTime(cutoffHHMM);
    } catch (err: any) {
      console.log("Failed to fetch outpass cutoff time:", err);
      setOutpassSettingsError(
        "Could not load the current submission deadline. Showing default value."
      );
    } finally {
      setOutpassSettingsLoading(false);
    }
  }

  // POST /api/students/hostel-status — resolves the Pending/Approved/Rejected/All
  // status filter server-side (scoped to the Warden's hostel via JWT). Falls back
  // to leaving `statusResults` null (i.e. use the base monitor list + frontend
  // status filter) if the backend call fails, so the table never goes empty.
  //
  // IMPORTANT: the backend expects the field name `outp_status` (matching the
  // Outpass model), not a generic `status` — sending the wrong key was why the
  // filter previously came back empty/unfiltered.
  //
  // IMPORTANT #2: the backend query for this endpoint aliases the outpass
  // primary key as `o.id AS outpass_id`, not `id`. Every row returned here is
  // run through normalizeOutpassId() so `.id` (used by View Details, Approve,
  // Reject, and the row/checkbox keys) is always populated. Without this, those
  // actions send requests like `/api/outpasses/approve/undefined`, which the
  // backend rejects with "Invalid outpass id".
  const fetchStatusResults = useCallback(
    async (status: string) => {
      // "All" has no backend-meaningful status to send; just use the monitor list.
      if (status === "All") {
        setStatusResults(null);
        setStatusError("");
        return;
      }

      // Tag this request so a slower, older response can't clobber a newer
      // one if the filter is changed again before this call resolves.
      const requestId = ++statusRequestIdRef.current;

      try {
        setStatusLoading(true);
        setStatusError("");

        const res: any = await apiFetch("/api/students/hostel-status", {
          method: "POST",
          body: JSON.stringify({ outp_status: status }),
        });

        if (requestId !== statusRequestIdRef.current) return; // stale response, ignore

        const list = Array.isArray(res)
          ? res
          : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.outpasses)
          ? res.outpasses
          : Array.isArray(res?.data?.outpasses)
          ? res.data.outpasses
          : [];

        setStatusResults(list.map(normalizeOutpassId));
      } catch (err: any) {
        if (requestId !== statusRequestIdRef.current) return; // stale response, ignore
        console.log("Status filter fetch failed:", err);
        const message = getApiErrorMessage(
          err,
          "Failed to filter by status. Showing all loaded records."
        );
        setStatusError(message);
        showToast("error", message);
        setStatusResults(null);
      } finally {
        if (requestId === statusRequestIdRef.current) setStatusLoading(false);
      }
    },
    []
  );

  // Re-run the backend status filter whenever it changes, unless a range search
  // is currently active (range search results take precedence and are already
  // scoped server-side).
  useEffect(() => {
    if (isRangeActive) return;
    fetchStatusResults(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, isRangeActive]);

  /* ================= HANDLERS ================= */

  function logout() {
    apiFetch("/api/authority/logout", { method: "POST" }).catch(() => {});
    broadcastSessionLogout();
    localStorage.clear();
    navigate("/login");
  }

  function format12Hour(time24: string) {
    if (!time24) return "";
    const [h, m] = time24.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const displayHour = h % 12 || 12;
    const displayMin = m < 10 ? `0${m}` : m;
    return `${displayHour}:${displayMin} ${period}`;
  }

  async function handleAppointAttendant(e: React.FormEvent) {
    e.preventDefault();
    try {
      setAppointLoading(true);
      setAppointMsg({ type: "", text: "" });
      setAppointFieldErrors({});

      await apiFetch("/api/students/assign-attendent", {
        method: "POST",
        body: JSON.stringify({
          name: appointForm.name,
          email: appointForm.email,
          phone: appointForm.phone,
          password: appointForm.password,
        }),
      });

      setAppointMsg({
        type: "success",
        text: "Attendant appointed successfully!",
      });
      showToast("success", "Attendant appointed successfully.");

      setTimeout(() => {
        setIsAppointModalOpen(false);
        setAppointForm({ name: "", email: "", phone: "", password: "" });
        setAppointMsg({ type: "", text: "" });
        setAppointFieldErrors({});
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setAppointFieldErrors(extractFieldErrors(err));
      setAppointMsg({
        type: "error",
        text: getApiErrorMessage(err, "Failed to appoint attendant."),
      });
    } finally {
      setAppointLoading(false);
    }
  }

  // Single Save handler for the unified "Outpass Settings" modal.
  async function handleSaveOutpassSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      setOutpassSettingsSaving(true);
      setOutpassSettingsError("");

      // Only the cutoff time is sent — the backend resolves the Warden's hostel
      // from the JWT (req.user.id), so no hostel ID/name is included here.
      const res: any = await apiFetch("/api/management/outpass-cutoff", {
        method: "PATCH",
        body: JSON.stringify({ cutoffTime: outpassCutoffTime }),
      });

      // Reflect the server-confirmed value (HH:MM:SS -> HH:MM) in the displayed field.
      const rawCutoff: string = res?.data?.cutoffTime ?? `${outpassCutoffTime}:00`;
      setOutpassCutoffTime(rawCutoff.slice(0, 5));

      showToast("success", "Outpass settings updated successfully.");
      setIsOutpassSettingsModalOpen(false);
    } catch (err: any) {
      console.error(err);
      const message = getApiErrorMessage(err, "Failed to update outpass settings. Please try again.");
      setOutpassSettingsError(message);
      showToast("error", message);
    } finally {
      setOutpassSettingsSaving(false);
    }
  }

  /* ================= VIEW DETAILS ================= */

  async function openDetailsModal(id: string) {
    setIsDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsError("");
    setDetailsData(null);
    try {
      const res: any = await apiFetch(`/api/students/outpass/${id}`);
      setDetailsData(res?.data ?? res);
    } catch (err: any) {
      const message = getApiErrorMessage(err, "Failed to load outpass details.");
      setDetailsError(message);
      showToast("error", message);
    } finally {
      setDetailsLoading(false);
    }
  }

  /* ================= APPROVE / REJECT ================= */

  function openApproveModal(target: ActionTarget) {
    setApproveTarget(target);
    setApproveRemark("");
    setApproveError("");
    setApproveFieldErrors({});
    setIsApproveOpen(true);
  }

  function openRejectModal(target: ActionTarget) {
    setRejectTarget(target);
    setRejectRemark("");
    setRejectError("");
    setRejectFieldErrors({});
    setIsRejectOpen(true);
  }

  // Refreshes every section that can be affected by an approve/reject/bulk
  // action: the monitor list (silently, so the page/scroll position and any
  // open modal aren't disturbed), the currently active backend status filter
  // or range search, the open Details modal (if any), and dashboard/pending
  // counts — all of which are derived from this same state, so refetching it
  // is enough to keep everything in sync without a full page reload.
  async function refreshAfterAction() {
    const tasks: Promise<any>[] = [fetchOutpasses({ silent: true })];
    if (isRangeActive) {
      tasks.push(runRangeSearch());
    } else {
      tasks.push(fetchStatusResults(statusFilter));
    }
    await Promise.all(tasks);
    await refreshDetailsIfOpen();
  }

  // If the Details modal is currently showing an outpass, silently refetch it
  // so its status and remarks reflect the just-completed approve/reject
  // without requiring the warden to close and reopen the modal.
  async function refreshDetailsIfOpen() {
    if (!isDetailsOpen || !detailsData?.id) return;
    try {
      const res: any = await apiFetch(`/api/students/outpass/${detailsData.id}`);
      setDetailsData(res?.data ?? res);
    } catch (err) {
      // Non-fatal — the modal keeps showing the last-known data.
      console.log("Failed to refresh open outpass details:", err);
    }
  }

  async function submitApprove(e: React.FormEvent) {
    e.preventDefault();
    setApproveLoading(true);
    setApproveError("");
    setApproveFieldErrors({});
    try {
      if (approveTarget?.type === "bulk") {
        await apiFetch("/api/outpasses/bulk-action", {
          method: "PATCH",
          body: JSON.stringify({
            ids: Array.from(selectedIds),
            action: "approve",
            remark: approveRemark.trim() || undefined,
          }),
        });
        setSelectedIds(new Set());
      } else if (approveTarget?.id) {
        await apiFetch(`/api/outpasses/approve/${approveTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ remark: approveRemark.trim() || undefined }),
        });
      }

      showToast(
        "success",
        approveTarget?.type === "bulk"
          ? "Selected outpasses approved successfully."
          : "Outpass approved successfully."
      );
      setIsApproveOpen(false);
      setApproveRemark("");
      await refreshAfterAction(); // refresh monitor + status filter + range results + open details
    } catch (err: any) {
      // Remark text is intentionally left untouched here so it isn't lost on failure.
      setApproveFieldErrors(extractFieldErrors(err));
      const message = getApiErrorMessage(err, "Failed to approve outpass. Please try again.");
      setApproveError(message);
      showToast("error", message);
    } finally {
      setApproveLoading(false);
    }
  }

  async function submitReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectRemark.trim()) {
      setRejectError("A remark is required to reject an outpass.");
      return;
    }
    setRejectLoading(true);
    setRejectError("");
    setRejectFieldErrors({});
    try {
      if (rejectTarget?.type === "bulk") {
        await apiFetch("/api/outpasses/bulk-action", {
          method: "PATCH",
          body: JSON.stringify({
            ids: Array.from(selectedIds),
            action: "reject",
            remark: rejectRemark.trim(),
          }),
        });
        setSelectedIds(new Set());
      } else if (rejectTarget?.id) {
        await apiFetch(`/api/outpasses/reject/${rejectTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ remark: rejectRemark.trim() }),
        });
      }

      showToast(
        "success",
        rejectTarget?.type === "bulk"
          ? "Selected outpasses rejected successfully."
          : "Outpass rejected successfully."
      );
      setIsRejectOpen(false);
      setRejectRemark("");
      await refreshAfterAction(); // refresh monitor + status filter + range results + open details
    } catch (err: any) {
      // rejectRemark is intentionally left untouched here so the warden doesn't
      // have to retype it after a validation or network failure.
      setRejectFieldErrors(extractFieldErrors(err));
      const message = getApiErrorMessage(err, "Failed to reject outpass. Please try again.");
      setRejectError(message);
      showToast("error", message);
    } finally {
      setRejectLoading(false);
    }
  }

  /* ================= BULK SELECTION HELPERS ================= */

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ================= BACKEND RANGE SEARCH ================= */

  // Extracted from the submit handler so it can also be called silently by
  // refreshAfterAction() (no loading spinner / validation noise on refresh).
  //
  // NOTE: POST /api/students/range returns { data: { students: [...], pagination } }
  // (NOT { data: { outpasses: [...] } }), and each row aliases the outpass
  // primary key as `outpass_id`, same as /api/students/hostel-status. Both the
  // extraction path and the id normalization below account for that — without
  // them this list comes back empty, and any row that did render would send
  // approve/reject/details requests with an `undefined` id ("Invalid outpass id").
  async function runRangeSearch() {
    const res: any = await apiFetch("/api/students/range", {
      method: "POST",
      body: JSON.stringify({
        departure_datetime: rangeFrom || undefined,
        arrival_datetime: rangeTo || undefined,
      }),
    });

    const list = Array.isArray(res)
      ? res
      : Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.students)
      ? res.students
      : Array.isArray(res?.data?.students)
      ? res.data.students
      : Array.isArray(res?.outpasses)
      ? res.outpasses
      : Array.isArray(res?.data?.outpasses)
      ? res.data.outpasses
      : [];

    setRangeResults(list.map(normalizeOutpassId));
  }

  async function handleRangeSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!rangeFrom && !rangeTo) {
      setRangeError("Please select at least a from or to date/time.");
      return;
    }
    setRangeLoading(true);
    setRangeError("");
    try {
      await runRangeSearch();
      setIsRangeActive(true);
      setPage(1);
    } catch (err: any) {
      const message = getApiErrorMessage(err, "Range search failed. Please try again.");
      setRangeError(message);
      showToast("error", message);
    } finally {
      setRangeLoading(false);
    }
  }

  function clearRangeSearch() {
    setIsRangeActive(false);
    setRangeResults([]);
    setRangeFrom("");
    setRangeTo("");
    setRangeError("");
    setPage(1);
  }

  /* ================= STATUS BADGE HELPER ================= */

  function getStatus(pass: Outpass) {
    if (pass.std_status === "Out") {
      return {
        label: "Outside",
        className: "bg-orange-100 text-orange-800 border-orange-200/60",
      };
    }

    if (pass.outp_status === "Approved") {
      return {
        label: "Approved",
        className: "bg-green-100 text-green-800 border-green-200/60",
      };
    }

    if (pass.outp_status === "Pending") {
      return {
        label: "Pending",
        className: "bg-amber-100 text-amber-800 border-amber-200/60",
      };
    }

    return {
      label: "Rejected",
      className: "bg-red-100 text-red-800 border-red-200/60",
    };
  }

  /* ================= EMPTY STATE MESSAGE HELPERS ================= */

  function getOutpassEmptyMessage() {
    const q = search.trim();
    if (q) return `No Search Results for "${q}"`;
    if (isRangeActive) return `No outpasses found in the selected range for ${assignedHostel}`;
    switch (statusFilter) {
      case "Pending":
        return `No Pending Outpasses for ${assignedHostel}`;
      case "Approved":
        return `No Approved Outpasses for ${assignedHostel}`;
      case "Rejected":
        return `No Rejected Outpasses for ${assignedHostel}`;
      default:
        return `No outpass records found for ${assignedHostel} matching criteria`;
    }
  }

  function getLateLogsEmptyMessage() {
    const q = search.trim();
    if (q) return `No Search Results for "${q}"`;
    return `No Late Returns found for ${assignedHostel} in this time range`;
  }

  function getComplaintsEmptyMessage() {
    const q = search.trim();
    if (q) return `No Search Results for "${q}"`;
    return `No complaints found for ${assignedHostel} matching criteria`;
  }

  /* ================= DEPARTMENT OPTIONS (derived from live data) ================= */

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(outpasses) ? outpasses : []).forEach((p) => {
      if (p.department) set.add(p.department);
    });
    return Array.from(set).sort();
  }, [outpasses]);

  /* ================= FILTER OUTPASSES (WARDEN'S HOSTEL ONLY) ================= */

  // Precedence: Range Search results > backend Status filter results > base monitor list.
  // Status/search/department/type/date filters still apply on top on the frontend.
  const sourceOutpasses = isRangeActive
    ? rangeResults
    : statusResults !== null
    ? statusResults
    : outpasses;

  const filteredOutpasses = useMemo(() => {
    const safeOutpasses = Array.isArray(sourceOutpasses) ? sourceOutpasses : [];

    return safeOutpasses.filter((pass) => {
      // 1. STRICT SINGLE HOSTEL MATCH (skip when showing backend range-search
      //    or status-filter results, which are already scoped server-side)
      const matchesHostel =
        isRangeActive ||
        statusResults !== null ||
        !assignedHostel ||
        pass.hostel?.toLowerCase().trim() === assignedHostel.toLowerCase().trim();

      if (!matchesHostel) return false;

      // 2. SEARCH FILTER
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        pass.name?.toLowerCase().includes(q) ||
        pass.roll_no?.toLowerCase().includes(q) ||
        pass.phone?.includes(q) ||
        pass.department?.toLowerCase().includes(q) ||
        pass.place_of_visit?.toLowerCase().includes(q) ||
        pass.purpose?.toLowerCase().includes(q);

      // 3. STATUS FILTER
      // When backend status results (or range search) are already active, the
      // list is pre-filtered server-side; only apply the frontend check as a
      // fallback for the plain monitor list.
      const matchesStatus =
        isRangeActive ||
        statusResults !== null ||
        statusFilter === "All" ||
        pass.outp_status === statusFilter;

      // 4. DEPARTMENT FILTER
      const matchesDepartment =
        departmentFilter === "All" || pass.department === departmentFilter;

      // 5. OUTPASS TYPE FILTER
      const matchesType =
        outpassTypeFilter === "All" ||
        (pass.outpass_type || "").toLowerCase() === outpassTypeFilter.toLowerCase();

      // 6. DATE FILTER
      const matchesDate =
        !selectedDate ||
        (pass.created_at && pass.created_at.startsWith(selectedDate)) ||
        (pass.departure_datetime && pass.departure_datetime.startsWith(selectedDate)) ||
        (pass.arrival_datetime && pass.arrival_datetime.startsWith(selectedDate));

      return (
        matchesSearch &&
        matchesStatus &&
        matchesDepartment &&
        matchesType &&
        matchesDate
      );
    });
  }, [
    sourceOutpasses,
    search,
    statusFilter,
    departmentFilter,
    outpassTypeFilter,
    assignedHostel,
    selectedDate,
    isRangeActive,
    statusResults,
  ]);

  /* ================= FILTER COMPLAINTS (WARDEN'S HOSTEL ONLY) ================= */

  const filteredComplaints = useMemo(() => {
    const safeComplaints = Array.isArray(complaints) ? complaints : [];

    return safeComplaints.filter((comp) => {
      const matchesHostel =
        !assignedHostel ||
        comp.hostel?.toLowerCase().trim() === assignedHostel.toLowerCase().trim();

      if (!matchesHostel) return false;

      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        comp.student_name?.toLowerCase().includes(q) ||
        comp.student_roll_no?.toLowerCase().includes(q) ||
        comp.title?.toLowerCase().includes(q) ||
        comp.description?.toLowerCase().includes(q);

      const matchesDate =
        !selectedDate ||
        (comp.date_created && comp.date_created.startsWith(selectedDate));

      return matchesSearch && matchesDate;
    });
  }, [complaints, search, assignedHostel, selectedDate]);

  /* ================= FILTER LATE LOGS (WARDEN'S HOSTEL + TIME WINDOW) ================= */

  const filteredLateLogs = useMemo(() => {
    const safeLateLogs = Array.isArray(lateLogs) ? lateLogs : [];

    const [fromH, fromM] = fromTime.split(":").map(Number);
    const startMinutes = (fromH || 0) * 60 + (fromM || 0);

    const [toH, toM] = toTime ? toTime.split(":").map(Number) : [23, 59];
    const endMinutes = (toH ?? 23) * 60 + (toM ?? 59);

    const lateFromOutpasses: LateLog[] = (Array.isArray(outpasses) ? outpasses : [])
      .filter((pass: Outpass) => {
        // Strict Hostel match
        const matchesHostel =
          !assignedHostel ||
          pass.hostel?.toLowerCase().trim() === assignedHostel.toLowerCase().trim();
        if (!matchesHostel || !pass.arrival_datetime) return false;

        const arrivalDate = new Date(pass.arrival_datetime);
        const totalMinutes = arrivalDate.getHours() * 60 + arrivalDate.getMinutes();

        const fallsInWindow = totalMinutes >= startMinutes && totalMinutes <= endMinutes;
        return fallsInWindow || pass.std_status === "Out";
      })
      .map((pass: Outpass) => ({
        id: pass.id,
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
    safeLateLogs.forEach((item) => {
      if (
        !assignedHostel ||
        item.hostel?.toLowerCase().trim() === assignedHostel.toLowerCase().trim()
      ) {
        mergedMap.set(item.id, item);
      }
    });
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

      const matchesDate =
        !selectedDate ||
        (log.arrival_datetime && log.arrival_datetime.startsWith(selectedDate)) ||
        (log.departure_datetime && log.departure_datetime.startsWith(selectedDate)) ||
        (log.created_at && log.created_at.startsWith(selectedDate));

      return matchesSearch && matchesDate;
    });
  }, [lateLogs, outpasses, search, assignedHostel, fromTime, toTime, selectedDate]);

  /* ================= DOWNLOAD PDF REPORT FOR WARDEN'S HOSTEL (LATE RETURNS) ================= */

  const downloadPDFReport = async () => {
    setDownloadingLateReport(true);
    // Yield one tick so the "Generating..." state actually paints before the
    // synchronous PDF-building work below runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      generateLateReturnsPDF();
    } finally {
      setDownloadingLateReport(false);
    }
  };

  const generateLateReturnsPDF = () => {
    const doc = new jsPDF("landscape");

    doc.setFontSize(16);
    doc.setTextColor(109, 15, 22);
    doc.text(`Late Returns Report - ${assignedHostel}`, 14, 15);

    doc.setFontSize(10);
    doc.setTextColor(100);
    const dateText = selectedDate || "All Dates";
    const rangeText = `${format12Hour(fromTime)} to ${toTime ? format12Hour(toTime) : "End of Day"}`;
    doc.text(`Hostel: ${assignedHostel} | Date: ${dateText} | Time Window: ${rangeText}`, 14, 22);

    const tableHeaders = [
      [
        "Roll No",
        "Student Name",
        "Department",
        "Destination",
        "Departure",
        "Expected Arrival",
        "Status",
      ],
    ];

    const tableRows = filteredLateLogs.map((item) => [
      item.roll_no || "-",
      item.name || "-",
      item.department || "-",
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

    const cleanHostelName = assignedHostel.replace(/\s+/g, "_");
    const fileDate = selectedDate || "All_Dates";
    doc.save(`Late_Returns_${cleanHostelName}_${fileDate}.pdf`);
  };

  /* ================= DOWNLOAD OUTPASS REPORT (CURRENTLY FILTERED LIST) ================= */
  // Covers the current monitor list, an active status filter, and an active
  // Range Search — filteredOutpasses always reflects whichever is on screen.

  const downloadOutpassReport = async () => {
    setDownloadingOutpassReport(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      generateOutpassReportPDF();
    } finally {
      setDownloadingOutpassReport(false);
    }
  };

  const generateOutpassReportPDF = () => {
    const doc = new jsPDF("landscape");

    doc.setFontSize(16);
    doc.setTextColor(109, 15, 22);
    doc.text(`Outpass Report - ${assignedHostel}`, 14, 15);

    doc.setFontSize(10);
    doc.setTextColor(100);
    const sourceLabel = isRangeActive
      ? "Range Search"
      : `Status: ${statusFilter}`;
    doc.text(
      `${sourceLabel} | Records: ${filteredOutpasses.length}`,
      14,
      22
    );

    const tableHeaders = [
      [
        "Student",
        "Roll No",
        "Department",
        "Destination",
        "Purpose",
        "Type",
        "Departure",
        "Arrival",
        "Status",
        "Remarks",
      ],
    ];

    const tableRows = filteredOutpasses.map((p) => [
      p.name || "-",
      p.roll_no || "-",
      p.department || "-",
      p.place_of_visit || "-",
      p.purpose || "-",
      p.outpass_type || "-",
      p.departure_datetime
        ? new Date(p.departure_datetime).toLocaleString("en-IN", {
            dateStyle: "short",
            timeStyle: "short",
          })
        : "-",
      p.arrival_datetime
        ? new Date(p.arrival_datetime).toLocaleString("en-IN", {
            dateStyle: "short",
            timeStyle: "short",
          })
        : "-",
      p.outp_status || "-",
      p.remarks && p.remarks.length
        ? p.remarks.map((r) => r.message).join(" | ")
        : "-",
    ]);

    autoTable(doc, {
      head: tableHeaders,
      body: tableRows,
      startY: 28,
      theme: "striped",
      headStyles: { fillColor: [109, 15, 22], textColor: 255 },
      styles: { fontSize: 7, cellPadding: 2 },
    });

    const cleanHostelName = assignedHostel.replace(/\s+/g, "_");
    const reportTag = isRangeActive ? "Range_Search" : statusFilter;
    doc.save(`Outpass_Report_${cleanHostelName}_${reportTag}.pdf`);
  };

  /* ================= PAGINATION CALCULATIONS ================= */

  const activeListLength =
    activeTab === "outpasses"
      ? filteredOutpasses.length
      : activeTab === "complaints"
      ? filteredComplaints.length
      : filteredLateLogs.length;

  const totalPages = Math.ceil(activeListLength / limit) || 1;

  // Only pulls the page back when it's now out of range (e.g. the last item
  // on page 3 was just approved/rejected out of the current filter) — never
  // forces a jump to page 1 just because data refreshed.
  useEffect(() => {
    setPage((p) => (p > totalPages ? totalPages : p));
  }, [totalPages]);

  const paginatedOutpasses = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredOutpasses.slice(start, start + limit);
  }, [filteredOutpasses, page, limit]);

  const paginatedComplaints = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredComplaints.slice(start, start + limit);
  }, [filteredComplaints, page, limit]);

  const paginatedLateLogs = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredLateLogs.slice(start, start + limit);
  }, [filteredLateLogs, page, limit]);

  const pendingIdsOnPage = useMemo(
    () =>
      paginatedOutpasses
        .filter((p) => p.outp_status === "Pending")
        .map((p) => p.id),
    [paginatedOutpasses]
  );

  const allPendingOnPageSelected =
    pendingIdsOnPage.length > 0 &&
    pendingIdsOnPage.every((id) => selectedIds.has(id));

  function togglePageSelection() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPendingOnPageSelected) {
        pendingIdsOnPage.forEach((id) => next.delete(id));
      } else {
        pendingIdsOnPage.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  const handleTabSwitch = (tab: "outpasses" | "complaints" | "lateLogs"  | "allotment") => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleFilterChange = (setter: any, val: any) => {
    setter(val);
    setPage(1);
  };

  /* ================= LOADING STATE ================= */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#6d0f16] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium text-sm">
            Loading Warden Dashboard...
          </p>
        </div>
      </div>
    );
  }

  /* ================= UI RENDER ================= */

  return (
    <div className="min-h-screen flex bg-[#f9fafb] font-sans text-gray-800">
      <WardenSidebar 
        activeTab={activeTab} 
        setActiveTab={handleTabSwitch} 
        assignedHostel={assignedHostel}
        logout={logout}
        onRoomAllocation={() => navigate('/allocation/admin')}
        onOutpassSettings={() => setIsOutpassSettingsModalOpen(true)}
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
              {activeTab === "lateLogs" ? "Late Returns" : activeTab}
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* DOWNLOAD OUTPASS REPORT BUTTON */}
            {activeTab === "outpasses" && (
              <button
                onClick={downloadOutpassReport}
                disabled={filteredOutpasses.length === 0 || downloadingOutpassReport}
                className="bg-[#5b0e0e] text-white hover:bg-[#741616] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={16} />
                {downloadingOutpassReport ? "Generating..." : "Download Outpass Report"}
              </button>
            )}

            {/* PDF DOWNLOAD BUTTON (LATE LOGS) */}
            {activeTab === "lateLogs" && (
              <button
                onClick={downloadPDFReport}
                disabled={filteredLateLogs.length === 0 || downloadingLateReport}
                className="bg-[#5b0e0e] text-white hover:bg-[#741616] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={16} />
                {downloadingLateReport ? "Generating..." : "Download PDF Report"}
              </button>
            )}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
        {activeTab === "allotment" && <AttendantsAllotment assignedHostel={assignedHostel} />}
        {activeTab !== "allotment" && (
          <>
        {/* ERROR NOTIFICATION */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 shadow-xs text-xs font-medium flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* STATUS FILTER BACKEND ERROR NOTIFICATION */}
        {statusError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 shadow-xs text-xs font-medium flex items-center gap-2">
            <span>⚠️</span>
            <span>{statusError}</span>
          </div>
        )}

        {/* BACKGROUND MONITOR REFRESH INDICATOR (non-blocking, keeps table/modals mounted) */}
        {activeTab === "outpasses" && monitorRefreshing && !loading && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-2xl px-4 py-2.5 shadow-xs text-xs font-semibold flex items-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin inline-block"></span>
            <span>Refreshing outpass list...</span>
          </div>
        )}

        {/* SEARCH & FILTERS */}
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-200/80 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search by name, roll no, phone, department, destination, or purpose..."
                value={search}
                onChange={(e) => handleFilterChange(setSearch, e.target.value)}
                className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 pl-10 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition"
              />
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <Search size={16} />
              </span>
              {search && (
                <button
                  onClick={() => handleFilterChange(setSearch, "")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 bg-gray-100 px-2 py-1 rounded-md"
                >
                  Clear
                </button>
              )}
            </div>

            {activeTab === "outpasses" && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    handleFilterChange(setStatusFilter, e.target.value)
                  }
                  disabled={statusLoading}
                  className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer disabled:opacity-60"
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                  <option value="All">All Statuses</option>
                </select>
                {statusLoading && (
                  <span className="text-xs text-gray-400 font-semibold">Filtering...</span>
                )}

                <select
                  value={departmentFilter}
                  onChange={(e) =>
                    handleFilterChange(setDepartmentFilter, e.target.value)
                  }
                  className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer"
                >
                  <option value="All">All Departments</option>
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <select
                  value={outpassTypeFilter}
                  onChange={(e) =>
                    handleFilterChange(setOutpassTypeFilter, e.target.value)
                  }
                  className="bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:bg-white focus:border-[#6d0f16] transition cursor-pointer"
                >
                  <option value="All">All Types</option>
                  <option value="Local">Local</option>
                  <option value="Outstation">Outstation</option>
                </select>
              </div>
            )}
          </div>

          {/* DATE & TIME RANGE CONTROLS FOR WARDEN */}
          <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                  📅 Select Date:
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

              {activeTab === "outpasses" && (
                <div className="flex flex-wrap items-center gap-2 bg-gray-50/80 p-2 border border-gray-200 rounded-2xl">
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                    🔎 Range Search:
                  </span>
                  <input
                    type="datetime-local"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className="bg-white border border-gray-200 text-xs font-semibold text-gray-700 rounded-xl px-2.5 py-1.5 outline-none focus:border-[#6d0f16] transition"
                  />
                  <span className="text-gray-400 font-bold text-xs">→</span>
                  <input
                    type="datetime-local"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className="bg-white border border-gray-200 text-xs font-semibold text-gray-700 rounded-xl px-2.5 py-1.5 outline-none focus:border-[#6d0f16] transition"
                  />
                  <button
                    onClick={handleRangeSearch}
                    disabled={rangeLoading}
                    className="bg-[#6d0f16] hover:bg-[#530b11] text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                  >
                    {rangeLoading ? "Searching..." : "Search"}
                  </button>
                  {isRangeActive && (
                    <button
                      onClick={clearRangeSearch}
                      className="text-xs text-red-600 font-semibold hover:underline cursor-pointer"
                    >
                      Clear Range
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 font-medium">
              Showing logs for <span className="font-bold text-[#6d0f16]">{assignedHostel}</span>:{" "}
              <span className="font-bold text-gray-700">{selectedDate || "All Dates"}</span>
            </p>
          </div>

          {rangeError && (
            <p className="text-xs text-red-600 font-semibold">{rangeError}</p>
          )}
        </div>

        {/* NAVIGATION TABS */}
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
            onClick={() => handleTabSwitch("lateLogs")}
            className={`px-6 py-3 rounded-2xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5 ${
              activeTab === "lateLogs"
                ? "bg-[#6d0f16] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span>⏰</span> Late Logs ({format12Hour(fromTime)} - {toTime ? format12Hour(toTime) : "End"}) ({filteredLateLogs.length})
          </button>
        </div>

        {/* BULK ACTION TOOLBAR */}
        {activeTab === "outpasses" && selectedIds.size > 0 && (
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-gray-600">
              {selectedIds.size} outpass{selectedIds.size > 1 ? "es" : ""} selected
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => openApproveModal({ type: "bulk" })}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow-xs cursor-pointer"
              >
                Approve Selected
              </button>
              <button
                onClick={() => openRejectModal({ type: "bulk" })}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow-xs cursor-pointer"
              >
                Reject Selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}

        {/* OUTPASSES TABLE */}
        {activeTab === "outpasses" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            {filteredOutpasses.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-medium">
                {statusLoading || monitorRefreshing
                  ? "Loading outpasses..."
                  : getOutpassEmptyMessage()}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-4 pl-6 w-8">
                        <input
                          type="checkbox"
                          checked={allPendingOnPageSelected}
                          onChange={togglePageSelection}
                          disabled={pendingIdsOnPage.length === 0}
                          className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </th>
                      <th className="p-4">Student</th>
                      <th className="p-4">Roll No</th>
                      <th className="p-4">Department</th>
                      <th className="p-4">Room</th>
                      <th className="p-4">Destination</th>
                      <th className="p-4">Purpose</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Departure</th>
                      <th className="p-4">Expected Return</th>
                      <th className="p-4">Parent Contact</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Emergency</th>
                      <th className="p-4">Created At</th>
                      <th className="p-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedOutpasses.map((p) => {
                      const status = getStatus(p);
                      const isPending = p.outp_status === "Pending";
                      return (
                        <tr
                          key={p.id}
                          className="hover:bg-gray-50/80 transition"
                        >
                          <td className="p-4 pl-6">
                            {isPending ? (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(p.id)}
                                onChange={() => toggleSelectOne(p.id)}
                                className="cursor-pointer"
                              />
                            ) : (
                              <span className="inline-block w-4" />
                            )}
                          </td>
                          <td className="p-4">
                            <h3 className="font-bold text-gray-900">
                              {p.name}
                            </h3>
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.roll_no || "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.department || "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.room || "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.place_of_visit || "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600 max-w-[160px] truncate">
                            {p.purpose || "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.outpass_type || "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.departure_datetime
                              ? new Date(p.departure_datetime).toLocaleString("en-IN", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.arrival_datetime
                              ? new Date(p.arrival_datetime).toLocaleString("en-IN", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "-"}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {p.parent_contact || "-"}
                          </td>
                          <td className="p-4">
                            <span
                              className={`px-3 py-1 rounded-full text-[11px] font-bold border ${status.className}`}
                            >
                              {status.label}
                            </span>
                          </td>
                          <td className="p-4">
                            {p.emergency ? (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold border bg-red-100 text-red-800 border-red-200/60">
                                🚨 Emergency
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">-</span>
                            )}
                          </td>
                          <td className="p-4 text-xs font-medium text-gray-600">
                            {formatDateTime(p.created_at)}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => openDetailsModal(p.id)}
                                className="px-3 py-1.5 rounded-lg border border-gray-300 text-[11px] font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                              >
                                View Details
                              </button>
                              {isPending && (
                                <>
                                  <button
                                    onClick={() =>
                                      openApproveModal({ type: "single", id: p.id })
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold transition cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() =>
                                      openRejectModal({ type: "single", id: p.id })
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold transition cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
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

        {/* COMPLAINTS TABLE */}
        {activeTab === "complaints" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            {filteredComplaints.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-medium">
                {getComplaintsEmptyMessage()}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-4 pl-6">Student</th>
                      <th className="p-4">Complaint</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedComplaints.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-gray-50/80 transition"
                      >
                        <td className="p-4 pl-6">
                          <div>
                            <h3 className="font-bold text-gray-900">
                              {c.student_name || "-"}
                            </h3>
                            <p className="text-xs text-gray-400">
                              {c.student_roll_no || "-"}
                            </p>
                          </div>
                        </td>
                        <td className="p-4 max-w-md">
                          <p className="font-semibold text-gray-800 text-xs">
                            {c.title || "Complaint"}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                            {c.description}
                          </p>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                              c.status?.toLowerCase() === "resolved"
                                ? "bg-green-100 text-green-800 border-green-200/60"
                                : "bg-amber-100 text-amber-800 border-amber-200/60"
                            }`}
                          >
                            {c.status || "Pending"}
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

        {/* LATE LOGS TABLE FOR WARDEN'S HOSTEL */}
        {activeTab === "lateLogs" && (
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200/80 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-[#6d0f16]">
                  Late Campus Entries ({assignedHostel})
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
              <div className="p-16 text-center text-gray-400 font-medium">
                {getLateLogsEmptyMessage()}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-400 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-4 pl-6">Student</th>
                      <th className="p-4">Destination</th>
                      <th className="p-4">Departure</th>
                      <th className="p-4">Expected Return</th>
                      <th className="p-4">Campus Status</th>
                      <th className="p-4">Late Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedLateLogs.map((log: LateLog) => (
                      <tr
                        key={log.id}
                        className="hover:bg-red-50/30 transition"
                      >
                        <td className="p-4 pl-6">
                          <div>
                            <h3 className="font-bold text-gray-900">
                              {log.name || "-"}
                            </h3>
                            <p className="text-xs text-gray-400">
                              {log.roll_no || "-"}
                            </p>
                          </div>
                        </td>

                        <td className="p-4 text-xs font-medium text-gray-600">
                          {log.place_of_visit || "-"}
                        </td>

                        <td className="p-4 text-xs text-gray-600 font-medium">
                          {log.departure_datetime
                            ? new Date(log.departure_datetime).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "-"}
                        </td>

                        <td className="p-4 text-xs text-gray-600 font-medium">
                          {log.arrival_datetime
                            ? new Date(log.arrival_datetime).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "-"}
                        </td>

                        <td className="p-4">
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

                        <td className="p-4">
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

        {/* PAGINATION CONTROLS */}
        {activeListLength > 0 && (
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-gray-500 font-medium">
              Showing page <span className="font-bold text-gray-800">{page}</span> of{" "}
              <span className="font-bold text-gray-800">{totalPages}</span> ({activeListLength} items for {assignedHostel})
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
      </main>

      {/* APPOINT ATTENDANT MODAL */}
      {isAppointModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 relative border border-gray-100 animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setIsAppointModalOpen(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-sm transition"
            >
              ✕
            </button>

            <h2 className="text-xl font-bold text-[#6d0f16] flex items-center gap-2">
              <span>👤</span> Appoint Hostel Attendant
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-5">
              Assign a new attendant to <strong>{assignedHostel}</strong>. If an
              attendant already exists for this hostel, the backend will update
              their details instead of creating a duplicate.
            </p>

            {appointMsg.text && (
              <div
                className={`p-3.5 rounded-xl text-xs font-semibold mb-4 border ${
                  appointMsg.type === "success"
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {appointMsg.text}
              </div>
            )}

            <form onSubmit={handleAppointAttendant} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">
                  Attendant Name
                </label>
                <input
                  type="text"
                  required
                  disabled={appointLoading}
                  placeholder="e.g. Ramesh Singh"
                  value={appointForm.name}
                  onChange={(e) =>
                    setAppointForm({ ...appointForm, name: e.target.value })
                  }
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition disabled:opacity-50"
                />
                {appointFieldErrors.name && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    {appointFieldErrors.name}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">
                  Email / Username
                </label>
                <input
                  type="email"
                  required
                  disabled={appointLoading}
                  placeholder="attendant@hostel.com"
                  value={appointForm.email}
                  onChange={(e) =>
                    setAppointForm({ ...appointForm, email: e.target.value })
                  }
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition disabled:opacity-50"
                />
                {appointFieldErrors.email && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    {appointFieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  required
                  disabled={appointLoading}
                  placeholder="10 digit phone number"
                  value={appointForm.phone}
                  onChange={(e) =>
                    setAppointForm({ ...appointForm, phone: e.target.value })
                  }
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition disabled:opacity-50"
                />
                {appointFieldErrors.phone && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    {appointFieldErrors.phone}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  disabled={appointLoading}
                  placeholder="Set a login password"
                  value={appointForm.password}
                  onChange={(e) =>
                    setAppointForm({ ...appointForm, password: e.target.value })
                  }
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition disabled:opacity-50"
                />
                {appointFieldErrors.password && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    {appointFieldErrors.password}
                  </p>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={appointLoading}
                  onClick={() => setIsAppointModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={appointLoading}
                  className="px-5 py-2.5 rounded-xl bg-[#6d0f16] hover:bg-[#530b11] text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {appointLoading ? "Appointing..." : "Appoint Attendant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OUTPASS SETTINGS MODAL */}
      {isOutpassSettingsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 relative border border-gray-100 animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => !outpassSettingsSaving && setIsOutpassSettingsModalOpen(false)}
              disabled={outpassSettingsSaving}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕
            </button>

            <h2 className="text-xl font-bold text-[#6d0f16] flex items-center gap-2">
              <span>⚙️</span> Outpass Settings
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-5">
              Configure outpass rules for <strong>{assignedHostel}</strong>
            </p>

            {outpassSettingsError && (
              <div className="p-3.5 rounded-xl text-xs font-semibold mb-4 border bg-red-50 border-red-200 text-red-700">
                {outpassSettingsError}
              </div>
            )}

            {outpassSettingsLoading ? (
              <div className="py-10 text-center">
                <div className="w-9 h-9 border-4 border-[#6d0f16] border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="mt-3 text-xs text-gray-500 font-medium">
                  Loading current settings...
                </p>
              </div>
            ) : (
              <form onSubmit={handleSaveOutpassSettings} className="space-y-5">
                {/* ---------------------------------------------------
                    Local Outpass Submission Deadline
                    --------------------------------------------------- */}
                <div className="bg-gray-50/60 border border-gray-200 rounded-2xl p-4 space-y-2">
                  <label className="block text-xs font-bold uppercase text-gray-600 tracking-wider">
                    Local Outpass Submission Deadline
                  </label>
                  <p className="text-xs text-gray-500">
                    Students cannot submit Local Outpass requests after the configured
                    time each day.
                  </p>
                  <input
                    type="time"
                    required
                    value={outpassCutoffTime}
                    disabled={outpassSettingsSaving}
                    onChange={(e) => setOutpassCutoffTime(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-gray-700 outline-none focus:border-[#6d0f16] transition disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <p className="text-[11px] text-gray-400 font-medium">
                    Example: 17:00 means students cannot create Local Outpass requests
                    after 5:00 PM.
                  </p>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={outpassSettingsSaving}
                    onClick={() => setIsOutpassSettingsModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={outpassSettingsSaving}
                    className="px-5 py-2.5 rounded-xl bg-[#6d0f16] hover:bg-[#530b11] text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {outpassSettingsSaving ? "Saving..." : "Save Settings"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {isDetailsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-6 relative border border-gray-100 animate-in fade-in zoom-in duration-200 max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => setIsDetailsOpen(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-sm transition"
            >
              ✕
            </button>

            <h2 className="text-xl font-bold text-[#6d0f16] flex items-center gap-2">
              <span>📄</span> Outpass Details
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-5">
              Full record for this outpass request
            </p>

            {detailsError && (
              <div className="p-3.5 rounded-xl text-xs font-semibold mb-4 border bg-red-50 border-red-200 text-red-700">
                {detailsError}
              </div>
            )}

            {detailsLoading ? (
              <div className="py-10 text-center">
                <div className="w-9 h-9 border-4 border-[#6d0f16] border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="mt-3 text-xs text-gray-500 font-medium">
                  Loading details...
                </p>
              </div>
            ) : detailsData ? (
              <div className="space-y-5">
                <div className="bg-gray-50/60 border border-gray-200 rounded-2xl p-4">
                  <h3 className="text-xs font-bold uppercase text-gray-600 tracking-wider mb-3">
                    Student Information
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-400 font-semibold">Name</p>
                      <p className="text-gray-800 font-bold">{detailsData.name || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Roll Number</p>
                      <p className="text-gray-800 font-bold">{detailsData.roll_no || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Department</p>
                      <p className="text-gray-800 font-bold">{detailsData.department || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Hostel</p>
                      <p className="text-gray-800 font-bold">{detailsData.hostel || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Room</p>
                      <p className="text-gray-800 font-bold">{detailsData.room || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Phone</p>
                      <p className="text-gray-800 font-bold">{detailsData.phone || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Email</p>
                      <p className="text-gray-800 font-bold">{detailsData.email || "-"}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50/60 border border-gray-200 rounded-2xl p-4">
                  <h3 className="text-xs font-bold uppercase text-gray-600 tracking-wider mb-3">
                    Outpass Information
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-400 font-semibold">Type</p>
                      <p className="text-gray-800 font-bold">{detailsData.outpass_type || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Destination</p>
                      <p className="text-gray-800 font-bold">{detailsData.place_of_visit || "-"}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-400 font-semibold">Purpose</p>
                      <p className="text-gray-800 font-bold">{detailsData.purpose || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Parent Contact</p>
                      <p className="text-gray-800 font-bold">{detailsData.parent_contact || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Status</p>
                      <p className="text-gray-800 font-bold">{detailsData.outp_status || "-"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Emergency</p>
                      <p className="text-gray-800 font-bold">
                        {detailsData.emergency ? "🚨 Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Departure</p>
                      <p className="text-gray-800 font-bold">{formatDateTime(detailsData.departure_datetime)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Arrival</p>
                      <p className="text-gray-800 font-bold">{formatDateTime(detailsData.arrival_datetime)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Created At</p>
                      <p className="text-gray-800 font-bold">{formatDateTime(detailsData.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-semibold">Approved At</p>
                      <p className="text-gray-800 font-bold">{formatDateTime(detailsData.approved_at)}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50/60 border border-gray-200 rounded-2xl p-4">
                  <h3 className="text-xs font-bold uppercase text-gray-600 tracking-wider mb-3">
                    Remarks
                  </h3>
                  {!detailsData.remarks || detailsData.remarks.length === 0 ? (
                    <p className="text-xs text-gray-400 font-medium">No remarks yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {[...detailsData.remarks]
                        .sort((a, b) => {
                          const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                          const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                          return tB - tA; // Newest first
                        })
                        .map((r, idx) => (
                          <div key={r.id || idx} className="border-l-2 border-[#6d0f16]/30 pl-3">
                            <div className="flex items-center justify-between flex-wrap gap-1">
                              <p className="text-xs font-bold text-gray-800">
                                {r.name || "-"}{" "}
                                <span className="text-gray-400 font-medium">({r.role || "-"})</span>
                              </p>
                              <p className="text-[11px] text-gray-400 font-medium">
                                {formatDateTime(r.timestamp)}
                              </p>
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">{r.message}</p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-6">No details available.</p>
            )}
          </div>
        </div>
      )}

      {/* APPROVE MODAL */}
      {isApproveOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 relative border border-gray-100 animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => !approveLoading && setIsApproveOpen(false)}
              disabled={approveLoading}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕
            </button>

            <h2 className="text-xl font-bold text-[#6d0f16] flex items-center gap-2">
              <span></span>{" "}
              {approveTarget?.type === "bulk"
                ? `Approve ${selectedIds.size} Outpass${selectedIds.size > 1 ? "es" : ""}`
                : "Approve Outpass"}
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-5">
              Add an optional remark before approving.
            </p>

            {approveError && (
              <div className="p-3.5 rounded-xl text-xs font-semibold mb-4 border bg-red-50 border-red-200 text-red-700">
                {approveError}
              </div>
            )}

            <form onSubmit={submitApprove} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">
                  Remark (optional)
                </label>
                <textarea
                  rows={3}
                  disabled={approveLoading}
                  placeholder="e.g. Approved. Please return on time."
                  value={approveRemark}
                  onChange={(e) => setApproveRemark(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition resize-none disabled:opacity-50"
                />
                {approveFieldErrors.remark && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    {approveFieldErrors.remark}
                  </p>
                )}
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={approveLoading}
                  onClick={() => setIsApproveOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approveLoading}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {approveLoading ? "Approving..." : "Confirm Approve"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {isRejectOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 relative border border-gray-100 animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => !rejectLoading && setIsRejectOpen(false)}
              disabled={rejectLoading}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕
            </button>

            <h2 className="text-xl font-bold text-[#6d0f16] flex items-center gap-2">
              <span>🚫</span>{" "}
              {rejectTarget?.type === "bulk"
                ? `Reject ${selectedIds.size} Outpass${selectedIds.size > 1 ? "es" : ""}`
                : "Reject Outpass"}
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-5">
              A remark is required to reject.
            </p>

            {rejectError && (
              <div className="p-3.5 rounded-xl text-xs font-semibold mb-4 border bg-red-50 border-red-200 text-red-700">
                {rejectError}
              </div>
            )}

            <form onSubmit={submitReject} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-500 mb-1">
                  Remark <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  disabled={rejectLoading}
                  placeholder="e.g. Parent verification failed."
                  value={rejectRemark}
                  onChange={(e) => setRejectRemark(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:bg-white focus:border-[#6d0f16] transition resize-none disabled:opacity-50"
                />
                {rejectFieldErrors.remark && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">
                    {rejectFieldErrors.remark}
                  </p>
                )}
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={rejectLoading}
                  onClick={() => setIsRejectOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejectLoading}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {rejectLoading ? "Rejecting..." : "Confirm Reject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION (shared/reusable) */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] px-5 py-3.5 rounded-2xl shadow-lg text-xs font-semibold border animate-in fade-in slide-in-from-bottom-2 duration-200 ${
            toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          {toast.text}
        </div>
      )}
      </div>
    </div>
  );
}