"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
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
    FileText
} from "lucide-react";
import AssignUsersModal from "@/components/courses/AssignUsersModal";
import { CourseDrafts } from "@/components/courses/course-drafts";
import { CourseDraft, courseDraftManager } from "@/lib/course-draft";

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
    const [draftCount, setDraftCount] = useState<number>(0);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const loadCourses = useCallback(async () => {
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

                    // Handle policy data which might be returned as an array by Supabase
                    const policyData = Array.isArray(course.policy) ? course.policy[0] : course.policy;

                    return {
                        ...course,
                        policy: policyData,
                        stats: {
                            totalAssignments: total || 0,
                        },
                    };
                })
            );

            setCourses(coursesWithStats as Course[]);
            setLoading(false);
        } catch (error) {
            console.error("Error loading courses:", error);
            setLoading(false);
        }
    }, [router, supabase]);

    const loadDraftCount = useCallback(async () => {
        try {
            const result = await courseDraftManager.loadAllDrafts();
            if (result.success && result.drafts) {
                setDraftCount(result.drafts.length);
            }
        } catch (error) {
            console.error("Error loading draft count:", error);
        }
    }, []);

    useEffect(() => {
        if (searchParams.get("updated") === "true") {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 5000);
        }
        loadCourses();
        loadDraftCount();
    }, [loadCourses, loadDraftCount, searchParams]);

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
            setCurrentPage(1); // Reset to page 1 on filter change
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

    // Pagination Logic
    const totalPages = Math.ceil(filteredCourses.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedCourses = filteredCourses.slice(startIndex, endIndex);

    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading courses...</div>
            </div>
        );
    }

    // Fixed height container for dashboard feel - using explicit heights to avoid global scroll
    // Assuming Header is around 64px-80px, layout padding + breadcrumb + header section adds up.
    // h-[calc(100vh-8.5rem)] adjustment ensures it fits within the main layout area without overflow.
    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col font-sans -my-4 sm:-my-6 lg:-my-8 py-4 sm:py-6 lg:py-8">
            {/* Negative margin compensates for layout padding to stretch full height if needed, 
                 or we can just fit within the padding. Let's try to fit nicely. */}

            <div className="flex-none px-4 sm:px-0">
                {/* Breadcrumb */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>Trainings</span>
                        <span>/</span>
                        <span className="text-slate-900 font-medium">Courses</span>
                    </div>
                </div>

                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Courses</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push("/admin/courses/create")}
                            className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 bg-[#4E61F6] text-white hover:bg-[#4E61F6]/90 shadow-sm shadow-indigo-200"
                        >
                            <Plus className="w-5 h-5" />
                            Create Course
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

                {/* Tabs - Fixed at top */}
                <div className="mb-6 border-b border-gray-200">
                    <nav className="-mb-px flex space-x-8">
                        <button
                            onClick={() => setActiveTab('courses')}
                            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'courses'
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
                            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'drafts'
                                ? 'border-[#4E61F6] text-[#4E61F6]'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Drafts ({draftCount})
                            </div>
                        </button>
                    </nav>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-0">
                {activeTab === 'courses' ? (
                    <>
                        <div className="flex-none mb-6">
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search for courses..."
                                    className="w-full pl-10 pr-4 py-2 border border-border-default rounded-lg focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none text-sm transition-all text-text-primary"
                                />
                            </div>
                        </div>

                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-border-default overflow-hidden flex flex-col min-h-0">
                            {/* Table Container - Scrolls Internally */}
                            <div className="flex-1 overflow-auto">
                                <table className="w-full relative border-separate border-spacing-0">
                                    <thead className="bg-gray-50/50">
                                        <tr>
                                            <th className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[40%] shadow-sm">
                                                Course Name
                                            </th>
                                            <th className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[25%] shadow-sm">
                                                Assigned Staff
                                            </th>
                                            <th className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[25%] shadow-sm">
                                                Date Created
                                            </th>
                                            <th className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-[10%] shadow-sm">
                                                Action
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredCourses.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-24 text-center text-slate-500">
                                                    <div className="flex flex-col items-center justify-center gap-4">
                                                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100">
                                                            <BookOpen className="w-8 h-8 text-slate-300" />
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-lg text-slate-900">No courses found</p>
                                                            <p className="text-slate-500 mt-1">Get started by creating your first course.</p>
                                                        </div>
                                                        <button
                                                            onClick={() => router.push("/admin/courses/create")}
                                                            className="mt-2 px-6 py-2.5 rounded-lg border border-gray-200 text-slate-700 font-medium hover:bg-gray-50 flex items-center gap-2 transition-colors"
                                                        >
                                                            <Plus className="w-4 h-4" />
                                                            Create New Course
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            paginatedCourses.map((course) => (
                                                <tr
                                                    key={course.id}
                                                    className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                                                    onClick={() => router.push(`/admin/courses/${course.id}`)}
                                                >
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-brand-primary/10 rounded-lg flex items-center justify-center shrink-0">
                                                                <BookOpen className="w-5 h-5 text-brand-primary" />
                                                            </div>
                                                            <div>
                                                                <p className="font-medium text-slate-900 group-hover:text-brand-primary transition-colors">{course.title}</p>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                                                                        Advanced
                                                                    </span>
                                                                    {course.policy && (
                                                                        <span className="text-xs text-slate-400 truncate max-w-[150px]" title={course.policy.title}>
                                                                            from {course.policy.title}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                                            {course.stats?.totalAssignments || 0} Assigned
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm text-slate-600">
                                                            {new Date(course.created_at).toLocaleDateString('en-US', {
                                                                month: 'short',
                                                                day: 'numeric',
                                                                year: 'numeric'
                                                            })}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                router.push(`/admin/courses/${course.id}`);
                                                            }}
                                                            className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-brand-primary transition-all"
                                                        >
                                                            <ChevronRight className="w-5 h-5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Footer - Sticky at bottom of container */}
                            {filteredCourses.length > 0 && (
                                <div className="flex-none px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50 backdrop-blur-sm z-20">
                                    <div className="text-sm text-slate-500">
                                        Showing <span className="font-medium text-slate-700">{Math.min(filteredCourses.length, startIndex + 1)}</span> to <span className="font-medium text-slate-700">{Math.min(filteredCourses.length, endIndex)}</span> of <span className="font-medium text-slate-700">{filteredCourses.length}</span> entries
                                    </div>

                                    {/* Pagination Controls */}
                                    {totalPages > 1 && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => goToPage(currentPage - 1)}
                                                disabled={currentPage === 1}
                                                className="p-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed bg-white shadow-sm transition-all"
                                            >
                                                <ChevronLeft className="w-4 h-4" />
                                            </button>

                                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                                let p = i + 1;
                                                if (totalPages > 5) {
                                                    if (currentPage > 3) {
                                                        p = currentPage - 2 + i;
                                                    }
                                                    if (p > totalPages) return null;
                                                }

                                                return (
                                                    <button
                                                        key={p}
                                                        onClick={() => goToPage(p)}
                                                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${currentPage === p
                                                                ? "bg-brand-primary text-white shadow-sm"
                                                                : "bg-white border border-gray-200 text-slate-600 hover:bg-gray-50"
                                                            }`}
                                                    >
                                                        {p}
                                                    </button>
                                                );
                                            }).filter(Boolean)}

                                            <button
                                                onClick={() => goToPage(currentPage + 1)}
                                                disabled={currentPage === totalPages}
                                                className="p-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed bg-white shadow-sm transition-all"
                                            >
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Per Page Select */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-slate-500">Show</span>
                                        <select
                                            value={itemsPerPage}
                                            onChange={(e) => {
                                                setItemsPerPage(Number(e.target.value));
                                                setCurrentPage(1);
                                            }}
                                            className="border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:ring-2 focus:ring-brand-primary/20 outline-none cursor-pointer"
                                        >
                                            <option value={10}>10</option>
                                            <option value={20}>20</option>
                                            <option value={50}>50</option>
                                        </select>
                                        <span className="text-sm text-slate-500">entries</span>
                                    </div>
                                </div>
                            )}
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
        </div >
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
