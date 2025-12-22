"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    Plus,
    Search,
    CheckCircle,
    ChevronRight,
    ChevronLeft,
    Clock,
} from "lucide-react";
import AssignUsersModal from "@/components/courses/AssignUsersModal";
import { CourseDrafts } from "@/components/courses/course-drafts";
import { CourseDraft } from "@/lib/course-draft";

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
    const [statusFilter] = useState("all");
    const [loading, setLoading] = useState(true);
    const [showSuccess, setShowSuccess] = useState(false);
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [selectedCourseForAssign, setSelectedCourseForAssign] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'courses' | 'drafts'>('courses');
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    useEffect(() => {
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
                    (coursesData || []).map(async (course) => {
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

        if (searchParams.get("updated") === "true") {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 5000);
        }
        loadCourses();
    }, []);

    useEffect(() => {
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

        filterCourses();
    }, [courses, searchQuery, statusFilter]);

    const handleCloseAssignModal = () => {
        setAssignModalOpen(false);
        setSelectedCourseForAssign(null);
    };

    const handleAssignmentComplete = () => {
        loadCourses(); // Refresh the course list to update assignment counts
        handleCloseAssignModal();
    };

    const handleContinueDraft = (draft: CourseDraft) => {
        // Navigate to course creation with draft data
        router.push(`/admin/courses/create?draftId=${draft.id}`);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading courses...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Breadcrumb */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>Trainings</span>
                        <span>/</span>
                        <span className="text-slate-900 font-medium">Courses</span>
                    </div>
                </div>

                {/* Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Courses</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push("/admin/courses/create")}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                                activeTab === 'drafts'
                                    ? 'border border-gray-300 text-slate-700 hover:bg-gray-50'
                                    : 'bg-[#4E61F6] text-white hover:bg-[#4E61F6]/90'
                            }`}
                        >
                            <Plus className="w-5 h-5" />
                            {activeTab === 'drafts' ? 'Create Course' : 'Create Course'}
                        </button>
                    </div>
                </div>

                {/* Success Message */}
                {showSuccess && (
                    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <p className="text-sm text-green-700">Course updated successfully!</p>
                    </div>
                )}

                {/* Tabs */}
                <div className="mb-6">
                    <div className="border-b border-gray-200">
                        <nav className="-mb-px flex space-x-8">
                            <button
                                onClick={() => setActiveTab('courses')}
                                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'courses'
                                        ? 'border-[#4E61F6] text-[#4E61F6]'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <BookOpen className="w-4 h-4" />
                                    Published Courses
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('drafts')}
                                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'drafts'
                                        ? 'border-[#4E61F6] text-[#4E61F6]'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4" />
                                    Drafts
                                </div>
                            </button>
                        </nav>
                    </div>
                </div>

                {/* Tab Content */}
                {activeTab === 'courses' ? (
                    <>
                        {/* Search */}
                        <div className="mb-6">
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search for courses..."
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                />
                            </div>
                        </div>

                {/* Courses Table */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-white border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Course Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Assigned Staff
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                                        Completion %
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
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-600">
                                            <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                                            <p>No courses found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredCourses.map((course) => {
                                        const completionRate = course.stats?.totalAssignments && course.stats.totalAssignments > 0 
                                            ? Math.round(((course.stats.completedAssignments || 0) / course.stats.totalAssignments) * 100)
                                            : 0;

                                        return (
                                            <tr
                                                key={course.id}
                                                className="hover:bg-white transition-colors cursor-pointer"
                                                onClick={() => router.push(`/admin/courses/${course.id}`)}
                                            >
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                                                            <BookOpen className="w-5 h-5 text-white" />
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-slate-900">{course.title}</p>
                                                            <p className="text-sm text-slate-500">Advanced</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-slate-700">
                                                        {course.stats?.totalAssignments || 0}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-slate-700">
                                                        {completionRate}%
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
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/admin/courses/${course.id}`);
                                                        }}
                                                        className="text-slate-400 hover:text-slate-600"
                                                    >
                                                        <ChevronRight className="w-5 h-5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination */}
                    <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                        <div className="text-sm text-slate-600">
                            Showing 1 to 10 of {filteredCourses.length} entries
                        </div>
                        <div className="flex items-center gap-2">
                            <button className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm">
                                1
                            </button>
                            <button className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50">
                                2
                            </button>
                            <button className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50">
                                3
                            </button>
                            <span className="px-2 text-sm text-slate-600">...</span>
                            <button className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50">
                                5
                            </button>
                            <button className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                            <div className="ml-4 flex items-center gap-2">
                                <span className="text-sm text-slate-600">Show</span>
                                <select className="border border-gray-300 rounded px-2 py-1 text-sm">
                                    <option>10</option>
                                    <option>25</option>
                                    <option>50</option>
                                </select>
                                <span className="text-sm text-slate-600">entries</span>
                            </div>
                        </div>
                    </div>
                        </div>
                    </>
                ) : (
                    /* Drafts Tab Content */
                    <CourseDrafts onContinueDraft={handleContinueDraft} />
                )}

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
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading...</div>
            </div>
        }>
            <CoursesListContent />
        </Suspense>
    );
}
