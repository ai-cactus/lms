"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    Users,
    Plus,
    Search,
    CheckCircle,
    AlertCircle,
    UserX,
} from "lucide-react";

interface Worker {
    id: string;
    full_name: string;
    email: string;
    role: string;
    created_at: string;
    deactivated_at: string | null;
    supervisor?: {
        full_name: string;
    } | null;
    assignments?: {
        total: number;
        completed: number;
        overdue: number;
    };
}

export default function WorkersListPage() {
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [filteredWorkers, setFilteredWorkers] = useState<Worker[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("active");
    const [loading, setLoading] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    useEffect(() => {
        if (searchParams.get("added") === "true") {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 5000);
        }
        loadWorkers();
    }, []);

    useEffect(() => {
        filterWorkers();
    }, [workers, searchQuery, roleFilter, statusFilter]);

    const loadWorkers = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            // Get all workers with their supervisors
            const { data: workersData, error } = await supabase
                .from("users")
                .select(`
          id,
          full_name,
          email,
          role,
          created_at,
          deactivated_at,
          supervisor:supervisor_id(full_name)
        `)
                .eq("organization_id", userData?.organization_id)
                .eq("role", "worker")
                .order("created_at", { ascending: false });

            if (error) throw error;

            // Get assignment stats for each worker
            const workersWithStats = await Promise.all(
                (workersData || []).map(async (worker: any) => {
                    const { count: total } = await supabase
                        .from("course_assignments")
                        .select("*", { count: "exact", head: true })
                        .eq("worker_id", worker.id);

                    const { count: completed } = await supabase
                        .from("course_assignments")
                        .select("*", { count: "exact", head: true })
                        .eq("worker_id", worker.id)
                        .eq("status", "completed");

                    const { count: overdue } = await supabase
                        .from("course_assignments")
                        .select("*", { count: "exact", head: true })
                        .eq("worker_id", worker.id)
                        .eq("status", "overdue");

                    return {
                        ...worker,
                        supervisor: Array.isArray(worker.supervisor) ? worker.supervisor[0] : worker.supervisor,
                        assignments: {
                            total: total || 0,
                            completed: completed || 0,
                            overdue: overdue || 0,
                        },
                    };
                })
            );

            setWorkers(workersWithStats);
            setLoading(false);
        } catch (error) {
            console.error("Error loading workers:", error);
            setLoading(false);
        }
    };

    const filterWorkers = () => {
        let filtered = [...workers];

        // Status filter
        if (statusFilter === "active") {
            filtered = filtered.filter((w) => !w.deactivated_at);
        } else if (statusFilter === "inactive") {
            filtered = filtered.filter((w) => w.deactivated_at);
        }

        // Role filter
        if (roleFilter !== "all") {
            filtered = filtered.filter((w) => w.role === roleFilter);
        }

        // Search filter
        if (searchQuery) {
            filtered = filtered.filter((w) =>
                w.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                w.email.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        setFilteredWorkers(filtered);
    };

    const handleDeactivate = async (workerId: string) => {
        if (!confirm("Are you sure you want to deactivate this worker? They will no longer have access to the system.")) {
            return;
        }

        try {
            const { error } = await supabase
                .from("users")
                .update({ deactivated_at: new Date().toISOString() })
                .eq("id", workerId);

            if (error) throw error;

            loadWorkers();
        } catch (error: any) {
            alert("Failed to deactivate worker: " + error.message);
        }
    };

    const handleReactivate = async (workerId: string) => {
        try {
            const { error } = await supabase
                .from("users")
                .update({ deactivated_at: null })
                .eq("id", workerId);

            if (error) throw error;

            loadWorkers();
        } catch (error: any) {
            alert("Failed to reactivate worker: " + error.message);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading workers...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Staff Management</h1>
                        <p className="text-slate-600">Manage your organization&apos;s staff and training assignments</p>
                    </div>
                    <button
                        onClick={() => router.push("/admin/workers/add")}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        Add Worker
                    </button>
                </div>

                {/* Success Message */}
                {showSuccess && (
                    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <p className="text-sm text-green-700">Worker added successfully!</p>
                    </div>
                )}

                {/* Filters */}
                <div className="mb-6 bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by name or email..."
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                            />
                        </div>

                        {/* Status Filter */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>

                        {/* Role Filter */}
                        <select
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                        >
                            <option value="all">All Roles</option>
                            <option value="worker">Worker</option>
                            <option value="supervisor">Supervisor</option>
                        </select>
                    </div>
                </div>

                {/* Workers Table */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Worker
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Supervisor
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Courses
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredWorkers.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-600">
                                            <Users className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                                            <p>No workers found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredWorkers.map((worker) => (
                                        <tr key={worker.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-medium text-slate-900">{worker.full_name}</p>
                                                    <p className="text-sm text-slate-500">{worker.email}</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-slate-700">
                                                    {worker.supervisor?.full_name || "No supervisor"}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-4 text-sm">
                                                    <div className="flex items-center gap-1">
                                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                                        <span className="text-slate-700">
                                                            {worker.assignments?.completed || 0}/{worker.assignments?.total || 0}
                                                        </span>
                                                    </div>
                                                    {((worker.assignments?.overdue || 0) > 0) && (
                                                        <div className="flex items-center gap-1">
                                                            <AlertCircle className="w-4 h-4 text-red-600" />
                                                            <span className="text-red-600">{worker.assignments?.overdue} overdue</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {worker.deactivated_at ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                                                        <UserX className="w-3 h-3" />
                                                        Inactive
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                        <CheckCircle className="w-3 h-3" />
                                                        Active
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => router.push(`/admin/workers/${worker.id}`)}
                                                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                                                    >
                                                        View
                                                    </button>
                                                    {worker.deactivated_at ? (
                                                        <button
                                                            onClick={() => handleReactivate(worker.id)}
                                                            className="text-sm text-green-600 hover:text-green-700 font-medium"
                                                        >
                                                            Reactivate
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleDeactivate(worker.id)}
                                                            className="text-sm text-red-600 hover:text-red-700 font-medium"
                                                        >
                                                            Deactivate
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Stats Summary */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Total Workers</p>
                                <p className="text-2xl font-bold text-slate-900">{workers.filter((w) => !w.deactivated_at).length}</p>
                            </div>
                            <Users className="w-8 h-8 text-indigo-600" />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Completed Trainings</p>
                                <p className="text-2xl font-bold text-green-600">
                                    {workers.reduce((sum, w) => sum + (w.assignments?.completed || 0), 0)}
                                </p>
                            </div>
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Overdue Trainings</p>
                                <p className="text-2xl font-bold text-red-600">
                                    {workers.reduce((sum, w) => sum + (w.assignments?.overdue || 0), 0)}
                                </p>
                            </div>
                            <AlertCircle className="w-8 h-8 text-red-600" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
