"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    ArrowLeft,
    Mail,
    Calendar,
    CheckCircle,
    AlertCircle,
    BookOpen,
    Plus,
    X,
    Loader2
} from "lucide-react";

interface Worker {
    id: string;
    full_name: string;
    email: string;
    role: string;
    created_at: string;
    deactivated_at: string | null;
}

interface Assignment {
    id: string;
    status: string;
    deadline: string;
    courses: {
        id: string;
        title: string;
    };
}

interface Course {
    id: string;
    title: string;
}

export default function WorkerDetailsPage() {
    const [worker, setWorker] = useState<Worker | null>(null);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const [assigning, setAssigning] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [selectedCourseId, setSelectedCourseId] = useState("");
    const [dueDate, setDueDate] = useState("");

    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const workerId = params.id as string;

    useEffect(() => {
        loadWorkerData();
    }, [workerId]);

    const loadWorkerData = async () => {
        try {
            // Get worker details
            const { data: workerData, error: workerError } = await supabase
                .from("users")
                .select("*")
                .eq("id", workerId)
                .single();

            if (workerError) throw workerError;
            setWorker(workerData);

            // Get assignments
            const { data: assignmentsData, error: assignmentsError } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    status,
                    deadline,
                    courses!course_id (
                        id,
                        title
                    )
                `)
                .eq("worker_id", workerId)
                .order("created_at", { ascending: false });


            if (assignmentsError) throw assignmentsError;

            // Supabase returns the joined table as an array in some cases, fix the type
            const typedAssignments: Assignment[] = (assignmentsData || []).map((item: any) => ({
                ...item,
                courses: Array.isArray(item.courses) ? item.courses[0] : item.courses
            }));

            setAssignments(typedAssignments);

            // Get available courses (for assignment dropdown)
            // We want courses that belong to the same organization and are NOT already assigned
            const assignedCourseIds = typedAssignments.map(a => a.courses?.id).filter(Boolean);

            const { data: coursesData, error: coursesError } = await supabase
                .from("courses")
                .select("id, title")
                .eq("organization_id", workerData.organization_id)
                .not("published_at", "is", null);

            if (coursesError) throw coursesError;

            // Filter out already assigned courses
            const available = (coursesData || []).filter(c => !assignedCourseIds.includes(c.id));
            setAvailableCourses(available);

            setLoading(false);
        } catch (error) {
            console.error("Error loading worker data:", error);
            setLoading(false);
        }
    };

    const handleAssignCourse = async () => {
        if (!selectedCourseId || !dueDate) return;

        setAssigning(true);
        try {
            const { error } = await supabase
                .from("course_assignments")
                .insert({
                    worker_id: workerId,
                    course_id: selectedCourseId,
                    status: "not_started",
                    deadline: new Date(dueDate).toISOString(),
                });

            if (error) throw error;

            // Refresh data
            await loadWorkerData();
            setShowAssignModal(false);
            setSelectedCourseId("");
            setDueDate("");
        } catch (error) {
            console.error("Error assigning course:", error);
            alert("Failed to assign course");
        } finally {
            setAssigning(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading worker details...</div>
            </div>
        );
    }

    if (!worker) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-red-600">Worker not found</div>
            </div>
        );
    }

    const completedCount = assignments.filter(a => a.status === "completed").length;
    const overdueCount = assignments.filter(a => a.status === "overdue").length;

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.back()}
                        className="text-slate-500 hover:text-slate-700 flex items-center gap-2 mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Workers
                    </button>
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">{worker.full_name}</h1>
                            <div className="flex items-center gap-4 text-slate-600">
                                <div className="flex items-center gap-1">
                                    <Mail className="w-4 h-4" />
                                    <span>{worker.email}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>Joined {new Date(worker.created_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowAssignModal(true)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            Assign Course
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-slate-600">Total Assignments</h3>
                            <BookOpen className="w-5 h-5 text-indigo-600" />
                        </div>
                        <p className="text-3xl font-bold text-slate-900">{assignments.length}</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-slate-600">Completed</h3>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                        <p className="text-3xl font-bold text-green-600">{completedCount}</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-slate-600">Overdue</h3>
                            <AlertCircle className="w-5 h-5 text-red-600" />
                        </div>
                        <p className="text-3xl font-bold text-red-600">{overdueCount}</p>
                    </div>
                </div>

                {/* Assignments List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <h2 className="text-lg font-semibold text-slate-900">Course Assignments</h2>
                    </div>
                    <div className="divide-y divide-gray-200">
                        {assignments.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                No courses assigned yet.
                            </div>
                        ) : (
                            assignments.map((assignment) => (
                                <div key={assignment.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                    <div>
                                        <h3 className="font-medium text-slate-900 mb-1">{assignment.courses.title}</h3>
                                        <div className="flex items-center gap-4 text-sm text-slate-500">
                                            <span>Due: {new Date(assignment.deadline).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div>
                                        {assignment.status === "completed" && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                <CheckCircle className="w-3 h-3" />
                                                Completed
                                            </span>
                                        )}
                                        {assignment.status === "overdue" && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                <AlertCircle className="w-3 h-3" />
                                                Overdue
                                            </span>
                                        )}
                                        {assignment.status === "pending" && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                <Clock className="w-3 h-3" />
                                                In Progress
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Assign Course Modal */}
            {showAssignModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-900">Assign Course</h2>
                            <button
                                onClick={() => setShowAssignModal(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Select Course
                                </label>
                                <select
                                    value={selectedCourseId}
                                    onChange={(e) => setSelectedCourseId(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">Select a course...</option>
                                    {availableCourses.map((course) => (
                                        <option key={course.id} value={course.id}>
                                            {course.title}
                                        </option>
                                    ))}
                                </select>
                                {availableCourses.length === 0 && (
                                    <p className="text-xs text-amber-600 mt-1">
                                        No available courses to assign.
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Due Date
                                </label>
                                <input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    min={new Date().toISOString().split('T')[0]}
                                />
                            </div>

                            <button
                                onClick={handleAssignCourse}
                                disabled={!selectedCourseId || !dueDate || assigning}
                                className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mt-2"
                            >
                                {assigning ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Assigning...
                                    </>
                                ) : (
                                    "Assign Course"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Clock({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    );
}
