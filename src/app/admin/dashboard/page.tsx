"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    Users,
    TrendingUp,
    AlertCircle,
    Clock,
    CheckCircle,
    Plus,
    Bell
} from "lucide-react";

export default function AdminDashboard() {
    const [stats, setStats] = useState({
        totalCourses: 0,
        totalWorkers: 0,
        overdueTrainings: 0,
        pendingConfirmations: 0,
        complianceRate: 0,
    });
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadDashboardStats();
    }, []);

    const loadDashboardStats = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) return;

            // Get total published courses
            const { count: coursesCount } = await supabase
                .from("courses")
                .select("*", { count: "exact", head: true })
                .eq("organization_id", userData.organization_id)
                .not("published_at", "is", null);

            // Get total workers
            const { count: workersCount } = await supabase
                .from("users")
                .select("*", { count: "exact", head: true })
                .eq("organization_id", userData.organization_id)
                .eq("role", "worker")
                .is("deactivated_at", null);

            // Get overdue trainings
            const { count: overdueCount } = await supabase
                .from("course_assignments")
                .select("*", { count: "exact", head: true })
                .eq("status", "overdue");

            // Get pending confirmations
            const { data: pendingCompletions } = await supabase
                .from("course_completions")
                .select("id")
                .is("supervisor_confirmations.id", null);

            // Calculate compliance rate
            const { count: completedCount } = await supabase
                .from("course_assignments")
                .select("*", { count: "exact", head: true })
                .eq("status", "completed");

            const { count: totalAssignments } = await supabase
                .from("course_assignments")
                .select("*", { count: "exact", head: true });

            const complianceRate = totalAssignments
                ? Math.round(((completedCount || 0) / totalAssignments) * 100)
                : 0;

            setStats({
                totalCourses: coursesCount || 0,
                totalWorkers: workersCount || 0,
                overdueTrainings: overdueCount || 0,
                pendingConfirmations: pendingCompletions?.length || 0,
                complianceRate,
            });

            setLoading(false);
        } catch (error) {
            console.error("Error loading dashboard stats:", error);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading dashboard...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Compliance Dashboard</h1>
                            <p className="text-sm text-slate-600 mt-1">
                                Last Updated: {new Date().toLocaleString()}
                            </p>
                        </div>
                        <button
                            onClick={() => router.push("/admin/policies/upload")}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            Create Course
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Alert Banner */}
                {(stats.overdueTrainings > 0 || stats.pendingConfirmations > 0) && (
                    <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
                        <Bell className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="font-semibold text-yellow-900 mb-1">Action Required</h3>
                            <div className="text-sm text-yellow-800 space-y-1">
                                {stats.overdueTrainings > 0 && (
                                    <p>• {stats.overdueTrainings} overdue trainings need immediate attention</p>
                                )}
                                {stats.pendingConfirmations > 0 && (
                                    <p>• {stats.pendingConfirmations} confirmations pending from supervisors</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        title="Total Courses"
                        value={stats.totalCourses}
                        icon={<BookOpen className="w-6 h-6" />}
                        color="indigo"
                    />
                    <StatCard
                        title="Total Staff"
                        value={stats.totalWorkers}
                        icon={<Users className="w-6 h-6" />}
                        color="blue"
                    />
                    <StatCard
                        title="Compliance Rate"
                        value={`${stats.complianceRate}%`}
                        icon={<TrendingUp className="w-6 h-6" />}
                        color="green"
                    />
                    <StatCard
                        title="Overdue Trainings"
                        value={stats.overdueTrainings}
                        icon={<AlertCircle className="w-6 h-6" />}
                        color={stats.overdueTrainings > 0 ? "red" : "gray"}
                    />
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Overdue Trainings Card */}
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">Overdue Trainings</h2>
                            <Clock className="w-5 h-5 text-slate-400" />
                        </div>
                        {stats.overdueTrainings === 0 ? (
                            <div className="text-center py-8">
                                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
                                <p className="text-slate-600">No overdue trainings. All staff on track!</p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-3xl font-bold text-red-600 mb-2">{stats.overdueTrainings}</p>
                                <p className="text-sm text-slate-600 mb-4">trainings need immediate attention</p>
                                <button
                                    onClick={() => router.push("/admin/trainings/overdue")}
                                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                    View All Overdue →
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Pending Confirmations Card */}
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">Pending Confirmations</h2>
                            <AlertCircle className="w-5 h-5 text-slate-400" />
                        </div>
                        {stats.pendingConfirmations === 0 ? (
                            <div className="text-center py-8">
                                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
                                <p className="text-slate-600">No pending confirmations. All verified!</p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-3xl font-bold text-yellow-600 mb-2">{stats.pendingConfirmations}</p>
                                <p className="text-sm text-slate-600 mb-4">completions awaiting supervisor confirmation</p>
                                <button
                                    onClick={() => router.push("/admin/confirmations/pending")}
                                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                    View All Pending →
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">Quick Actions</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button
                            onClick={() => router.push("/admin/policies/upload")}
                            className="p-4 border border-gray-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition-colors text-left"
                        >
                            <Plus className="w-6 h-6 text-indigo-600 mb-2" />
                            <h3 className="font-semibold text-slate-900">Upload Policy</h3>
                            <p className="text-sm text-slate-600">Create a new training course</p>
                        </button>
                        <button
                            onClick={() => router.push("/admin/workers/add")}
                            className="p-4 border border-gray-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition-colors text-left"
                        >
                            <Users className="w-6 h-6 text-indigo-600 mb-2" />
                            <h3 className="font-semibold text-slate-900">Add Workers</h3>
                            <p className="text-sm text-slate-600">Invite new staff members</p>
                        </button>
                        <button
                            onClick={() => router.push("/admin/reports")}
                            className="p-4 border border-gray-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition-colors text-left"
                        >
                            <BookOpen className="w-6 h-6 text-indigo-600 mb-2" />
                            <h3 className="font-semibold text-slate-900">Export Reports</h3>
                            <p className="text-sm text-slate-600">Download accreditation pack</p>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, color }: any) {
    const colorClasses = {
        indigo: "bg-indigo-100 text-indigo-600",
        blue: "bg-blue-100 text-blue-600",
        green: "bg-green-100 text-green-600",
        red: "bg-red-100 text-red-600",
        gray: "bg-gray-100 text-gray-600",
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-600">{title}</h3>
                <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
            </div>
            <p className="text-3xl font-bold text-slate-900">{value}</p>
        </div>
    );
}
