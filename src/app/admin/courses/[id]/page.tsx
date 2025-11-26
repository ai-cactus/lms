"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
            setCourse(courseData as any);

            // Fetch assignments with user details
            const { data: assignments } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    worker_id,
                    status,
                    users!course_assignments_worker_id_fkey(full_name, role)
                `)
                .eq("course_id", id);

            // Fetch completions for scores
            const { data: completions } = await supabase
                .from("course_completions")
                .select("worker_id, quiz_score, id")
                .eq("course_id", id);

            // Combine data
            const staffData: StaffPerformance[] = (assignments || []).map((assignment: any) => {
                const completion = completions?.find((c) => c.worker_id === assignment.worker_id);
                return {
                    id: assignment.id,
                    worker_id: assignment.worker_id,
                    worker_name: assignment.users?.full_name || "Unknown",
                    worker_role: assignment.users?.role,
                    score: completion?.quiz_score || null,
                    status: assignment.status,
                    completion_id: completion?.id || null,
                };
            });

            setStaffPerformance(staffData);

            // Calculate stats
            const totalLearners = staffData.length;
            const completed = staffData.filter((s) => s.status === "completed").length;
            const completionRate = totalLearners > 0 ? Math.round((completed / totalLearners) * 100) : 0;

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
        <div className="min-h-screen bg-slate-50 p-8">
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
                                onClick={() => setShowPreview(true)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                            >
                                <Eye className="w-4 h-4" />
                                Preview
                            </button>
                            <button
                                onClick={() => setShowAssign(true)}
                                className="px-4 py-2 bg-white border border-gray-300 text-slate-900 rounded-lg font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                Assign
                            </button>
                            <button
                                onClick={() => setShowDeleteModal(true)}
                                className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg font-medium hover:bg-red-50 transition-colors flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
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
                                <TrendingUp className="w-6 h-6 text-white" />
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
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Staff Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Score</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Quiz Result</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredStaff.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-slate-600">No staff assignments found</td>
                                    </tr>
                                ) : (
                                    filteredStaff.map((staff) => (
                                        <tr key={staff.id} className="hover:bg-slate-50">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-medium text-slate-900">{staff.worker_name}</p>
                                                    {staff.worker_role && <p className="text-sm text-slate-500">{staff.worker_role}</p>}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-slate-700">
                                                    {staff.score !== null ? `${staff.score}%` : "-"}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {staff.status === "completed" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                        <CheckCircle className="w-3 h-3" />
                                                        Passed
                                                    </span>
                                                ) : staff.status === "in_progress" ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                                        In Progress
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                                                        Not Started
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {staff.completion_id ? (
                                                    <button
                                                        onClick={() => router.push(`/admin/courses/${id}/quiz-results/${staff.completion_id}`)}
                                                        className="px-3 py-1 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors"
                                                    >
                                                        View
                                                    </button>
                                                ) : (
                                                    <span className="text-sm text-slate-400">-</span>
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
        </div>
    );
}
