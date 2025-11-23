"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    Users,
    CheckCircle,
} from "lucide-react";
import { PerformanceChart, CoverageChart } from "@/components/admin/DashboardCharts";

export default function AdminDashboard() {
    const [stats, setStats] = useState({
        totalCourses: 0,
        totalWorkers: 0,
        averageGrade: 0,
        coverageData: {
            completed: 0,
            inProgress: 0,
            notStarted: 0,
        },
        performanceData: [] as number[],
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

            // Get all worker IDs in the organization for filtering
            const { data: workers } = await supabase
                .from("users")
                .select("id")
                .eq("organization_id", userData.organization_id)
                .eq("role", "worker");

            const workerIds = workers?.map(w => w.id) || [];

            // Calculate real average grade from quiz attempts
            let averageGrade = 0;
            if (workerIds.length > 0) {
                const { data: quizAttempts } = await supabase
                    .from("quiz_attempts")
                    .select("score")
                    .eq("passed", true)
                    .in("worker_id", workerIds);

                if (quizAttempts && quizAttempts.length > 0) {
                    const totalScore = quizAttempts.reduce((sum, attempt) => sum + Number(attempt.score), 0);
                    averageGrade = Math.round(totalScore / quizAttempts.length);
                }
            }

            // Calculate training coverage percentages
            let completedCount = 0;
            let inProgressCount = 0;
            let notStartedCount = 0;
            let totalAssignments = 0;

            if (workerIds.length > 0) {
                const { data: assignments } = await supabase
                    .from("course_assignments")
                    .select("status")
                    .in("worker_id", workerIds);

                if (assignments && assignments.length > 0) {
                    totalAssignments = assignments.length;
                    completedCount = assignments.filter(a => a.status === "completed").length;
                    inProgressCount = assignments.filter(a => a.status === "in_progress").length;
                    notStartedCount = assignments.filter(a => a.status === "not_started").length;
                }
            }

            const completedPercentage = totalAssignments > 0 ? Math.round((completedCount / totalAssignments) * 100) : 0;
            const inProgressPercentage = totalAssignments > 0 ? Math.round((inProgressCount / totalAssignments) * 100) : 0;
            const notStartedPercentage = totalAssignments > 0 ? Math.round((notStartedCount / totalAssignments) * 100) : 0;

            // Get monthly performance data for the last 12 months
            const twelveMonthsAgo = new Date();
            twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

            // Group scores by month
            const monthlyScores = new Array(12).fill(0);
            const monthlyCounts = new Array(12).fill(0);

            if (workerIds.length > 0) {
                const { data: monthlyAttempts } = await supabase
                    .from("quiz_attempts")
                    .select("score, completed_at")
                    .gte("completed_at", twelveMonthsAgo.toISOString())
                    .in("worker_id", workerIds);

                if (monthlyAttempts) {
                    monthlyAttempts.forEach(attempt => {
                        const date = new Date(attempt.completed_at);
                        const monthsAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30));
                        const monthIndex = 11 - Math.min(monthsAgo, 11);
                        if (monthIndex >= 0 && monthIndex < 12) {
                            monthlyScores[monthIndex] += Number(attempt.score);
                            monthlyCounts[monthIndex]++;
                        }
                    });
                }
            }

            const performanceData = monthlyScores.map((total, index) =>
                monthlyCounts[index] > 0 ? Math.round(total / monthlyCounts[index]) : 0
            );

            setStats({
                totalCourses: coursesCount || 0,
                totalWorkers: workersCount || 0,
                averageGrade,
                coverageData: {
                    completed: completedPercentage,
                    inProgress: inProgressPercentage,
                    notStarted: notStartedPercentage,
                },
                performanceData,
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
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
                    <p className="text-slate-500 mt-1">Here is an overview of your courses</p>
                </div>
                <button
                    onClick={() => router.push("/admin/courses/create")}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                    <span className="text-xl">+</span>
                    Create Course
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Courses"
                    value={stats.totalCourses}
                    icon={<BookOpen className="w-8 h-8 text-white" />}
                    bgColor="bg-emerald-100"
                    iconBgColor="bg-emerald-500"
                    textColor="text-slate-900"
                />
                <StatCard
                    title="Total Staff Assigned"
                    value={stats.totalWorkers}
                    icon={<Users className="w-8 h-8 text-white" />}
                    bgColor="bg-indigo-100"
                    iconBgColor="bg-indigo-700"
                    textColor="text-slate-900"
                />
                <StatCard
                    title="Average Grade"
                    value={`${stats.averageGrade}%`}
                    icon={<CheckCircle className="w-8 h-8 text-white" />}
                    bgColor="bg-red-100"
                    iconBgColor="bg-red-600"
                    textColor="text-slate-900"
                />
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Performance Chart */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold text-slate-900">Performance of Learners</h2>
                        <button className="px-3 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200">
                            Monthly
                        </button>
                    </div>
                    <div className="h-[300px]">
                        <PerformanceChart data={stats.performanceData} />
                    </div>
                    <div className="mt-4">
                        <p className="text-xs text-slate-500 -rotate-90 absolute left-8 top-1/2 origin-left">Scores (%)</p>
                    </div>
                </div>

                {/* Training Coverage Chart */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-900 mb-6">Training Coverage</h2>
                    <div className="h-[200px] flex items-center justify-center mb-6">
                        <CoverageChart data={stats.coverageData} />
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-indigo-200"></span>
                                <span className="text-slate-500">% of staff who have completed required courses</span>
                            </div>
                            <span className="font-bold text-slate-900">{stats.coverageData.completed}%</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                                <span className="text-slate-500">% of staff currently enrolled (in progress)</span>
                            </div>
                            <span className="font-bold text-slate-900">{stats.coverageData.inProgress}%</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                <span className="text-slate-500">% of staff yet to begin any course</span>
                            </div>
                            <span className="font-bold text-slate-900">{stats.coverageData.notStarted}%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface StatCardProps {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    bgColor: string;
    iconBgColor: string;
    textColor: string;
}

function StatCard({ title, value, icon, bgColor, iconBgColor, textColor }: StatCardProps) {
    return (
        <div className={`${bgColor} rounded-2xl p-6 flex flex-col justify-between h-40`}>
            <div className={`w-12 h-12 ${iconBgColor} rounded-xl flex items-center justify-center mb-4`}>
                {icon}
            </div>
            <div>
                <h3 className="text-sm font-medium text-slate-600 mb-1">{title}</h3>
                <p className={`text-3xl font-bold ${textColor}`}>{value}</p>
            </div>
        </div>
    );
}

