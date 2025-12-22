"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Search, UserPlus, Upload, Trash2, MoreVertical, CheckCircle, XCircle, X } from "lucide-react";
import ImportWorkersModal from "@/components/staff/ImportWorkersModal";
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
    const [alertMessage, setAlertMessage] = useState<{type: 'success' | 'error', message: string} | null>(null);

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
            const { error } = await supabase
                .from("users")
                .delete()
                .eq("id", workerToDelete.id);

            if (error) {
                console.error("Error deleting worker:", error);
                throw new Error(`Failed to delete worker: ${error.message}`);
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

    return (
        <div className="min-h-screen bg-white p-8">
            <ImportWorkersModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                onImportComplete={() => loadStaff()}
                organizationId={organizationId}
            />

            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between">
                    <div className="mb-8">
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
                
                

                <div className="bg-white rounded-xl shadow-lg border border-gray-200">
                    <div className="p-6 border-b border-gray-200">
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

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-white border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Date Invited
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">
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
                                            className="hover:bg-white cursor-pointer transition-colors"
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
                                                        className="text-slate-400 hover:text-slate-600 p-2"
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

                    <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <p className="text-sm text-slate-600">
                                Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                                {Math.min(currentPage * itemsPerPage, filteredStaff.length)} of{" "}
                                {filteredStaff.length} entries
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-slate-600">Show</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => {
                                        setItemsPerPage(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}
                                    className="px-3 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                >
                                    <option value={10}>10</option>
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                </select>
                                <span className="text-sm text-slate-600">entries</span>
                            </div>
                            {totalPages > 1 && (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="px-3 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                    >
                                        ‹
                                    </button>
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (currentPage <= 3) {
                                            pageNum = i + 1;
                                        } else if (currentPage >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = currentPage - 2 + i;
                                        }
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => setCurrentPage(pageNum)}
                                                className={`px-3 py-1 border rounded text-sm ${
                                                    currentPage === pageNum
                                                        ? "bg-blue-600 text-white border-blue-600"
                                                        : "border-gray-300 hover:bg-white"
                                                }`}
                                            >
                                                {pageNum}
                                            </button>
                                        );
                                    })}
                                    {totalPages > 5 && currentPage < totalPages - 2 && (
                                        <span className="px-2 text-slate-400">...</span>
                                    )}
                                    {totalPages > 5 && (
                                        <button
                                            onClick={() => setCurrentPage(totalPages)}
                                            className={`px-3 py-1 border rounded text-sm ${
                                                currentPage === totalPages
                                                    ? "bg-blue-600 text-white border-blue-600"
                                                    : "border-gray-300 hover:bg-white"
                                            }`}
                                        >
                                            {totalPages}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="px-3 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                    >
                                        ›
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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
                    <div className={`rounded-lg shadow-lg border p-4 flex items-start gap-3 ${
                        alertMessage.type === 'success' 
                            ? 'bg-green-50 border-green-200' 
                            : 'bg-red-50 border-red-200'
                    }`}>
                        {alertMessage.type === 'success' ? (
                            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                        ) : (
                            <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                            <p className={`text-sm font-medium ${
                                alertMessage.type === 'success' ? 'text-green-800' : 'text-red-800'
                            }`}>
                                {alertMessage.message}
                            </p>
                        </div>
                        <button
                            onClick={() => setAlertMessage(null)}
                            className={`text-gray-400 hover:text-gray-600 ${
                                alertMessage.type === 'success' ? 'hover:text-green-600' : 'hover:text-red-600'
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
