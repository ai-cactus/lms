"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Search, UserPlus } from "lucide-react";
import InviteStaffModal from "@/components/staff/InviteStaffModal";

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
    const [showInviteModal, setShowInviteModal] = useState(false);
    const itemsPerPage = 10;

    useEffect(() => {
        loadStaff();
    }, []);

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
            setLoading(false);
        } catch (error) {
            console.error("Error loading staff:", error);
            setLoading(false);
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
        <div className="min-h-screen bg-slate-50 p-8">
            <InviteStaffModal
                isOpen={showInviteModal}
                onClose={() => setShowInviteModal(false)}
                onInviteComplete={() => loadStaff()}
            />

            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Staff Details</h1>
                    <p className="text-slate-600">Here is an overview of your staff details</p>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
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
                            <button
                                onClick={() => setShowInviteModal(true)}
                                className="ml-4 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                Assign
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-gray-200">
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
                                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                                            onClick={() => router.push(`/admin/staff/${member.id}`)}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold">
                                                        {getInitials(member.full_name)}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-slate-900">{member.full_name}</p>
                                                        <p className="text-sm text-slate-500">{member.role}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-slate-700">
                                                    {getTimeAgo(member.created_at)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    className="text-slate-400 hover:text-slate-600"
                                                >
                                                    ⋮
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                            <p className="text-sm text-slate-600">
                                Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                                {Math.min(currentPage * itemsPerPage, filteredStaff.length)} of{" "}
                                {filteredStaff.length} entries
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1 border border-gray-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                            className={`px-3 py-1 border rounded ${currentPage === pageNum
                                                    ? "bg-indigo-600 text-white border-indigo-600"
                                                    : "border-gray-300 hover:bg-slate-50"
                                                }`}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="px-3 py-1 border border-gray-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    ›
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
