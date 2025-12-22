"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    ArrowLeft,
    UserPlus,
    BookOpen,
    CheckCircle,
    XCircle,
    Clock,
    Search,
    Download,
    User,
    Edit3,
    Award,
    Zap,
    AlertTriangle,
    Loader2,
} from "lucide-react";
import AssignRetakeModal from "@/components/staff/AssignRetakeModal";
import AssignCourseModal from "@/components/staff/AssignCourseModal";

interface StaffMember {
    id: string;
    full_name: string;
    email: string;
    role: string;
    bio?: string;
    competencies?: string[];
    strengths?: string[];
    weaknesses?: string[];
}

interface CourseAssignment {
    id: string;
    course_id: string;
    status: string;
    assigned_at: string;
    completed_at?: string;
    progress_percentage: number;
    course: {
        title: string;
        difficulty?: string;
    };
    completion?: {
        quiz_score: number;
        id: string;
    };
}

export default function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const supabase = createClient();

    const [staff, setStaff] = useState<StaffMember | null>(null);
    const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [showRetakeModal, setShowRetakeModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [editingBio, setEditingBio] = useState(false);
    const [bioText, setBioText] = useState("");
    const [isExporting, setIsExporting] = useState(false);
    const [stats, setStats] = useState({
        totalAssigned: 0,
        completed: 0,
        failed: 0,
        active: 0,
    });

    useEffect(() => {
        console.log("Loading staff profile for ID:", id);
        loadStaffProfile();
    }, [id]);

    const loadStaffProfile = async () => {
        try {
            // Debug: Check if we can access users table at all
            const { data: allUsers, error: allUsersError } = await supabase
                .from("users")
                .select("id, full_name, email, role")
                .limit(5);

            console.log("All users (first 5):", allUsers);
            console.log("All users error:", allUsersError);

            // First try with all columns, fallback to basic columns if some don't exist
            let { data: staffData, error: staffError } = await supabase
                .from("users")
                .select("id, full_name, email, role, bio, competencies, strengths, weaknesses")
                .eq("id", id)
                .single();

            // If error due to missing columns, try with basic columns only
            if (staffError && staffError.message?.includes('column')) {
                console.log("Trying with basic columns only...");
                const result = await supabase
                    .from("users")
                    .select("id, full_name, email, role")
                    .eq("id", id)
                    .single();

                staffData = result.data ? {
                    ...result.data,
                    bio: null,
                    competencies: null,
                    strengths: null,
                    weaknesses: null
                } : null;
                staffError = result.error;
            }

            console.log("Staff data:", staffData);
            console.log("Staff error:", staffError);

            if (staffError) {
                console.error("Error loading staff:", staffError);
                setLoading(false);
                return;
            }

            if (!staffData) {
                console.error("No staff data found for id:", id);
                setLoading(false);
                return;
            }

            setStaff(staffData);
            setBioText(staffData?.bio || "");

            // Get all assignments for this worker
            const { data: assignmentsData, error: assignmentsError } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    course_id,
                    status,
                    assigned_at,
                    progress_percentage,
                    courses(title, objectives, pass_mark)
                `)
                .eq("worker_id", id)
                .order("assigned_at", { ascending: false });

            console.log("Assignments data:", assignmentsData);
            console.log("Assignments error:", assignmentsError);

            // Get all completions for this worker  
            const { data: completionsData, error: completionsError } = await supabase
                .from("course_completions")
                .select("id, course_id, quiz_score")
                .eq("worker_id", id);

            console.log("Completions data:", completionsData);
            console.log("Completions error:", completionsError);

            // Match completions to assignments
            const assignmentsWithCompletions = (assignmentsData || []).map((assignment: any) => {
                const completion = completionsData?.find(c => c.course_id === assignment.course_id);
                return {
                    ...assignment,
                    completion: completion || null,
                    progress_percentage: assignment.progress_percentage || 0,
                    course: {
                        title: assignment.courses?.title || "Unknown Course",
                        difficulty: (assignment.courses?.objectives as any)?.difficulty || "Beginner",
                        pass_mark: assignment.courses?.pass_mark || 80,
                    }
                };
            });

            console.log("Assignments with completions:", assignmentsWithCompletions);

            setAssignments(assignmentsWithCompletions as any);

            // Calculate stats
            const totalAssigned = assignmentsWithCompletions.length;
            const completed = assignmentsWithCompletions.filter((a: any) => a.status === "completed").length;
            const failed = assignmentsWithCompletions.filter((a: any) => {
                const passMark = a.course.pass_mark;
                return a.status === 'failed' || (a.completion && a.completion.quiz_score < passMark);
            }).length;
            const active = assignmentsWithCompletions.filter((a: any) =>
                a.status === "not_started" || a.status === "in_progress"
            ).length;

            console.log("Calculated stats:", { totalAssigned, completed, failed, active });

            setStats({ totalAssigned, completed, failed, active });
            setLoading(false);
        } catch (error) {
            console.error("Error loading staff profile:", error);
            setLoading(false);
        }
    };

    const filteredAssignments = searchQuery
        ? assignments.filter(a =>
            (a.course as any)?.title?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : assignments;

    const getProgressPercentage = (assignment: CourseAssignment) => {
        // Use actual progress_percentage from database
        return assignment.progress_percentage || 0;
    };

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map(n => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    const handleAssignRetake = async (assignment: CourseAssignment) => {
        try {
            // 1. Delete existing completion record to clear "failed" status
            const { error: deleteError } = await supabase
                .from("course_completions")
                .delete()
                .eq("worker_id", id)
                .eq("course_id", assignment.course_id);

            if (deleteError) throw deleteError;

            // 2. Reset assignment
            const deadline = new Date();
            deadline.setDate(deadline.getDate() + 30);

            const { error: updateError } = await supabase
                .from("course_assignments")
                .upsert({
                    course_id: assignment.course_id,
                    worker_id: id,
                    status: "not_started",
                    assigned_at: new Date().toISOString(),
                    deadline: deadline.toISOString(),
                    progress_percentage: 0,
                }, {
                    onConflict: 'course_id, worker_id'
                });

            if (updateError) throw updateError;

            // 3. Refresh
            loadStaffProfile();
        } catch (error) {
            console.error("Error assigning retake:", error);
            alert("Failed to assign retake");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!staff) return <div className="p-8 text-center">Staff member not found</div>;

    return (
        <div className="min-h-screen bg-white p-8">
            <AssignRetakeModal
                isOpen={showRetakeModal}
                onClose={() => setShowRetakeModal(false)}
                workerId={id}
                onAssignComplete={() => loadStaffProfile()}
            />
            <AssignCourseModal
                isOpen={showAssignModal}
                onClose={() => setShowAssignModal(false)}
                workerId={id}
                onAssignComplete={() => loadStaffProfile()}
            />

            <div className="max-w-7xl mx-auto">
                <div className="flex items-center gap-2 text-slate-600 mb-6">
                    <button
                        onClick={() => router.push("/admin/staff")}
                        className="flex items-center gap-1 hover:text-slate-900"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Go Back</span>
                    </button>
                    <span className="text-slate-400">/</span>
                    <span className="text-slate-400">Staff Details</span>
                    <span className="text-slate-400">/</span>
                    <span className="text-blue-600 font-medium">Staff Profile</span>
                </div>
                {/* Profile Header */}
                <div className="flex mb-9 items-start gap-6">
                    <div className="w-full">
                        <div className="w-20 h-20 mb-5 rounded-full bg-slate-800 flex items-center justify-center text-white text-xl font-bold">
                        {getInitials(staff.full_name)}
                    </div>
                    <div className="flex justify-between w-full">
                         <div className=" gap-2">
                        <h1 className="text-2xl font-bold text-slate-900 mb-1">{staff.full_name}</h1>
                        <p className="text-slate-600 text-sm font-normal flex items-center gap-2 mb-2">
                            <User className="w-4 h-4" />
                            {staff.email}
                        </p>
                        <span className="inline-block px-3 py-1 bg-[#EAFDF5] text-[#59904B] text-sm font-medium rounded-[6px]">
                            {staff.role}
                        </span>
                    </div>
<div className="flex items-start gap-3">
                        <button
                            onClick={() => setShowRetakeModal(true)}
                            className="px-4 py-2 bg-white border border-[#394CE6] text-[#394CE6] rounded-lg font-medium hover:bg-blue-50 transition-colors flex items-center gap-2"
                        >
                            Assign Retake
                        </button>
                        <button
                            onClick={() => setShowAssignModal(true)}
                            className="px-4 py-2 bg-[#394CE6] text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <UserPlus className="w-4 h-4" />
                            Assign Course
                        </button>
                    </div>
                    </div>


                   
                    </div>
                    
                </div>

                <div className="flex gap-8">

                    {/* Left Column - Profile & Details */}
                    <div style={{boxShadow: "0 1px 2px 0 #E4E5E73D"}} className="lg:col-span-1 border border-[#EEEFF2] rounded-[17px] p-5 space-y-6">


                        {/* Bio Section */}
                        <div style={{boxShadow: "0 1px 2px 0 #E4E5E73D"}} className="bg-white rounded-[12px] border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-slate-900">Bio</h3>
                                <button
                                    onClick={() => setEditingBio(!editingBio)}
                                    className="text-slate-400 hover:text-slate-600"
                                >
                                    <Edit3 className="w-4 h-4" />
                                </button>
                            </div>
                            {editingBio ? (
                                <div className="space-y-3">
                                    <textarea
                                        value={bioText}
                                        onChange={(e) => setBioText(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        rows={4}
                                        placeholder="Add bio information..."
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                // Save bio logic here
                                                setEditingBio(false);
                                            }}
                                            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={() => {
                                                setBioText(staff?.bio || "");
                                                setEditingBio(false);
                                            }}
                                            className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-slate-700 leading-relaxed">
                                    {bioText || "3 years of experience in residential behavioral programs. I'm passionate about helping healthcare grow, improve their policies, and to raise venture capital through good policies."}
                                </p>
                            )}
                        </div>

                        {/* Background Section */}
                        <div style={{boxShadow: "0 1px 2px 0 #E4E5E73D"}} className="bg-white rounded-[12px] border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-slate-900">Background</h3>
                                <button className="text-slate-400 hover:text-slate-600">
                                    <Edit3 className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="space-y-6">
                                {/* Competencies */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Award className="w-4 h-4 text-slate-600" />
                                        <span className="font-medium text-slate-900">Competencies</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">Client Safety & Emergency Response</span>
                                        <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">Documentation Accuracy</span>
                                        <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">Infection Control</span>
                                    </div>
                                </div>

                                {/* Strength */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Zap className="w-4 h-4 text-slate-600" />
                                        <span className="font-medium text-slate-900">Strength</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">Teamwork</span>
                                        <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">Communication</span>
                                    </div>
                                    <p className="text-sm text-slate-600 mt-2">Excellent documentation and ethical practice.</p>
                                </div>

                                {/* Weakness */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <AlertTriangle className="w-4 h-4 text-slate-600" />
                                        <span className="font-medium text-slate-900">Weakness</span>
                                    </div>
                                    <p className="text-sm text-slate-600">Needs improvement in emergency procedures and infection control.</p>
                                </div>
                            </div>
                        </div>

                        {/* Courses Section */}
                <div className="mt-8">

                    <div style={{boxShadow: "0 1px 2px 0 #E4E5E73D"}} className="bg-white rounded-[12px] border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-200">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-bold text-slate-900">Courses</h2>
                                <div className="flex items-center gap-4">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search for courses..."
                                            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                                        />
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (isExporting) return; // Prevent multiple clicks

                                            setIsExporting(true);
                                            try {
                                                const response = await fetch(`/api/staff/${id}/performance-pdf`);
                                                if (response.ok) {
                                                    const blob = await response.blob();
                                                    const url = window.URL.createObjectURL(blob);
                                                    const a = document.createElement('a');
                                                    a.href = url;
                                                    a.download = `Staff_Performance_${staff?.full_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
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
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Name</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Progress</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Quiz Status</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filteredAssignments.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-12 text-center text-slate-600">
                                                No course assignments found
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredAssignments.map((assignment) => {
                                            const completion = (assignment as any).completion;
                                            const passMark = (assignment.course as any).pass_mark || 80;
                                            // Check if passed based on score
                                            const passed = completion && completion.quiz_score >= passMark;
                                            // Check if failed (either status is failed OR completion exists but score < passMark)
                                            const failed = assignment.status === 'failed' || (completion && !passed);


                                            return (
                                                <tr key={assignment.id} className="hover:bg-white">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                                                                <BookOpen className="w-5 h-5 text-white" />
                                                            </div>
                                                            <div>
                                                                <p className="font-medium text-slate-900">{(assignment.course as any)?.title || "HIPAA Privacy Training"}</p>
                                                                <p className="text-sm text-slate-500">{(assignment.course as any)?.difficulty || "Advanced"}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="w-full">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-sm text-slate-600">{assignment.progress_percentage || 0}%</span>
                                                            </div>
                                                            <div className="w-full bg-gray-200 rounded-full h-2">
                                                                <div
                                                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                                                    style={{ width: `${assignment.progress_percentage || 0}%` }}
                                                                ></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {completion ? (
                                                            passed ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                                    <CheckCircle className="w-3 h-3" />
                                                                    Pass
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                                    <XCircle className="w-3 h-3" />
                                                                    Failed
                                                                </span>
                                                            )
                                                        ) : failed ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                                <XCircle className="w-3 h-3" />
                                                                Failed
                                                            </span>
                                                        ) : (
                                                            <span className="text-sm text-slate-400">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {failed ? (
                                                            <button
                                                                onClick={() => handleAssignRetake(assignment)}
                                                                className="px-3 py-1 bg-white border border-red-200 text-red-600 rounded text-sm font-medium hover:bg-red-50 transition-colors"
                                                            >
                                                                Assign Retake
                                                            </button>
                                                        ) : passed ? (
                                                            <button
                                                                onClick={() => router.push(`/admin/courses/${assignment.course_id}/quiz-results/${completion.id}`)}
                                                                className="px-3 py-1 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors"
                                                            >
                                                                View Result
                                                            </button>
                                                        ) : (
                                                            <span className="text-sm text-slate-400">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors">
                                                            View
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
                </div>
                    </div>

                    {/* Right Column - Stats */}
                    <div className="space-y-4 w-[40%]">
                        <div className="bg-[#E9ECF9] rounded-[12px] p-4 border border-[#9BA7E3]">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                                    <BookOpen className="w-4 h-4 text-white" />
                                </div>
                                <div>
<span className="text-sm text-blue-700 font-medium">Total Courses Assigned</span>
<p className="text-2xl font-bold text-blue-900">{stats.totalAssigned}</p>
                                </div>
                                
                            </div>
                            
                        </div>

                        <div className="bg-[#E9F9F2] rounded-[12px] p-4 border border-[#9BE3C2]">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                                    <CheckCircle className="w-4 h-4 text-white" />
                                </div>
                                <span className="text-sm text-green-700 font-medium">Courses Completed</span>
                            </div>
                            <p className="text-2xl font-bold text-green-900">{stats.completed}</p>
                        </div>

                        <div className="bg-[#F9E9E9] rounded-[12px] p-4 border border-[#E39B9B]">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                                    <XCircle className="w-4 h-4 text-white" />
                                </div>
                                <span className="text-sm text-red-700 font-medium">Failed / Retake Needed</span>
                            </div>
                            <p className="text-2xl font-bold text-red-900">{stats.failed}</p>
                        </div>

                        <div className="bg-[#FFFAD5] rounded-[12px] p-4 border border-[#E39B9B]">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 bg-yellow-600 rounded-lg flex items-center justify-center">
                                    <Clock className="w-4 h-4 text-white" />
                                </div>
                                <span className="text-sm text-yellow-700 font-medium">Active / Due Soon</span>
                            </div>
                            <p className="text-2xl font-bold text-yellow-900">{stats.active}</p>
                        </div>
                    </div>
                </div>

                
            </div>
        </div>
    );
}
