import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';

// 1. Define the TypeScript Interface
interface OutpassData {
  id: number;
  student_id: number;
  student_name: string;
  student_room: string;
  student_phone: string;
  department: string;
  reason: string;
  outpass_type: string;
  destination: string;
  date_from: string;
  date_to: string;
  hostel: string;
  room: string;
  status: string;
  is_exited: boolean;
  is_entered: boolean;
  exit_time?: string;
  enter_time?: string;
  date_created: string;
}

interface StudentHistory {
  profile: any;
  outpasses: OutpassData[];
}

function Warden() {
  const navigate = useNavigate();
  const userString = localStorage.getItem('user');
  const wardenUser = userString ? JSON.parse(userString) : { name: "Warden", role: "warden" };

  // State
  const [outpasses, setOutpasses] = useState<OutpassData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  
  // Filtering State
  const [selectedHostel, setSelectedHostel] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [studentHistory, setStudentHistory] = useState<StudentHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Fetch specific student history
  const fetchStudentHistory = async (studentId: number) => {
    setLoadingHistory(true);
    setIsModalOpen(true);
    try {
      const data = await apiFetch(`/api/students/${studentId}/history`);
      if (data.success) {
        setStudentHistory(data.data);
      } else {
        alert("Failed to load student history: " + data.message);
        setIsModalOpen(false);
      }
    } catch (err) {
      console.error(err);
      alert("Error loading student history.");
      setIsModalOpen(false);
    } finally {
      setLoadingHistory(false);
    }
  };

  // --- Fetch All Outpasses ---
  useEffect(() => {
    const fetchOutpasses = async () => {
      try {
        const data = await apiFetch('/api/outpasses/monitor');
        setOutpasses(data.outpasses);
      } catch (error) {
        console.error("Error fetching outpasses:", error);
        alert("Failed to load monitor data. Is your backend running?");
      } finally {
        setLoading(false);
      }
    };

    fetchOutpasses();
  }, []);

  // --- Helper to determine exact real-time status ---
  const getDisplayStatus = (pass: OutpassData) => {
    if (pass.is_entered) return { label: 'Completed', color: 'bg-gray-100 text-gray-700 border-gray-300' };
    if (pass.is_exited) return { label: 'Out of Campus', color: 'bg-orange-100 text-orange-800 border-orange-300' };
    if (pass.status === 'approved') return { label: 'Approved (Inside)', color: 'bg-blue-100 text-blue-800 border-blue-300' };
    if (pass.status === 'pending') return { label: 'Pending Approval', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
    return { label: pass.status, color: 'bg-red-100 text-red-800 border-red-300' }; 
  };

  // --- Filtering Logic ---
  const filteredOutpasses = outpasses.filter(pass => {
    const matchesHostel = selectedHostel === 'All' || pass.hostel === selectedHostel;
    
    const studentName = pass.student_name || "";
    const studentRoom = pass.student_room || "";
    const studentPhone = pass.student_phone || "";

    const matchesSearch = 
      studentName.toLowerCase().includes(searchQuery.toLowerCase()) || 
      studentRoom.toLowerCase().includes(searchQuery.toLowerCase()) ||
      studentPhone.includes(searchQuery);

    let matchesStatus = true;
    if (selectedStatus === 'Active') {
      matchesStatus = pass.status === 'approved' && !pass.is_entered; 
    } else if (selectedStatus === 'Pending') {
      matchesStatus = pass.status === 'pending';
    } else if (selectedStatus === 'Completed') {
      matchesStatus = pass.is_entered === true;
    }
      
    return matchesHostel && matchesSearch && matchesStatus; 
  });

   
  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };
  if (loading) {
    return <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center font-bold text-[#5b0e0e]">Loading Dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
      
      
      {/* 1. Primary Maroon Navbar */}
      <nav className="w-full bg-[#5b0e0e] text-white shadow-md px-6 py-4 flex justify-between items-center z-10 sticky top-0">
                <div className="flex items-center gap-3 justify-center ">
  <img
    src="/l.png"
    alt="nithlogo"
    width={60}
    height={60}
    className="object-contain"
  />

  <h1 className="text-2xl font-bold">
   warden
  </h1>
</div>
        <div className="flex items-center space-x-4">
          <div className="flex flex-col text-right">
            <span className="text-sm font-bold leading-tight">{wardenUser.name}</span>
            <span className="text-xs text-gray-300">Hostel Warden</span>
          </div>
          <div className="w-10 h-10 bg-[#741616] rounded-full flex items-center justify-center font-bold border-2 border-[#8a1a1a] shadow-sm uppercase">
            {wardenUser.name ? wardenUser.name.charAt(0) : 'W'}
          </div>
           <button
            onClick={handleLogout}
            className="bg-white text-[#5b0e0e] hover:bg-gray-100 px-5 py-2 rounded-md font-semibold shadow-sm transition-colors duration-200"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* 2. Advanced Search and Filter Controls */}
      <div className="w-full bg-white shadow-sm border-b border-gray-200 sticky top-[72px] z-0">
        <div className="max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          
          <div className="w-full">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Filter by Hostel</label>
            <select 
              value={selectedHostel}
              onChange={(e) => setSelectedHostel(e.target.value)}
              className="w-full border border-gray-300 p-3 rounded-md outline-none focus:border-[#5b0e0e] focus:ring-1 focus:ring-[#5b0e0e] bg-gray-50 text-gray-800 font-medium"
            >
              <option value="All">All Hostels</option>
              <option value="Hostel A">Hostel A</option>
              <option value="Hostel B">Hostel B</option>
            </select>
          </div>

          <div className="w-full">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Filter by Status</label>
            <select 
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full border border-gray-300 p-3 rounded-md outline-none focus:border-[#5b0e0e] focus:ring-1 focus:ring-[#5b0e0e] bg-gray-50 text-gray-800 font-medium"
            >
              <option value="All">All History</option>
              <option value="Pending">Pending Approval</option>
              <option value="Active">Currently Active (Approved / Out)</option>
              <option value="Completed">Completed / Returned</option>
            </select>
          </div>

          <div className="w-full">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Search Database</label>
            <input 
              type="text" 
              placeholder="Search Name, Roll No, or Phone..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-gray-300 p-3 rounded-md outline-none focus:border-[#5b0e0e] focus:ring-1 focus:ring-[#5b0e0e] bg-gray-50 text-gray-800"
            />
          </div>

        </div>
      </div>

      {/* 3. Main Content Area */}
      <div className="flex-1 w-full max-w-6xl mx-auto py-8 px-4 flex flex-col space-y-4">
        
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex justify-between items-center mb-2">
          <span className="text-sm font-bold text-gray-500 uppercase">Showing {filteredOutpasses.length} Records</span>
        </div>

        {filteredOutpasses.length > 0 ? (
          filteredOutpasses.map((pass) => {
            const displayStatus = getDisplayStatus(pass);
            
            // Safely parse dates to prevent React crashing
            const dateFrom = pass.date_from ? new Date(pass.date_from).toLocaleDateString() : 'N/A';
            const dateTo = pass.date_to ? new Date(pass.date_to).toLocaleDateString() : 'N/A';
            const dateCreated = pass.date_created ? new Date(pass.date_created).toLocaleString() : 'N/A';

            return (
              <div key={pass.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row justify-between items-start gap-6 hover:shadow-md transition-shadow">
                
                {/* Left Block */}
                <div className="md:w-1/3 border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 pr-0 md:pr-6">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 
                      className="text-xl font-bold text-[#5b0e0e] cursor-pointer hover:underline"
                      onClick={() => fetchStudentHistory(pass.student_id)}
                    >
                      {pass.student_name}
                    </h3>
                  </div>
                  
                  <div className="space-y-1 text-sm text-gray-600">
                    <p><span className="font-bold text-gray-800">Roll No:</span> {pass.student_room}</p>
                    <p><span className="font-bold text-gray-800">Hostel:</span> {pass.hostel}</p>
                    <p><span className="font-bold text-gray-800">Dept:</span> {pass.department}</p>
                    <p><span className="font-bold text-gray-800">Phone:</span> {pass.student_phone}</p>
                  </div>
                </div>

                {/* Middle Block */}
                <div className="md:w-1/3 flex-1">
                  <div className="flex gap-2 items-center mb-2">
                    <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded font-bold border border-gray-200 uppercase">
                      {pass.outpass_type}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded font-bold uppercase border ${displayStatus.color}`}>
                      {displayStatus.label}
                    </span>
                  </div>

                  <p className="text-gray-800 font-medium mb-1">
                    <span className="text-gray-500 text-xs uppercase tracking-wider block">Destination</span> 
                    {pass.destination}
                  </p>
                  
                  <p className="text-gray-600 text-sm mt-2 italic border-l-2 border-gray-200 pl-2">
                    "{pass.reason}"
                  </p>
                </div>

                {/* Right Block */}
                <div className="md:w-1/3 w-full bg-gray-50 p-4 rounded-lg border border-gray-100 text-sm">
                  <div className="grid grid-cols-2 gap-2 mb-3 pb-3 border-b border-gray-200">
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-gray-400">Date From</span>
                      <span className="font-semibold text-gray-700">{dateFrom}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-gray-400">Date To</span>
                      <span className="font-semibold text-gray-700">{dateTo}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-1 text-xs text-gray-500">
                    <p>Applied: <span className="font-medium text-gray-800">{dateCreated}</span></p>
                    {pass.exit_time && <p>Exited: <span className="font-medium text-orange-600">{new Date(pass.exit_time).toLocaleString()}</span></p>}
                    {pass.enter_time && <p>Entered: <span className="font-medium text-emerald-600">{new Date(pass.enter_time).toLocaleString()}</span></p>}
                  </div>
                </div>

              </div>
            );
          })
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center">
            <div className="text-5xl mb-4">📭</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">No records found</h3>
            <p className="text-gray-500">
              Try adjusting your filters or search query.
            </p>
          </div>
        )}

      </div>

      {/* Student History Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 bg-gray-50">
              <h2 className="text-2xl font-bold text-[#5b0e0e]">Student History</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-red-500 font-bold text-xl">
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {loadingHistory ? (
                <div className="text-center py-10 font-medium text-gray-500">Loading student details...</div>
              ) : studentHistory ? (
                <div className="space-y-8">
                  {/* Profile Section */}
                  <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Profile Information</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Name</span>
                        <span className="font-bold">{studentHistory.profile.name}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Roll No</span>
                        <span className="font-bold">{studentHistory.profile.roll_no}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Phone</span>
                        <span className="font-bold">{studentHistory.profile.phone || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Email</span>
                        <span className="font-bold break-words">{studentHistory.profile.email}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Hostel</span>
                        <span className="font-bold">{studentHistory.profile.hostel}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Room</span>
                        <span className="font-bold">{studentHistory.profile.room || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Department</span>
                        <span className="font-bold">{studentHistory.profile.department}</span>
                      </div>
                      <div>
                        <span className="block text-gray-500 text-xs uppercase">Degree</span>
                        <span className="font-bold">{studentHistory.profile.degree_type || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Outpasses Section */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Outpass History ({studentHistory.outpasses.length})</h3>
                    {studentHistory.outpasses.length > 0 ? (
                      <div className="space-y-3">
                        {studentHistory.outpasses.map((op: any) => (
                          <div key={op.id} className="border border-gray-200 rounded-lg p-4 bg-white flex flex-col md:flex-row justify-between items-start gap-4">
                            <div className="flex-1">
                              <div className="flex gap-2 items-center mb-1">
                                <span className="text-xs px-2 py-1 bg-gray-100 border border-gray-200 rounded font-bold uppercase text-gray-600">
                                  {op.outpass_type}
                                </span>
                                <span className={`text-xs px-2 py-1 rounded font-bold uppercase border ${
                                  op.outp_status === 'Approved' ? 'text-green-600 border-green-200 bg-green-50' :
                                  op.outp_status === 'Rejected' ? 'text-red-600 border-red-200 bg-red-50' :
                                  'text-yellow-600 border-yellow-200 bg-yellow-50'
                                }`}>
                                  {op.outp_status}
                                </span>
                                {op.is_emergency && <span className="text-xs px-2 py-1 bg-red-100 text-red-700 font-bold uppercase rounded border border-red-200">Emergency</span>}
                              </div>
                              <p className="text-sm text-gray-800"><span className="font-semibold text-gray-500">Destination:</span> {op.destination || op.place_of_visit}</p>
                              <p className="text-sm text-gray-600 italic">"{op.purpose || op.reason}"</p>
                            </div>
                            <div className="text-right text-xs text-gray-500 space-y-1 bg-gray-50 p-2 rounded border border-gray-100">
                              <p>Applied: <span className="font-medium text-gray-700">{new Date(op.created_at || op.date_created).toLocaleString()}</span></p>
                              <p>From: <span className="font-medium text-gray-700">{new Date(op.departure_datetime || op.date_from).toLocaleString()}</span></p>
                              <p>To: <span className="font-medium text-gray-700">{new Date(op.arrival_datetime || op.date_to).toLocaleString()}</span></p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No outpasses generated by this student yet.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            
            <div className="p-4 border-t border-gray-200 bg-gray-50 text-right">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-6 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Warden;
