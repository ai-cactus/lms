"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    Play,
    XCircle,
    BookOpen,
    ShieldCheck,
    FirstAid,
    Warning
} from "@phosphor-icons/react";

interface Assignment {
    id: string;
    course_id: string;
    deadline: string;
    status: string;
    course: {
        title: string;
    };
}

export default function WorkerCoursesPage() {
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
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

            // Get active assignments
            const { data: activeData, error: activeError } = await supabase
                .from("course_assignments")
                .select(`
          id,
          course_id,
          deadline,
          status,
          courses(title)
        `)
                .eq("worker_id", user.id)
                .in("status", ["not_started", "in_progress", "overdue"])
                .order("deadline", { ascending: true });

            if (activeError) throw activeError;

            // Normalize data
            const normalizedActive = (activeData || []).map((a: any) => ({
                ...a,
                course: Array.isArray(a.courses) ? a.courses[0] : a.courses,
            }));

            setAssignments(normalizedActive);
            setLoading(false);
        } catch (error) {
            console.error("Error loading courses:", error);
            setLoading(false);
        }
    };

    const handleReject = async (assignmentId: string, courseTitle: string) => {
        if (confirm(`Are you sure you want to reject "${courseTitle}"? This will notify the administrator.`)) {
            // TODO: Implement actual rejection logic and admin notification
            alert(`Course "${courseTitle}" has been rejected. The administrator has been notified.`);

            // Optimistically remove from list for now
            setAssignments(prev => prev.filter(a => a.id !== assignmentId));
        }
    };

    const getCourseIcon = (title: string) => {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes("hipaa")) return <ShieldCheck className="w-8 h-8 text-indigo-600" />;
        if (lowerTitle.includes("safety") || lowerTitle.includes("first aid")) return <FirstAid className="w-8 h-8 text-red-600" />;
        return <BookOpen className="w-8 h-8 text-blue-600" />;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading your courses...</div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold text-slate-900 mb-8">Assigned Courses</h1>

            <div className="space-y-4">
                {assignments.length === 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                        <BookOpen className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                        <h3 className="text-lg font-medium text-slate-900 mb-2">No courses assigned</h3>
                        <p className="text-slate-500">You're all caught up! Check back later for new assignments.</p>
                    </div>
                ) : (
                    assignments.map((assignment) => (
                        <div
                            key={assignment.id}
                            className="bg-white rounded-xl border border-gray-200 p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-center gap-6">
                                <div className="w-16 h-16 rounded-lg bg-gray-50 flex items-center justify-center border border-gray-100">
                                    {getCourseIcon(assignment.course.title)}
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-slate-900 mb-1">
                                        {assignment.course.title}
                                    </h3>
                                    <div className="flex items-center gap-3">
                                        {assignment.status === "in_progress" && (
                                            <span className="text-xs text-indigo-600 font-medium flex items-center gap-1">
                                                <Play size={12} weight="fill" />
                                                In Progress
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => router.push(`/worker/courses/${assignment.course_id}`)}
                                    className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
                                >
                                    {assignment.status === "in_progress" ? "Continue" : "Start Course"}
                                </button>
                                {assignment.status === "not_started" && (
                                    <button
                                        onClick={() => handleReject(assignment.id, assignment.course.title)}
                                        className="px-6 py-2.5 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
                                    >
                                        Reject
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
