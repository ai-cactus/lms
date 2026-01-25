"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Search, UserPlus, Upload, Trash2, MoreVertical, CheckCircle, XCircle, X, ChevronLeft, ChevronRight } from "lucide-react";
import ImportWorkersModal from "@/components/staff/ImportWorkersModal";
import { deleteWorker } from "@/app/actions/worker";
import Avatar from "@/components/ui/Avatar";

interface StaffMember {
    id: string;
    full_name: string;
    email: string;
    role: string;
    created_at: string;
}

export default function StaffDetailsPage() {
    const router = useRouter();
    const supabase = createClient();

    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [showImportModal, setShowImportModal] = useState(false);
    const [organizationId, setOrganizationId] = useState("");
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [workerToDelete, setWorkerToDelete] = useState<StaffMember | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    useEffect(() => {
        loadStaff();
    }, []);

    // Auto-dismiss alert after 5 seconds
    useEffect(() => {
        if (alertMessage) {
            const timer = setTimeout(() => {
                setAlertMessage(null);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [alertMessage]);

    const loadStaff = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            const { data: staffData } = await supabase
                .from("users")
                .select("id, full_name, email, role, created_at")
                .eq("organization_id", userData?.organization_id)
                .neq("role", "admin")
                .order("created_at", { ascending: false });

            setStaff(staffData || []);
            setOrganizationId(userData?.organization_id || "");
            setLoading(false);
        } catch (error) {
            console.error("Error loading staff:", error);
            setLoading(false);
        }
    };

    const handleDeleteWorker = async () => {
        if (!workerToDelete) return;

        try {
            const result = await deleteWorker(workerToDelete.id);

            if (!result.success) {
                throw new Error(result.error);
            }

            // Refresh staff list
            await loadStaff();
            setShowDeleteModal(false);
            setWorkerToDelete(null);

            // Show success message
            setAlertMessage({
                type: 'success',
                message: `Successfully removed ${workerToDelete.full_name} from your organization.`
            });
        } catch (error) {
            console.error("Error deleting worker:", error);
            setAlertMessage({
                type: 'error',
                message: `Failed to delete worker: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
            });
        }
    };

    const filteredStaff = searchQuery
        ? staff.filter(s =>
            s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.email.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : staff;

    const totalPages = Math.ceil(filteredStaff.length / itemsPerPage);
    const paginatedStaff = filteredStaff.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const getTimeAgo = (date: string) => {
        const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
        if (days === 0) return "Today";
        if (days === 1) return "1 day ago";
        return `${days} days ago`;
    };

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map(n => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    // Fixed height container layout
    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col font-sans -my-4 sm:-my-6 lg:-my-8 py-4 sm:py-6 lg:py-8 px-4 sm:px-0">
            <ImportWorkersModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                onImportComplete={() => loadStaff()}
                organizationId={organizationId}
            />

            {/* Header Section - Fixed */}
            <div className="flex-none px-0 sm:px-4 lg:px-0 mb-6">
                <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-4 sm:gap-0">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Staff Details</h1>
                        <p className="text-slate-600">Here is an overview of your staff details</p>
                    </div>
                    <div className="flex items-start gap-3">
                        <button
                            onClick={() => router.push('/admin/workers/add')}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <UserPlus className="w-4 h-4" />
                            Add New Worker
                        </button>
                    </div>
                </div>
            </div>

            {/* Table Container section - fills remaining space */}
            <div className="flex-1 min-h-0 min-w-0 bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col mx-0 sm:mx-4 lg:mx-0 overflow-hidden">
                {/* Search Bar - Fixed at top of table container */}
                <div className="flex-none p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder="Search for staff..."
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                            />
                        </div>
                    </div>
                </div>

                {/* Table - Scrolls Internally */}
                <div className="flex-1 overflow-auto min-h-0">
                    <table className="w-full relative border-separate border-spacing-0">
                        <thead className="bg-white">
                            <tr>
                                <th className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider shadow-sm">
                                    Name
                                </th>
                                <th className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider shadow-sm">
                                    Date Invited
                                </th>
                                <th className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider shadow-sm">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {paginatedStaff.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-6 py-12 text-center text-slate-600">
                                        No staff members found
                                    </td>
                                </tr>
                            ) : (
                                paginatedStaff.map((member) => (
                                    <tr
                                        key={member.id}
                                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                                        onClick={() => router.push(`/admin/staff/${member.id}`)}
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <Avatar
                                                    fallback={member.full_name}
                                                    size="md"
                                                />
                                                <div>
                                                    <p className="font-medium text-slate-900">{member.full_name}</p>
                                                    <p className="text-sm text-slate-500 capitalize">{member.role}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-sm text-slate-700">
                                                {getTimeAgo(member.created_at)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="relative">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuId(openMenuId === member.id ? null : member.id);
                                                    }}
                                                    className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
                                                >
                                                    <MoreVertical className="w-5 h-5" />
                                                </button>

                                                {openMenuId === member.id && (
                                                    <>
                                                        <div
                                                            className="fixed inset-0 z-10"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenMenuId(null);
                                                            }}
                                                        ></div>
                                                        <div className="absolute right-0 bottom-full mb-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setWorkerToDelete(member);
                                                                    setShowDeleteModal(true);
                                                                    setOpenMenuId(null);
                                                                }}
                                                                className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-lg transition-colors"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                                Remove Worker
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer - Fixed at bottom of container */}
                <div className="flex-none px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50 backdrop-blur-sm z-20">
                    <div className="text-sm text-slate-500">
                        Showing <span className="font-medium text-slate-700">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-slate-700">{Math.min(currentPage * itemsPerPage, filteredStaff.length)}</span> of <span className="font-medium text-slate-700">{filteredStaff.length}</span> entries
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="p-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed bg-white shadow-sm transition-all"
                            >
                                <ChevronLeft className="w-4 h-4 ml-0" />
                            </button>

                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let p = i + 1;
                                if (totalPages > 5) {
                                    if (currentPage > 3) {
                                        p = currentPage - 2 + i;
                                    }
                                    if (p > totalPages) return null;
                                }

                                return (
                                    <button
                                        key={p}
                                        onClick={() => setCurrentPage(p)}
                                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${currentPage === p
                                            ? "bg-blue-600 text-white shadow-sm"
                                            : "bg-white border border-gray-200 text-slate-600 hover:bg-gray-50"
                                            }`}
                                    >
                                        {p}
                                    </button>
                                );
                            }).filter(Boolean)}

                            <button
                                onClick={() => setCurrentPage(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="p-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed bg-white shadow-sm transition-all"
                            >
                                <ChevronRight className="w-4 h-4 mr-0" />
                            </button>
                        </div>
                    )}

                    {/* Per Page Select */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">Show</span>
                        <select
                            value={itemsPerPage}
                            onChange={(e) => {
                                setItemsPerPage(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500/20 outline-none cursor-pointer"
                        >
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                        </select>
                        <span className="text-sm text-slate-500">entries</span>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                                <Trash2 className="w-6 h-6 text-red-600" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900">Remove Worker</h3>
                        </div>
                        <p className="text-slate-600 mb-6">
                            Do you really want to remove <span className="font-semibold">{workerToDelete?.full_name}</span>? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setWorkerToDelete(null);
                                }}
                                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteWorker}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
                            >
                                Remove Worker
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Alert */}
            {alertMessage && (
                <div className="fixed top-4 right-4 z-50 max-w-md">
                    <div className={`rounded-lg shadow-lg border p-4 flex items-start gap-3 ${alertMessage.type === 'success'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                        }`}>
                        {alertMessage.type === 'success' ? (
                            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                        ) : (
                            <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                            <p className={`text-sm font-medium ${alertMessage.type === 'success' ? 'text-green-800' : 'text-red-800'
                                }`}>
                                {alertMessage.message}
                            </p>
                        </div>
                        <button
                            onClick={() => setAlertMessage(null)}
                            className={`text-gray-400 hover:text-gray-600 ${alertMessage.type === 'success' ? 'hover:text-green-600' : 'hover:text-red-600'
                                }`}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
