"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    CheckCircle,
    Clock,
    AlertCircle,
    Award,
    Download,
    Play,
    ArrowRight,
} from "lucide-react";
interface Assignment {
    id: string;
    course_id: string;
    deadline: string;
    status: string;
    course: {
        title: string;
        lesson_notes: string;
    };
    completion?: {
        id: string;
        completed_at: string;
        quiz_score: number;
        admin_confirmation?: {
            confirmed: boolean;
            confirmed_at: string;
        };
    };
}

export default function WorkerDashboardPage() {
    const [activeTab, setActiveTab] = useState<"active" | "completed">("active");
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [completedAssignments, setCompletedAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [workerName, setWorkerName] = useState("");
    const [stats, setStats] = useState({
        totalAssigned: 0,
        completed: 0,
        overdue: 0,
    });
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get worker profile and check role
            const { data: workerData, error: profileError } = await supabase
                .from("users")
                .select("full_name, role")
                .eq("id", user.id)
                .single();

            if (profileError) {
                console.error("Error loading user profile:", profileError);
                throw new Error("Could not load user profile");
            }

            if (!workerData) {
                console.error("User profile not found");
                router.push("/login");
                return;
            }

            // Redirect admins to their dashboard
            if (workerData.role === "admin") {
                console.log("Admin user accessing worker dashboard - redirecting");
                router.push("/admin/dashboard");
                return;
            }

            // Ensure user is actually a worker
            if (workerData.role !== "worker") {
                console.error("User role is not worker:", workerData.role);
                router.push("/login");
                return;
            }

            setWorkerName(workerData.full_name);

            const { data: basicData, error: basicError } = await supabase
                .from("course_assignments")
                .select("id, status")
                .eq("worker_id", user.id)
                .limit(1);

            if (basicError) {
                console.error("Error checking basic access:", basicError);
                throw basicError;
            }

            // Get active assignments
            const { data: activeData, error: activeError } = await supabase
                .from("course_assignments")
                .select(`
          id,
          course_id,
          deadline,
          status,
          course:courses(title, lesson_notes)
        `)
                .eq("worker_id", user.id)
                .in("status", ["not_started", "in_progress", "overdue"])
                .order("deadline", { ascending: true });

            if (activeError) {
                console.error("Error fetching active assignments:", activeError);
                throw activeError;
            }

            // Get completed assignments with completions
            const { data: completedData, error: completedError } = await supabase
                .from("course_assignments")
                .select(`
          id,
          course_id,
          deadline,
          status,
          course:courses(title, lesson_notes),
          completion:course_completions(
            id,
            completed_at,
            quiz_score,
            admin_confirmation:admin_confirmations(confirmed, confirmed_at)
          )
        `)
                .eq("worker_id", user.id)
                .in("status", ["pending_confirmation", "completed"])
                .order("deadline", { ascending: false });

            if (completedError) {
                console.error("Error fetching completed assignments:", completedError);
                throw completedError;
            }

            // Normalize data - convert arrays to single objects
            const normalizedActive = (activeData || []).map((a: any) => ({
                ...a,
                course: Array.isArray(a.course) ? a.course[0] : a.course,
            }));

            const normalizedCompleted = (completedData || []).map((a: any) => ({
                ...a,
                course: Array.isArray(a.course) ? a.course[0] : a.course,
                completion: Array.isArray(a.completion) ? a.completion[0] : a.completion,
            }));

            // Calculate stats
            const now = new Date();
            const overdueCount = normalizedActive.filter((a: any) =>
                new Date(a.deadline) < now && a.status !== "completed"
            ).length;

            setAssignments(normalizedActive);
            setCompletedAssignments(normalizedCompleted);
            setStats({
                totalAssigned: normalizedActive.length + normalizedCompleted.length,
                completed: normalizedCompleted.length,
                overdue: overdueCount,
            });
            setLoading(false);
        } catch (error: any) {
            console.error("Error loading dashboard:", error);
            console.error("Error details:", {
                message: error?.message,
                code: error?.code,
                details: error?.details,
                hint: error?.hint,
            });
            setLoading(false);
        }
    };

    const getStatusColor = (assignment: Assignment) => {
        const deadline = new Date(assignment.deadline);
        const now = new Date();
        const daysUntilDue = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (deadline < now) return "red"; // Overdue
        if (daysUntilDue <= 3) return "yellow"; // Due soon
        return "green"; // On track
    };

    const getStatusBadge = (assignment: Assignment) => {
        const color = getStatusColor(assignment);
        const deadline = new Date(assignment.deadline);
        const now = new Date();
        const daysUntilDue = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (deadline < now) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                    <AlertCircle className="w-3 h-3" />
                    Overdue
                </span>
            );
        }

        if (daysUntilDue <= 3) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">
                    <Clock className="w-3 h-3" />
                    Due in {daysUntilDue} {daysUntilDue === 1 ? "day" : "days"}
                </span>
            );
        }

        return (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                <CheckCircle className="w-3 h-3" />
                On Track
            </span>
        );
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading your trainings...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Welcome back, {workerName}!
                    </h1>
                    <p className="text-slate-600">Track your training progress and complete your assigned courses</p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Total Assigned</p>
                                <p className="text-2xl font-bold text-slate-900">{stats.totalAssigned}</p>
                            </div>
                            <BookOpen className="w-8 h-8 text-indigo-600" />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Completed</p>
                                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
                            </div>
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Overdue</p>
                                <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
                            </div>
                            <AlertCircle className="w-8 h-8 text-red-600" />
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="mb-6 border-b border-gray-200">
                    <div className="flex gap-4">
                        <button
                            onClick={() => setActiveTab("active")}
                            className={`pb-3 px-1 font-medium transition-colors ${activeTab === "active"
                                ? "text-indigo-600 border-b-2 border-indigo-600"
                                : "text-slate-600 hover:text-slate-900"
                                }`}
                        >
                            Active Trainings ({assignments.length})
                        </button>
                        <button
                            onClick={() => setActiveTab("completed")}
                            className={`pb-3 px-1 font-medium transition-colors ${activeTab === "completed"
                                ? "text-indigo-600 border-b-2 border-indigo-600"
                                : "text-slate-600 hover:text-slate-900"
                                }`}
                        >
                            Completed ({completedAssignments.length})
                        </button>
                    </div>
                </div>

                {/* Content */}
                {activeTab === "active" ? (
                    /* Active Trainings */
                    <div className="space-y-4">
                        {assignments.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
                                <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
                                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                    All caught up!
                                </h3>
                                <p className="text-slate-600">
                                    You have no active training assignments at this time.
                                </p>
                            </div>
                        ) : (
                            assignments.map((assignment: any) => (
                                <div
                                    key={assignment.id}
                                    className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                                {assignment.course.title}
                                            </h3>
                                            <div className="flex items-center gap-4 text-sm text-slate-600">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="w-4 h-4" />
                                                    Due: {formatDate(assignment.deadline)}
                                                </div>
                                            </div>
                                        </div>
                                        {getStatusBadge(assignment)}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-slate-600">
                                            {assignment.status === "in_progress" ? (
                                                <span className="flex items-center gap-1">
                                                    <Play className="w-4 h-4" />
                                                    In Progress
                                                </span>
                                            ) : (
                                                <span>Not Started</span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => router.push(`/worker/training/${assignment.id}`)}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                                        >
                                            {assignment.status === "in_progress" ? "Continue" : "Start Training"}
                                            <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                ) : (
                    /* Completed Trainings */
                    <div className="space-y-4">
                        {completedAssignments.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
                                <Award className="w-16 h-16 mx-auto mb-4 text-slate-400" />
                                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                    No completed trainings yet
                                </h3>
                                <p className="text-slate-600">
                                    Complete your active trainings to see them here.
                                </p>
                            </div>
                        ) : (
                            completedAssignments.map((assignment: any) => {
                                const completion = Array.isArray(assignment.completion)
                                    ? assignment.completion[0]
                                    : assignment.completion;
                                const isConfirmed = completion?.admin_confirmation?.confirmed;

                                return (
                                    <div
                                        key={assignment.id}
                                        className="bg-white rounded-xl shadow-lg border border-gray-200 p-6"
                                    >
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex-1">
                                                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                                    {assignment.course.title}
                                                </h3>
                                                <div className="flex items-center gap-4 text-sm text-slate-600">
                                                    <div className="flex items-center gap-1">
                                                        <CheckCircle className="w-4 h-4" />
                                                        Completed: {completion ? formatDate(completion.completed_at) : "N/A"}
                                                    </div>
                                                    {completion && (
                                                        <div className="flex items-center gap-1">
                                                            <Award className="w-4 h-4" />
                                                            Score: {completion.quiz_score}%
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {isConfirmed ? (
                                                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded">
                                                    <CheckCircle className="w-4 h-4" />
                                                    Confirmed
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 text-sm font-medium rounded">
                                                    <Clock className="w-4 h-4" />
                                                    Pending Confirmation
                                                </span>
                                            )}
                                        </div>

                                        {isConfirmed && (
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => {
                                                        // TODO: Implement certificate download
                                                        alert("Certificate download coming soon!");
                                                    }}
                                                    className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg font-medium hover:bg-indigo-50 transition-colors flex items-center gap-2"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    Download Certificate
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
