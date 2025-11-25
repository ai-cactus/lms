"use client";

import { useState, useEffect } from "react";
import { X, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AssignCourseModalProps {
    isOpen: boolean;
    onClose: () => void;
    workerId: string;
    onAssignComplete: () => void;
}

interface AvailableCourse {
    id: string;
    title: string;
    difficulty?: string;
}

export default function AssignCourseModal({ isOpen, onClose, workerId, onAssignComplete }: AssignCourseModalProps) {
    const [availableCourses, setAvailableCourses] = useState<AvailableCourse[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        if (isOpen) {
            loadAvailableCourses();
            setSelectedCourses(new Set());
        }
    }, [isOpen, workerId]);

    const loadAvailableCourses = async () => {
        setLoading(true);
        try {
            // Get all published courses
            const { data: allCourses } = await supabase
                .from("courses")
                .select("id, title, objectives")
                .not("published_at", "is", null)
                .order("title");

            // Get courses already assigned to this worker
            const { data: assignments } = await supabase
                .from("course_assignments")
                .select("course_id")
                .eq("worker_id", workerId);

            const assignedCourseIds = new Set(assignments?.map(a => a.course_id) || []);

            // Filter out already assigned courses
            const available = (allCourses || [])
                .filter(course => !assignedCourseIds.has(course.id))
                .map(course => ({
                    id: course.id,
                    title: course.title,
                    difficulty: (course.objectives as any)?.difficulty || "Beginner",
                }));

            setAvailableCourses(available);
        } catch (error) {
            console.error("Error loading available courses:", error);
        } finally {
            setLoading(false);
        }
    };

    const toggleCourse = (courseId: string) => {
        const newSelected = new Set(selectedCourses);
        if (newSelected.has(courseId)) {
            newSelected.delete(courseId);
        } else {
            newSelected.add(courseId);
        }
        setSelectedCourses(newSelected);
    };

    const handleAssignCourses = async () => {
        if (selectedCourses.size === 0) return;

        setAssigning(true);
        try {
            const deadline = new Date();
            deadline.setDate(deadline.getDate() + 30);

            const assignments = Array.from(selectedCourses).map(courseId => ({
                course_id: courseId,
                worker_id: workerId,
                status: "not_started",
                assigned_at: new Date().toISOString(),
                deadline: deadline.toISOString(),
            }));

            const { error } = await supabase
                .from("course_assignments")
                .insert(assignments);

            if (error) throw error;

            onAssignComplete();
            onClose();
            setSelectedCourses(new Set());
            setSearchQuery("");
        } catch (error: any) {
            console.error("Error assigning courses:", error);
            alert(error.message || "Failed to assign courses");
        } finally {
            setAssigning(false);
        }
    };

    const filteredCourses = searchQuery
        ? availableCourses.filter(c =>
            c.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : availableCourses;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose}></div>

            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full">
                    <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900">Assign Course</h2>
                            {selectedCourses.size > 0 && (
                                <p className="text-sm text-slate-600 mt-1">
                                    {selectedCourses.size} course{selectedCourses.size !== 1 ? "s" : ""} selected
                                </p>
                            )}
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                            <X className="w-5 h-5 text-slate-600" />
                        </button>
                    </div>

                    <div className="px-6 py-6">
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        ) : (
                            <>
                                <div className="mb-4">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search courses..."
                                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        />
                                    </div>
                                </div>

                                {filteredCourses.length === 0 ? (
                                    <div className="text-center py-8 text-slate-600">
                                        {availableCourses.length === 0
                                            ? "All courses have been assigned to this staff member"
                                            : "No courses found matching your search"}
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-96 overflow-y-auto">
                                        {filteredCourses.map((course) => (
                                            <label
                                                key={course.id}
                                                className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${selectedCourses.has(course.id)
                                                        ? "border-indigo-600 bg-indigo-50"
                                                        : "border-gray-200 hover:border-gray-300"
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedCourses.has(course.id)}
                                                    onChange={() => toggleCourse(course.id)}
                                                    className="mt-1 w-4 h-4 text-indigo-600 rounded"
                                                />
                                                <div className="ml-3 flex-1">
                                                    <p className="font-medium text-slate-900">{course.title}</p>
                                                    <p className="text-sm text-slate-500 mt-1">
                                                        {course.difficulty}
                                                    </p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                            disabled={assigning}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAssignCourses}
                            disabled={selectedCourses.size === 0 || assigning || loading}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {assigning ? "Assigning..." : `Assign ${selectedCourses.size > 0 ? `(${selectedCourses.size})` : ""}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
