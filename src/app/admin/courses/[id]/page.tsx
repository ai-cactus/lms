"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Course } from "@/types/database";

interface CourseAssignment {
    worker_id: string;
    status: string;
    progress_percentage: number;
    users?: {
        full_name: string;
        role: string;
    };
}
import {
    ArrowLeft,
    Users,
    TrendingUp,
    Clock,
    FileText,
    Eye,
    UserPlus,
    Download,
    CheckCircle,
    Search,
    Trash2,
    X,
    Loader2,
} from "lucide-react";
import CoursePreviewModal from "@/components/courses/CoursePreviewModal";
import AssignUsersModal from "@/components/courses/AssignUsersModal";
import DeleteConfirmationModal from "@/components/courses/DeleteConfirmationModal";

interface CourseDetails {
    id: string;
    title: string;
    lesson_notes: string;
    pass_mark: number;
    published_at: string;
    objectives?: {
        items?: string[];
        difficulty?: string;
    };
    policy?: {
        title: string;
        file_name: string;
    };
}

interface StaffPerformance {
    id: string;
    worker_id: string;
    worker_name: string;
    worker_role?: string;
    score: number | null;
    status: string;
    completion_id: string | null;
    progress: number;
}

export default function CourseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const supabase = createClient();

    const [course, setCourse] = useState<CourseDetails | null>(null);
    const [staffPerformance, setStaffPerformance] = useState<StaffPerformance[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [showPreview, setShowPreview] = useState(false);
    const [showAssign, setShowAssign] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [stats, setStats] = useState({
        totalLearners: 0,
        completionRate: 0,
        averageScore: 0,
        averageDuration: 0,
    });

    useEffect(() => {
        loadCourseData();
    }, [id]);

    const loadCourseData = async () => {
        try {
            // Fetch course details
            const { data: courseData, error: courseError } = await supabase
                .from("courses")
                .select(`
                    id,
                    title,
                    lesson_notes,
                    pass_mark,
                    published_at,
                    objectives,
                    policy:policies(title, file_name)
                `)
                .eq("id", id)
                .single();

            if (courseError) throw courseError;
            setCourse(courseData as Course);

            // Fetch assignments with user details
            const { data: assignments } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    worker_id,
                    status,
                    progress_percentage,
                    users!course_assignments_worker_id_fkey(full_name, role)
                `)
                .eq("course_id", id);

            // Fetch completions for scores
            const { data: completions } = await supabase
                .from("course_completions")
                .select("worker_id, quiz_score, id")
                .eq("course_id", id);

            // Fetch quiz attempts as fallback for scores
            const { data: attempts } = await supabase
                .from("quiz_attempts")
                .select("worker_id, score, id")
                .eq("course_id", id)
                .order("completed_at", { ascending: false });

            // Combine data
            const staffData: StaffPerformance[] = (assignments || []).map((assignment: CourseAssignment) => {
                const completion = completions?.find((c) => c.worker_id === assignment.worker_id);
                // Find latest attempt for this worker
                const attempt = attempts?.find((a) => a.worker_id === assignment.worker_id);

                // Use completion score if available, otherwise fallback to attempt score
                const score = completion?.quiz_score ?? attempt?.score ?? null;

                return {
                    id: assignment.id,
                    worker_id: assignment.worker_id,
                    worker_name: assignment.users?.full_name || "Unknown",
                    worker_role: assignment.users?.role,
                    score: score,
                    status: assignment.status,
                    completion_id: completion?.id || null,
                    progress: assignment.progress_percentage || 0,
                };
            });

            setStaffPerformance(staffData);

            // Calculate stats
            const totalLearners = staffData.length;
            const completedCount = staffData.filter(s => s.status === 'completed').length;
            const completionRate = totalLearners > 0 ? Math.round((completedCount / totalLearners) * 100) : 0;

            const scores = staffData.filter((s) => s.score !== null).map((s) => s.score as number);
            const averageScore = scores.length > 0
                ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
                : 0;

            // Estimate duration based on word count (avg reading speed 200 wpm)
            const wordCount = courseData.lesson_notes ? courseData.lesson_notes.split(/\s+/).length : 0;
            const averageDuration = Math.ceil(wordCount / 200);

            setStats({ totalLearners, completionRate, averageScore, averageDuration });
            setLoading(false);
        } catch (error) {
            console.error("Error loading course data:", error);
            setLoading(false);
        }
    };

    const filteredStaff = searchQuery
        ? staffPerformance.filter((s) =>
            s.worker_name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : staffPerformance;

    const getPreviewData = () => {
        if (!course) return { title: "", content: "" };
        return {
            title: course.title,
            content: course.lesson_notes
        };
    };

    const handleDeleteCourse = async () => {
        if (!course) return;
        setIsDeleting(true);
        try {
            const { deleteCourse } = await import("@/app/actions/course");
            const result = await deleteCourse(course.id);
            if (result.success) {
                router.push("/admin/courses");
            } else {
                alert(result.error);
                setIsDeleting(false);
            }
        } catch (error) {
            console.error("Error deleting course:", error);
            alert("Failed to delete course");
            setIsDeleting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!course) return <div className="p-8 text-center">Course not found</div>;

    return (
        <div className="min-h-screen bg-white p-8">
            <CoursePreviewModal
                isOpen={showPreview}
                onClose={() => setShowPreview(false)}
                courseData={getPreviewData()}
            />
            <AssignUsersModal
                isOpen={showAssign}
                onClose={() => setShowAssign(false)}
                courseId={id}
                onAssignmentComplete={() => loadCourseData()}
            />
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={handleDeleteCourse}
                courseTitle={course.title}
                isDeleting={isDeleting}
            />

            <div className="max-w-7xl mx-auto">
                <button
                    onClick={() => router.push("/admin/courses")}
                    className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Go Back</span>
                    <span className="text-slate-400">/</span>
                    <span className="text-slate-400">Course</span>
                    <span className="text-slate-400">/</span>
                    <span>Course Details</span>
                </button>

                <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">{course.title}</h1>
                            <div className="flex items-center gap-3">
                                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                                    Active
                                </span>
                                {course.policy && (
                                    <span className="text-sm text-slate-600">
                                        Linked Policy Document: <span className="font-medium">{course.policy.file_name}</span>
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => router.push(`/admin/courses/${id}/preview`)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                            >
                                <Eye className="w-4 h-4" />
                                Preview
                            </button>
                            <button
                                onClick={() => setShowAssign(true)}
                                className="px-4 py-2 bg-white border border-gray-300 text-slate-900 rounded-lg font-medium hover:bg-white transition-colors flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                Assign
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                    <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                                <Users className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-blue-700 mb-1">Total Learners</p>
                                <p className="text-2xl font-bold text-blue-900">{stats.totalLearners}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-green-50 rounded-xl p-6 border border-green-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-green-700 mb-1">Completion Rate</p>
                                <p className="text-2xl font-bold text-green-900">{stats.completionRate}%</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-red-50 rounded-xl p-6 border border-red-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center">
                                <FileText className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-red-700 mb-1">Average Score</p>
                                <p className="text-2xl font-bold text-red-900">{stats.averageScore}%</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-yellow-50 rounded-xl p-6 border border-yellow-100">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-yellow-600 rounded-lg flex items-center justify-center">
                                <Clock className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <p className="text-sm text-yellow-700 mb-1">Average Duration</p>
                                <p className="text-2xl font-bold text-yellow-900">{stats.averageDuration} mins</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900">Staff Performance</h2>
                            <div className="flex items-center gap-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search for staff..."
                                        className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                                    />
                                </div>
                                <button
                                    onClick={async () => {
                                        if (isExporting) return; // Prevent multiple clicks

                                        setIsExporting(true);
                                        try {
                                            const response = await fetch(`/api/courses/${id}/staff-performance-pdf`);
                                            if (response.ok) {
                                                const blob = await response.blob();
                                                const url = window.URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `Course_Staff_Performance_${course?.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                                window.URL.revokeObjectURL(url);
                                            } else {
                                                alert('Failed to generate PDF report');
                                            }
                                        } catch (error) {
                                            console.error('Error downloading PDF:', error);
                                            alert('Failed to download PDF report');
                                        } finally {
                                            setIsExporting(false);
                                        }
                                    }}
                                    disabled={isExporting}
                                    className="px-4 py-2 bg-white border border-gray-300 text-slate-900 rounded-lg font-medium hover:bg-white transition-colors flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isExporting ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Download className="w-4 h-4" />
                                    )}
                                    {isExporting ? 'Exporting...' : 'Export'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-white border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Staff Name</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">Score</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">Quiz result</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredStaff.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-slate-600">No staff assignments found</td>
                                    </tr>
                                ) : (
                                    filteredStaff.map((staff) => (
                                        <tr key={staff.id} className="hover:bg-white">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <g clipPath="url(#clip0_10466_18703)">
                                                            <path d="M19 38C29.4934 38 38 29.4934 38 19C38 8.50659 29.4934 0 19 0C8.50659 0 0 8.50659 0 19C0 29.4934 8.50659 38 19 38Z" fill="#DBE1FF"/>
                                                            <path d="M18.9988 22.3458C22.7606 22.3458 25.8101 19.2963 25.8101 15.5345C25.8101 11.7727 22.7606 8.72314 18.9988 8.72314C15.237 8.72314 12.1875 11.7727 12.1875 15.5345C12.1875 19.2963 15.237 22.3458 18.9988 22.3458Z" fill="#7D91F2"/>
                                                            <path d="M32.0952 32.8191C28.6925 36.0312 24.1044 37.9999 19.0563 37.9999C14.0081 37.9999 9.31968 35.9882 5.90625 32.7133C6.06279 32.3895 6.24741 32.0806 6.43263 31.7759C7.30914 30.3366 8.41509 29.0872 9.73373 28.0333C9.85562 27.9359 9.93329 27.7889 10.0851 27.7273C10.3533 27.6712 10.5493 27.4788 10.7572 27.33C11.5089 26.7899 12.3412 26.4045 13.1681 26.0054C13.2392 25.9749 13.3109 25.948 13.3826 25.92C14.7221 25.4073 16.0969 25.0201 17.5261 24.8821C18.3501 24.8027 19.1835 24.866 20.0117 24.8612C21.0853 24.9036 22.1399 25.0656 23.1694 25.3816C24.8172 25.8883 26.3426 26.6399 27.7407 27.6491C29.3963 28.8434 30.6929 30.3545 31.7188 32.1135C31.852 32.3423 31.9625 32.5879 32.0952 32.8191Z" fill="#7D91F2"/>
                                                        </g>
                                                        <defs>
                                                            <clipPath id="clip0_10466_18703">
                                                                <rect width="38" height="38" rx="19" fill="white"/>
                                                            </clipPath>
                                                        </defs>
                                                    </svg>
                                                    <div>
                                                        <p className="font-medium text-slate-900">{staff.worker_name}</p>
                                                        {staff.worker_role && <p className="text-sm text-slate-500">{staff.worker_role}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className="text-sm text-slate-700">
                                                    {staff.score !== null ? `${staff.score}%` : "-"}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {staff.status === "completed" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                        <CheckCircle className="w-3 h-3" />
                                                        Passed
                                                    </span>
                                                ) : staff.status === "failed" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                        <X className="w-3 h-3" />
                                                        Failed
                                                    </span>
                                                ) : staff.status === "in_progress" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                                        <Clock className="w-3 h-3" />
                                                        In Progress
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                                                        Not Started
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {staff.completion_id ? (
                                                    <button
                                                        onClick={() => {
                                                            router.push(`/admin/courses/${id}/quiz-results/${staff.completion_id}`);
                                                        }}
                                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
                                                    >
                                                        View
                                                    </button>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                                                        No result
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div >
    );
}
