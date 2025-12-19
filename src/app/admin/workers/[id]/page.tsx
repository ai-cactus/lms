"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateWorker } from "@/app/actions/worker";
import { ROLES, CATEGORIES, type WorkerRole, type WorkerCategory } from "@/lib/carf-courses";
import AssessmentHistoryTab from "@/components/AssessmentHistoryTab";
import LearningNeedsTab from "@/components/LearningNeedsTab";
import {
    ArrowLeft,
    Mail,
    Calendar,
    CheckCircle,
    AlertCircle,
    BookOpen,
    Plus,
    X,
    Loader2,
    User,
    ClipboardList,
    BrainCircuit,
    Pencil,
    Save
} from "lucide-react";

interface Worker {
    id: string;
    full_name: string;
    email: string;
    role: string;
    job_title: string;
    worker_category: string;
    supervisor_id: string | null;
    status: string;
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
    const [activeTab, setActiveTab] = useState<"overview" | "history" | "needs">("overview");

    // Edit Modal State
    const [showEditModal, setShowEditModal] = useState(false);
    const [editFormData, setEditFormData] = useState({
        fullName: "",
        email: "",
        role: "",
        category: "",
        supervisorId: "",
        status: "active"
    });
    const [supervisors, setSupervisors] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

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

            // Get supervisors for edit modal
            const { data: supervisorData } = await supabase
                .from("users")
                .select("id, full_name")
                .eq("organization_id", workerData.organization_id)
                .eq("role", "supervisor")
                .is("deactivated_at", null);

            setSupervisors(supervisorData || []);

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

    const handleEditClick = () => {
        if (!worker) return;
        setEditFormData({
            fullName: worker.full_name,
            email: worker.email,
            role: worker.role,
            category: worker.worker_category || "",
            supervisorId: worker.supervisor_id || "",
            status: worker.status || "active"
        });
        setError(""); // Clear any previous errors
        setShowEditModal(true);
    };

    const handleUpdateWorker = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        try {
            const formData = new FormData();
            formData.append("workerId", workerId);
            formData.append("fullName", editFormData.fullName);
            formData.append("email", editFormData.email);
            formData.append("role", editFormData.role);
            formData.append("category", editFormData.category);
            formData.append("supervisorId", editFormData.supervisorId);
            formData.append("status", editFormData.status);

            const result = await updateWorker({}, formData);

            if (result.error) {
                setError(result.error);
                setSaving(false);
                return;
            }

            await loadWorkerData();
            setShowEditModal(false);
            setError(""); // Clear any previous errors
        } catch (error) {
            console.error("Error updating worker:", error);
            setError(error instanceof Error ? error.message : "Failed to update worker");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading worker details...</div>
            </div>
        );
    }

    if (!worker) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-red-600">Worker not found</div>
            </div>
        );
    }

    const completedCount = assignments.filter(a => a.status === "completed").length;
    const overdueCount = assignments.filter(a => a.status === "overdue").length;

    return (
        <div className="min-h-screen bg-white py-8 px-4">
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
                            onClick={handleEditClick}
                            className="px-4 py-2 bg-white border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center gap-2 mr-2"
                        >
                            <Pencil className="w-4 h-4" />
                            Edit Profile
                        </button>
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

                {/* Tabbed Content */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Tab Navigation */}
                    <div className="border-b border-gray-200">
                        <nav className="flex -mb-px">
                            <button
                                onClick={() => setActiveTab("overview")}
                                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "overview"
                                    ? "border-indigo-600 text-indigo-600"
                                    : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    Overview
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab("history")}
                                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "history"
                                    ? "border-indigo-600 text-indigo-600"
                                    : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <ClipboardList className="w-4 h-4" />
                                    Assessment History
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab("needs")}
                                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "needs"
                                    ? "border-indigo-600 text-indigo-600"
                                    : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <BrainCircuit className="w-4 h-4" />
                                    Learning Needs
                                </div>
                            </button>
                        </nav>
                    </div>

                    {/* Tab Content */}
                    <div className="p-6">
                        {activeTab === "overview" && (
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900 mb-4">Course Assignments</h2>
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="divide-y divide-gray-100">
                                        {assignments.length === 0 ? (
                                            <div className="p-8 text-center text-slate-500">
                                                No courses assigned yet.
                                            </div>
                                        ) : (
                                            assignments.map((assignment) => (
                                                <div key={assignment.id} className="p-6 hover:bg-white transition-colors">
                                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                        <div className="flex-1">
                                                            <div className="flex items-start justify-between mb-2">
                                                                <h3 className="text-lg font-bold text-slate-900">
                                                                    {assignment.courses.title}
                                                                </h3>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-4 text-sm">
                                                                {/* Status Tags */}
                                                                {(() => {
                                                                    switch (assignment.status) {
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
                                                                                        <AlertCircle className="w-3 h-3" />
                                                                                        Failed
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        case "in_progress":
                                                                            return (
                                                                                <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center gap-1">
                                                                                    <Calendar className="w-3 h-3" />
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
                                                                })()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === "history" && (
                            <AssessmentHistoryTab workerId={workerId} />
                        )}

                        {activeTab === "needs" && (
                            <LearningNeedsTab workerId={workerId} />
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

            {/* Edit Worker Modal */}
            {showEditModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-900">Edit Worker Profile</h2>
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {error && (
                            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleUpdateWorker} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Full Name
                                </label>
                                <input
                                    type="text"
                                    value={editFormData.fullName}
                                    onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={editFormData.email}
                                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Role / Job Title
                                </label>
                                <select
                                    value={editFormData.role}
                                    onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">Select a role...</option>
                                    {ROLES.map((role) => (
                                        <option key={role} value={role}>
                                            {role}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Worker Category
                                </label>
                                <select
                                    value={editFormData.category}
                                    onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">Select a category...</option>
                                    {CATEGORIES.map((cat) => (
                                        <option key={cat} value={cat}>
                                            {cat}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Supervisor
                                </label>
                                <select
                                    value={editFormData.supervisorId}
                                    onChange={(e) => setEditFormData({ ...editFormData, supervisorId: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">No supervisor assigned</option>
                                    {supervisors.map((sup) => (
                                        <option key={sup.id} value={sup.id}>
                                            {sup.full_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Status
                                </label>
                                <select
                                    value={editFormData.status}
                                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="flex-1 py-2 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4" />
                                            Save Changes
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
}
