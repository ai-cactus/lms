"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    ArrowLeft,
    UserPlus,
    BookOpen,
    CheckCircle,
    XCircle,
    Clock,
    Search,
    Download,
    User,
} from "lucide-react";
import AssignRetakeModal from "@/components/staff/AssignRetakeModal";
import AssignCourseModal from "@/components/staff/AssignCourseModal";

interface StaffMember {
    id: string;
    full_name: string;
    email: string;
    role: string;
}

interface CourseAssignment {
    id: string;
    course_id: string;
    status: string;
    assigned_at: string;
    completed_at?: string;
    progress_percentage: number;
    course: {
        title: string;
        difficulty?: string;
    };
    completion?: {
        quiz_score: number;
        id: string;
    };
}

export default function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const supabase = createClient();

    const [staff, setStaff] = useState<StaffMember | null>(null);
    const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [showRetakeModal, setShowRetakeModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [stats, setStats] = useState({
        totalAssigned: 0,
        completed: 0,
        failed: 0,
        active: 0,
    });

    useEffect(() => {
        loadStaffProfile();
    }, [id]);

    const loadStaffProfile = async () => {
        try {
            const { data: staffData } = await supabase
                .from("users")
                .select("id, full_name, email, role")
                .eq("id", id)
                .single();

            console.log("Staff data:", staffData);
            setStaff(staffData);

            // Get all assignments for this worker
            const { data: assignmentsData, error: assignmentsError } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    course_id,
                    status,
                    assigned_at,
                    progress_percentage,
                    courses(title, objectives, pass_mark)
                `)
                .eq("worker_id", id)
                .order("assigned_at", { ascending: false });

            console.log("Assignments data:", assignmentsData);
            console.log("Assignments error:", assignmentsError);

            // Get all completions for this worker  
            const { data: completionsData, error: completionsError } = await supabase
                .from("course_completions")
                .select("id, course_id, quiz_score")
                .eq("worker_id", id);

            console.log("Completions data:", completionsData);
            console.log("Completions error:", completionsError);

            // Match completions to assignments
            const assignmentsWithCompletions = (assignmentsData || []).map((assignment: any) => {
                const completion = completionsData?.find(c => c.course_id === assignment.course_id);
                return {
                    ...assignment,
                    completion: completion || null,
                    progress_percentage: assignment.progress_percentage || 0,
                    course: {
                        title: assignment.courses?.title || "Unknown Course",
                        difficulty: (assignment.courses?.objectives as any)?.difficulty || "Beginner",
                        pass_mark: assignment.courses?.pass_mark || 80,
                    }
                };
            });

            console.log("Assignments with completions:", assignmentsWithCompletions);

            setAssignments(assignmentsWithCompletions as any);

            // Calculate stats
            const totalAssigned = assignmentsWithCompletions.length;
            const completed = assignmentsWithCompletions.filter((a: any) => a.status === "completed").length;
            const failed = assignmentsWithCompletions.filter((a: any) => {
                const passMark = a.course.pass_mark;
                return a.status === 'failed' || (a.completion && a.completion.quiz_score < passMark);
            }).length;
            const active = assignmentsWithCompletions.filter((a: any) =>
                a.status === "not_started" || a.status === "in_progress"
            ).length;

            console.log("Calculated stats:", { totalAssigned, completed, failed, active });

            setStats({ totalAssigned, completed, failed, active });
            setLoading(false);
        } catch (error) {
            console.error("Error loading staff profile:", error);
            setLoading(false);
        }
    };

    const filteredAssignments = searchQuery
        ? assignments.filter(a =>
            (a.course as any)?.title?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : assignments;

    const getProgressPercentage = (assignment: CourseAssignment) => {
        // Use actual progress_percentage from database
        return assignment.progress_percentage || 0;
    };

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map(n => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    const handleAssignRetake = async (assignment: CourseAssignment) => {
        try {
            // 1. Delete existing completion record to clear "failed" status
            const { error: deleteError } = await supabase
                .from("course_completions")
                .delete()
                .eq("worker_id", id)
                .eq("course_id", assignment.course_id);

            if (deleteError) throw deleteError;

            // 2. Reset assignment
            const deadline = new Date();
            deadline.setDate(deadline.getDate() + 30);

            const { error: updateError } = await supabase
                .from("course_assignments")
                .upsert({
                    course_id: assignment.course_id,
                    worker_id: id,
                    status: "not_started",
                    assigned_at: new Date().toISOString(),
                    deadline: deadline.toISOString(),
                    progress_percentage: 0,
                }, {
                    onConflict: 'course_id, worker_id'
                });

            if (updateError) throw updateError;

            // 3. Refresh
            loadStaffProfile();
        } catch (error) {
            console.error("Error assigning retake:", error);
            alert("Failed to assign retake");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!staff) return <div className="p-8 text-center">Staff member not found</div>;

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <AssignRetakeModal
                isOpen={showRetakeModal}
                onClose={() => setShowRetakeModal(false)}
                workerId={id}
                onAssignComplete={() => loadStaffProfile()}
            />
            <AssignCourseModal
                isOpen={showAssignModal}
                onClose={() => setShowAssignModal(false)}
                workerId={id}
                onAssignComplete={() => loadStaffProfile()}
            />

            <div className="max-w-7xl mx-auto">
                <button
                    onClick={() => router.push("/admin/staff")}
                    className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Go Back</span>
                    <span className="text-slate-400">/</span>
                    <span className="text-slate-400">Staff Details</span>
                    <span className="text-slate-400">/</span>
                    <span>Staff Profile</span>
                </button>

                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 mb-8">
                    <div className="flex items-start justify-between">
                        <div className="flex items-start gap-6">
                            <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-2xl font-bold">
                                {getInitials(staff.full_name)}
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 mb-1">{staff.full_name}</h1>
                                <p className="text-slate-600 flex items-center gap-2 mb-2">
                                    <User className="w-4 h-4" />
                                    {staff.email}
                                </p>
                                <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded">
                                    {staff.role}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowAssignModal(true)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                Assign Course
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                                <BookOpen className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-blue-700 mb-1">Total Courses Assigned</p>
                                <p className="text-2xl font-bold text-blue-900">{stats.totalAssigned}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-green-50 rounded-xl p-6 border border-green-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-green-700 mb-1">Courses Passed</p>
                                <p className="text-2xl font-bold text-green-900">{stats.completed}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-red-50 rounded-xl p-6 border border-red-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center">
                                <XCircle className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-red-700 mb-1">Failed / Retake Needed</p>
                                <p className="text-2xl font-bold text-red-900">{stats.failed}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-yellow-50 rounded-xl p-6 border border-yellow-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-yellow-600 rounded-lg flex items-center justify-center">
                                <Clock className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-yellow-700 mb-1">Active / Due Soon</p>
                                <p className="text-2xl font-bold text-yellow-900">{stats.active}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-slate-900">Courses</h2>
                            <div className="flex items-center gap-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search for courses..."
                                        className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                                    />
                                </div>
                                <button className="px-4 py-2 bg-white border border-gray-300 text-slate-900 rounded-lg font-medium hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm">
                                    <Download className="w-4 h-4" />
                                    Export
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Progress</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Quiz Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredAssignments.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-slate-600">
                                            No course assignments found
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAssignments.map((assignment) => {
                                        const completion = (assignment as any).completion;
                                        const passMark = (assignment.course as any).pass_mark || 80;
                                        // Check if passed based on score
                                        const passed = completion && completion.quiz_score >= passMark;
                                        // Check if failed (either status is failed OR completion exists but score < passMark)
                                        const failed = assignment.status === 'failed' || (completion && !passed);
                                        const completed = assignment.status === 'completed' || failed;

                                        return (
                                            <tr key={assignment.id} className="hover:bg-slate-50">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                                                            <BookOpen className="w-5 h-5 text-indigo-600" />
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-slate-900">{(assignment.course as any)?.title || "Unknown Course"}</p>
                                                            <p className="text-sm text-slate-500">{(assignment.course as any)?.difficulty || "Beginner"}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {completed ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                            Completed
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                            In Progress
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {completion ? (
                                                        passed ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                                <CheckCircle className="w-3 h-3" />
                                                                Pass
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                                <XCircle className="w-3 h-3" />
                                                                Failed
                                                            </span>
                                                        )
                                                    ) : failed ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                            <XCircle className="w-3 h-3" />
                                                            Failed
                                                        </span>
                                                    ) : (
                                                        <span className="text-sm text-slate-400">-</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {failed ? (
                                                        <button
                                                            onClick={() => handleAssignRetake(assignment)}
                                                            className="px-3 py-1 bg-white border border-red-200 text-red-600 rounded text-sm font-medium hover:bg-red-50 transition-colors"
                                                        >
                                                            Assign Retake
                                                        </button>
                                                    ) : passed ? (
                                                        <button
                                                            onClick={() => router.push(`/admin/courses/${assignment.course_id}/quiz-results/${completion.id}`)}
                                                            className="px-3 py-1 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors"
                                                        >
                                                            View Result
                                                        </button>
                                                    ) : (
                                                        <span className="text-sm text-slate-400">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
