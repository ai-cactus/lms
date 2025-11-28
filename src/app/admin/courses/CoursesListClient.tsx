"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    Plus,
    Search,
    CheckCircle,
    AlertCircle,
    UserPlus,
} from "lucide-react";
import AssignUsersModal from "@/components/courses/AssignUsersModal";

interface Course {
    id: string;
    title: string;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    policy?: {
        title: string;
    };
    stats?: {
        totalAssignments: number;
        completedAssignments: number;
    };
}

function CoursesListContent() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [filteredCourses, setFilteredCourses] = useState<Course[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [loading, setLoading] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [selectedCourseForAssign, setSelectedCourseForAssign] = useState<string | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    useEffect(() => {
        if (searchParams.get("updated") === "true") {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 5000);
        }
        loadCourses();
    }, []);

    useEffect(() => {
        filterCourses();
    }, [courses, searchQuery, statusFilter]);

    const loadCourses = async () => {
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

            // Get all courses with policy info
            const { data: coursesData, error } = await supabase
                .from("courses")
                .select(`
                    id,
                    title,
                    published_at,
                    created_at,
                    updated_at,
                    policy:policies(title)
                `)
                .eq("organization_id", userData?.organization_id)
                .order("created_at", { ascending: false });

            if (error) throw error;

            // Get assignment stats for each course
            const coursesWithStats = await Promise.all(
                (coursesData || []).map(async (course: any) => {
                    const { count: total } = await supabase
                        .from("course_assignments")
                        .select("*", { count: "exact", head: true })
                        .eq("course_id", course.id);

                    const { count: completed } = await supabase
                        .from("course_assignments")
                        .select("*", { count: "exact", head: true })
                        .eq("course_id", course.id)
                        .eq("status", "completed");

                    return {
                        ...course,
                        stats: {
                            totalAssignments: total || 0,
                            completedAssignments: completed || 0,
                        },
                    };
                })
            );

            setCourses(coursesWithStats);
            setLoading(false);
        } catch (error) {
            console.error("Error loading courses:", error);
            setLoading(false);
        }
    };

    const filterCourses = () => {
        let filtered = [...courses];

        // Status filter
        if (statusFilter === "published") {
            filtered = filtered.filter((c) => c.published_at);
        } else if (statusFilter === "draft") {
            filtered = filtered.filter((c) => !c.published_at);
        }

        // Search filter
        if (searchQuery) {
            filtered = filtered.filter((c) =>
                c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (c.policy?.title && c.policy.title.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }

        setFilteredCourses(filtered);
    };

    const handleOpenAssignModal = (courseId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setSelectedCourseForAssign(courseId);
        setAssignModalOpen(true);
    };

    const handleCloseAssignModal = () => {
        setAssignModalOpen(false);
        setSelectedCourseForAssign(null);
    };

    const handleAssignmentComplete = () => {
        loadCourses(); // Refresh the course list to update assignment counts
        handleCloseAssignModal();
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading courses...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Course Management</h1>
                        <p className="text-slate-600">View and manage your training courses</p>
                    </div>
                    <button
                        onClick={() => router.push("/admin/courses/create")}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        Add Course
                    </button>
                </div>

                {/* Success Message */}
                {showSuccess && (
                    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <p className="text-sm text-green-700">Course updated successfully!</p>
                    </div>
                )}

                {/* Filters */}
                <div className="mb-6 bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by course or policy title..."
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
                            <option value="published">Published</option>
                            <option value="draft">Draft</option>
                        </select>
                    </div>
                </div>

                {/* Courses Table */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600  uppercase tracking-wider">
                                        Course Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Assigned Staff
                                    </th>

                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Date Created
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Action
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredCourses.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-slate-600">
                                            <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                                            <p>No courses found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredCourses.map((course) => {


                                        return (
                                            <tr
                                                key={course.id}
                                                className="hover:bg-slate-50 transition-colors cursor-pointer"
                                                onClick={() => router.push(`/admin/courses/${course.id}`)}
                                            >
                                                <td className="px-6 py-4">
                                                    <div>
                                                        <p className="font-medium text-slate-900">{course.title}</p>
                                                        {course.policy?.title && (
                                                            <p className="text-sm text-slate-500">{course.policy.title}</p>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-slate-700">
                                                        {course.stats?.totalAssignments || 0}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-slate-700">
                                                        {new Date(course.created_at).toLocaleDateString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        })}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <button
                                                        onClick={(e) => handleOpenAssignModal(course.id, e)}
                                                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                                                    >
                                                        <UserPlus className="w-4 h-4" />
                                                        Assign Workers
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
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
                                <p className="text-sm text-slate-600">Total Courses</p>
                                <p className="text-2xl font-bold text-slate-900">{courses.length}</p>
                            </div>
                            <BookOpen className="w-8 h-8 text-indigo-600" />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Published</p>
                                <p className="text-2xl font-bold text-green-600">
                                    {courses.filter((c) => c.published_at).length}
                                </p>
                            </div>
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Total Assignments</p>
                                <p className="text-2xl font-bold text-blue-600">
                                    {courses.reduce((sum, c) => sum + (c.stats?.totalAssignments || 0), 0)}
                                </p>
                            </div>
                            <AlertCircle className="w-8 h-8 text-blue-600" />
                        </div>
                    </div>
                </div>

                {/* Assign Users Modal */}
                {assignModalOpen && selectedCourseForAssign && (
                    <AssignUsersModal
                        isOpen={assignModalOpen}
                        onClose={handleCloseAssignModal}
                        courseId={selectedCourseForAssign}
                        onAssignmentComplete={handleAssignmentComplete}
                    />
                )}
            </div>
        </div>
    );
}

export default function CoursesListClient() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading...</div>
            </div>
        }>
            <CoursesListContent />
        </Suspense>
    );
}
