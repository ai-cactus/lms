"use client";

import { useState, useEffect } from "react";
import { X, XCircle, CheckCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AssignRetakeModalProps {
    isOpen: boolean;
    onClose: () => void;
    workerId: string;
    onAssignComplete: () => void;
}

interface CompletedCourse {
    id: string;
    course_id: string;
    course_title: string;
    completed_at: string;
    quiz_score: number;
}

export default function AssignRetakeModal({ isOpen, onClose, workerId, onAssignComplete }: AssignRetakeModalProps) {
    const [completedCourses, setCompletedCourses] = useState<CompletedCourse[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        if (isOpen) {
            loadCompletedCourses();
        }
    }, [isOpen, workerId]);

    const loadCompletedCourses = async () => {
        setLoading(true);
        try {
            // 1. Fetch from course_completions (official completions with scores)
            const { data: completions } = await supabase
                .from("course_completions")
                .select(`
                    id,
                    course_id,
                    completed_at,
                    quiz_score,
                    course:courses(title)
                `)
                .eq("worker_id", workerId)
                .order("completed_at", { ascending: false });

            // 2. Fetch from course_assignments (to catch any that are marked completed but missing completion records)
            const { data: assignments } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    course_id,
                    updated_at,
                    progress_percentage,
                    course:courses(title)
                `)
                .eq("worker_id", workerId)
                .eq("status", "completed");

            // 3. Merge and deduplicate
            const coursesMap = new Map<string, CompletedCourse>();

            // Add completions first (they have more data)
            (completions || []).forEach((item: any) => {
                coursesMap.set(item.course_id, {
                    id: item.id,
                    course_id: item.course_id,
                    course_title: item.course?.title || "Unknown Course",
                    completed_at: item.completed_at,
                    quiz_score: item.quiz_score,
                });
            });

            // Add assignments if not already present
            (assignments || []).forEach((item: any) => {
                if (!coursesMap.has(item.course_id)) {
                    coursesMap.set(item.course_id, {
                        id: item.id,
                        course_id: item.course_id,
                        course_title: item.course?.title || "Unknown Course",
                        completed_at: item.updated_at, // Use updated_at as completion time
                        quiz_score: 100, // Assume 100% if marked completed without score (or could use progress)
                    });
                }
            });

            const courses = Array.from(coursesMap.values()).sort((a, b) =>
                new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
            );

            setCompletedCourses(courses);
        } catch (error) {
            console.error("Error loading completed courses:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAssignRetake = async () => {
        if (!selectedCourse) return;

        setAssigning(true);
        try {
            // Create a new assignment for retake
            const deadline = new Date();
            deadline.setDate(deadline.getDate() + 30);

            const { error } = await supabase
                .from("course_assignments")
                .upsert({
                    course_id: selectedCourse,
                    worker_id: workerId,
                    status: "not_started",
                    assigned_at: new Date().toISOString(),
                    deadline: deadline.toISOString(),
                    progress_percentage: 0,
                }, {
                    onConflict: 'course_id, worker_id'
                });

            if (error) throw error;

            onAssignComplete();
            onClose();
            setSelectedCourse("");
        } catch (error: any) {
            console.error("Error assigning retake:", error);
            alert(error.message || "Failed to assign retake");
        } finally {
            setAssigning(false);
        }
    };

    // Separate courses into failed and passed
    const failedCourses = completedCourses.filter(c => c.quiz_score < 70);
    const passedCourses = completedCourses.filter(c => c.quiz_score >= 70);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose}></div>

            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 bg-white">
                        <h2 className="text-xl font-bold text-slate-900">Assign Retake</h2>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                            <X className="w-5 h-5 text-slate-600" />
                        </button>
                    </div>

                    <div className="px-6 py-6">
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        ) : completedCourses.length === 0 ? (
                            <div className="text-center py-8 text-slate-600">
                                No completed courses found
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <p className="text-sm text-slate-600">
                                    Select a course to assign as a retake. Failed courses are prioritized at the top.
                                </p>

                                {/* Failed Courses Section */}
                                {failedCourses.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <XCircle className="w-5 h-5 text-red-600" />
                                            <h3 className="font-semibold text-slate-900">Failed Courses ({failedCourses.length})</h3>
                                        </div>
                                        <div className="space-y-2 mb-6">
                                            {failedCourses.map((course) => (
                                                <label
                                                    key={course.id}
                                                    className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${selectedCourse === course.course_id
                                                        ? "border-indigo-600 bg-indigo-50"
                                                        : "border-red-200 hover:border-red-300 bg-red-50"
                                                        }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="course"
                                                        value={course.course_id}
                                                        checked={selectedCourse === course.course_id}
                                                        onChange={(e) => setSelectedCourse(e.target.value)}
                                                        className="mt-1 w-4 h-4 text-indigo-600"
                                                    />
                                                    <div className="ml-3 flex-1">
                                                        <p className="font-medium text-slate-900">{course.course_title}</p>
                                                        <div className="flex items-center gap-3 mt-1">
                                                            <p className="text-sm text-slate-500">
                                                                Completed: {new Date(course.completed_at).toLocaleDateString()}
                                                            </p>
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                                <XCircle className="w-3 h-3" />
                                                                Failed: {course.quiz_score}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Passed Courses Section */}
                                {passedCourses.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                            <h3 className="font-semibold text-slate-900">Passed Courses ({passedCourses.length})</h3>
                                        </div>
                                        <div className="space-y-2">
                                            {passedCourses.map((course) => (
                                                <label
                                                    key={course.id}
                                                    className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${selectedCourse === course.course_id
                                                        ? "border-indigo-600 bg-indigo-50"
                                                        : "border-gray-200 hover:border-gray-300"
                                                        }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="course"
                                                        value={course.course_id}
                                                        checked={selectedCourse === course.course_id}
                                                        onChange={(e) => setSelectedCourse(e.target.value)}
                                                        className="mt-1 w-4 h-4 text-indigo-600"
                                                    />
                                                    <div className="ml-3 flex-1">
                                                        <p className="font-medium text-slate-900">{course.course_title}</p>
                                                        <div className="flex items-center gap-3 mt-1">
                                                            <p className="text-sm text-slate-500">
                                                                Completed: {new Date(course.completed_at).toLocaleDateString()}
                                                            </p>
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                                <CheckCircle className="w-3 h-3" />
                                                                Passed: {course.quiz_score}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3 sticky bottom-0 bg-white">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                            disabled={assigning}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAssignRetake}
                            disabled={!selectedCourse || assigning || loading}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {assigning ? "Assigning..." : "Assign Retake"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
