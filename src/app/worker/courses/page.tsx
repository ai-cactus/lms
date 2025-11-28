"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    CheckCircle,
    Clock,
    ArrowRight,
    XCircle,
    AlertCircle
} from "lucide-react";

interface Assignment {
    id: string;
    course_id: string;
    deadline: string;
    status: string;
    course: {
        title: string;
    };
    // completed_at removed as it doesn't exist
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

            // Get active assignments (including failed ones so they can see results)
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
                .in("status", ["not_started", "in_progress", "overdue", "failed"])
                .order("deadline", { ascending: true });

            if (activeError) throw activeError;

            // Get completed assignments
            const { data: completedData, error: completedError } = await supabase
                .from("course_assignments")
                .select(`
                  id,
                  course_id,
                  status,
                  courses(title),
                  deadline
                `)
                .eq("worker_id", user.id)
                .eq("status", "completed")
                .order("deadline", { ascending: false }); // Fallback to deadline for sorting

            if (completedError) throw completedError;

            // Normalize and merge data
            const normalizedActive = (activeData || []).map((item: any) => ({
                ...item,
                course: Array.isArray(item.courses) ? item.courses[0] : item.courses
            }));

            const normalizedCompleted = (completedData || []).map((item: any) => ({
                ...item,
                course: Array.isArray(item.courses) ? item.courses[0] : item.courses
            }));

            setAssignments([...normalizedActive, ...normalizedCompleted]);
        } catch (error) {
            console.error("Error loading courses:", error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusTags = (status: string) => {
        switch (status) {
            case "completed":
                return (
                    <div className="flex gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Completed
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Passed
                        </span>
                    </div>
                );
            case "failed":
                return (
                    <div className="flex gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Completed
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium flex items-center gap-1">
                            <XCircle className="w-3 h-3" />
                            Failed
                        </span>
                    </div>
                );
            case "in_progress":
                return (
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        In Progress
                    </span>
                );
            case "overdue":
                return (
                    <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Overdue
                    </span>
                );
            default: // not_started
                return (
                    <span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium flex items-center gap-1">
                        <BookOpen className="w-3 h-3" />
                        Not yet started
                    </span>
                );
        }
    };

    const renderActionButton = (assignment: Assignment) => {
        const { status, id } = assignment;

        if (status === "completed" || status === "failed") {
            return (
                <button
                    onClick={() => router.push(`/worker/quiz/${id}?view=results`)}
                    className="px-4 py-2 bg-white border border-gray-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                    View Results
                </button>
            );
        }

        if (status === "in_progress" || status === "overdue") {
            return (
                <button
                    onClick={() => router.push(`/worker/courses/${id}`)}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                </button>
            );
        }

        // not_started
        return (
            <button
                onClick={() => router.push(`/worker/courses/${id}`)}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
            >
                Start Course
                <ArrowRight className="w-4 h-4" />
            </button>
        );
    };

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">My Courses</h1>
                <p className="text-slate-600">Manage and track your assigned training courses.</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="divide-y divide-gray-100">
                    {assignments.length === 0 ? (
                        <div className="p-12 text-center text-slate-500">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <BookOpen className="w-8 h-8 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-slate-900 mb-1">No courses assigned</h3>
                            <p>You don't have any courses assigned to you yet.</p>
                        </div>
                    ) : (
                        assignments.map((assignment) => (
                            <div key={assignment.id} className="p-6 hover:bg-slate-50 transition-colors">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-start justify-between mb-2">
                                            <h3 className="text-lg font-bold text-slate-900">
                                                {assignment.course?.title || "Untitled Course"}
                                            </h3>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-4 text-sm mb-3">
                                            {getStatusTags(assignment.status)}

                                            {assignment.deadline && (
                                                <span className="text-slate-500 flex items-center gap-1">
                                                    <Clock className="w-4 h-4" />
                                                    {assignment.status === 'completed' || assignment.status === 'failed'
                                                        ? `Finished ${new Date(assignment.deadline).toLocaleDateString()}`
                                                        : `Due ${new Date(assignment.deadline).toLocaleDateString()}`
                                                    }
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {renderActionButton(assignment)}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
