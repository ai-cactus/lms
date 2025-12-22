"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen,
    CheckCircle,
    Clock
} from "lucide-react";

interface Assignment {
    id: string;
    course_id: string;
    deadline: string;
    status: string;
    course: {
        title: string;
    };
    // completed_at removed as it doesn't exist
}

type TabType = 'assigned' | 'completed';

export default function WorkerCoursesPage() {
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('assigned');
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadDashboardData();
    }, []);

    const handleRejectCourse = async (assignmentId: string) => {
        try {
            // Since 'rejected' status doesn't exist, we'll delete the assignment
            const { error } = await supabase
                .from("course_assignments")
                .delete()
                .eq("id", assignmentId);

            if (error) {
                console.error("Error deleting course assignment:", error);
                throw error;
            }

            // Reload the data to reflect the change
            await loadDashboardData();
        } catch (error) {
            console.error("Error rejecting course:", error);
        }
    };

    const loadDashboardData = async () => {
        try {
            console.log("Loading courses data...");
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            console.log("Auth result:", { user, authError });

            if (!user) {
                console.log("No user found, redirecting to login");
                router.push("/login");
                return;
            }

            console.log("User authenticated:", user.id);

            // Get ALL assignments for this user first (for debugging)
            const { data: allAssignments, error: allError } = await supabase
                .from("course_assignments")
                .select(`
                  id,
                  course_id,
                  deadline,
                  status,
                  courses(title)
                `)
                .eq("worker_id", user.id);

            console.log("ALL assignments for user:", allAssignments);
            console.log("All assignments error:", allError);

            // Get active assignments (including failed ones so they can see results)
            const { data: activeData, error: activeError } = await supabase
                .from("course_assignments")
                .select(`
                  id,
                  course_id,
                  deadline,
                  status,
                  courses(title, objectives)
                `)
                .eq("worker_id", user.id)
                .in("status", ["not_started", "in_progress", "overdue"])
                .order("deadline", { ascending: true });

            console.log("Active query result:", activeData);
            console.log("Active query error:", activeError);

            if (activeError) {
                console.error("Error fetching active assignments:", activeError);
                throw activeError;
            }

            // Get completed assignments (both completed and failed)
            const { data: completedData, error: completedError } = await supabase
                .from("course_assignments")
                .select(`
                  id,
                  course_id,
                  status,
                  courses(title, objectives),
                  deadline
                `)
                .eq("worker_id", user.id)
                .in("status", ["completed", "failed"])
                .order("deadline", { ascending: false }); // Fallback to deadline for sorting

            console.log("Completed query result:", completedData);
            console.log("Completed query error:", completedError);

            if (completedError) {
                console.error("Error fetching completed assignments:", completedError);
                throw completedError;
            }

            // Normalize and merge data
            const normalizedActive = (activeData || []).map((item: any) => ({
                ...item,
                course: Array.isArray(item.courses) ? item.courses[0] : item.courses
            }));

            const normalizedCompleted = (completedData || []).map((item: any) => ({
                ...item,
                course: Array.isArray(item.courses) ? item.courses[0] : item.courses
            }));

            console.log("Active assignments:", normalizedActive);
            console.log("Completed assignments:", normalizedCompleted);
            console.log("Total assignments to set:", [...normalizedActive, ...normalizedCompleted].length);

            setAssignments([...normalizedActive, ...normalizedCompleted]);
        } catch (error) {
            console.error("Error loading courses:", error);
            console.error("Error details:", JSON.stringify(error, null, 2));
        } finally {
            setLoading(false);
        }
    };


    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-[#4758E0] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    // Filter assignments based on active tab
    const getFilteredAssignments = () => {
        if (activeTab === 'assigned') {
            return assignments.filter(assignment => assignment.status !== "completed" && assignment.status !== "failed");
        } else {
            return assignments.filter(assignment => assignment.status === "completed" || assignment.status === "failed");
        }
    };

    const filteredAssignments = getFilteredAssignments();

    return (
        <div className="p-8 mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">My Courses</h1>
            </div>

            {/* Tab Navigation */}
            <div className="mb-6">
                <div className="border-b border-gray-200">
                    <nav className="-mb-px flex space-x-8">
                        <button
                            onClick={() => setActiveTab('assigned')}
                            className={`py-2 px-1 border-b-2 font-medium text-sm ${
                                activeTab === 'assigned'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Assigned Courses
                                {assignments.filter(a => a.status !== "completed" && a.status !== "failed").length > 0 && (
                                    <span className="ml-1 bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                                        {assignments.filter(a => a.status !== "completed" && a.status !== "failed").length}
                                    </span>
                                )}
                            </div>
                        </button>
                        <button
                            onClick={() => setActiveTab('completed')}
                            className={`py-2 px-1 border-b-2 font-medium text-sm ${
                                activeTab === 'completed'
                                    ? 'border-green-500 text-green-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" />
                                Completed Courses
                                {assignments.filter(a => a.status === "completed" || a.status === "failed").length > 0 && (
                                    <span className="ml-1 bg-green-100 text-green-600 text-xs px-2 py-0.5 rounded-full">
                                        {assignments.filter(a => a.status === "completed" || a.status === "failed").length}
                                    </span>
                                )}
                            </div>
                        </button>
                    </nav>
                </div>
            </div>

            <div style={{border: "1px solid #DFE1E6", borderRadius:'17px', boxShadow: "0 1px 2px 0 #E4E5E73D", padding: "0px 14px"}} className="space-y-4">
                {filteredAssignments.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-500">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            {activeTab === 'assigned' ? (
                                <BookOpen className="w-8 h-8 text-gray-400" />
                            ) : (
                                <CheckCircle className="w-8 h-8 text-gray-400" />
                            )}
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 mb-1">
                            {activeTab === 'assigned' ? 'No courses assigned' : 'No completed courses'}
                        </h3>
                        <p>
                            {activeTab === 'assigned'
                                ? "You don't have any courses assigned to you yet."
                                : "You haven't completed any courses yet."
                            }
                        </p>
                    </div>
                ) : (
                    filteredAssignments.map((assignment) => (
                        <div key={assignment.id} style={{borderBottom: "1px dotted #DFE1E6"}} className="bg-white p-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                                        activeTab === 'assigned' ? 'bg-[#0D25FF]' : 'bg-green-500'
                                    }`}>
                                        {activeTab === 'assigned' ? (
                                            <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path fillRule="evenodd" clipRule="evenodd" d="M20.0695 2.63179e-07V6.02085V20.0695H14.0487V13.0485C14.0468 16.9264 10.9027 20.0695 7.02433 20.0695C3.1449 20.0695 0 16.9246 0 13.0452C0 9.16575 3.1449 6.02085 7.02433 6.02085C10.9027 6.02085 14.0468 9.16395 14.0487 13.0419V6.02085H7.02433H0V2.63179e-07L14.0487 0L20.0695 2.63179e-07Z" fill="white"/>
                                            </svg>
                                        ) : (
                                            <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path fillRule="evenodd" clipRule="evenodd" d="M10.5 0C4.70101 0 0 4.70101 0 10.5C0 16.299 4.70101 21 10.5 21C16.299 21 21 16.299 21 10.5C21 4.70101 16.299 0 10.5 0ZM15.435 8.565L9.435 14.565C9.18348 14.8165 8.84152 14.8165 8.59 14.565L5.565 11.535C5.31348 11.2835 5.31348 10.9415 5.565 10.69C5.81652 10.4385 6.15848 10.4385 6.41 10.69L9 13.275L14.58 7.695C14.8315 7.44348 15.1735 7.44348 15.425 7.695C15.6765 7.94652 15.6765 8.28848 15.425 8.54L15.435 8.565Z" fill="white"/>
                                            </svg>
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-slate-900 mb-1">
                                            {assignment.course?.title || "Untitled Course"}
                                        </h3>
                                        <p className="text-sm text-slate-500">
                                            Beginner • {
                                                activeTab === 'assigned'
                                                    ? (assignment.status === 'not_started' ? 'Not Started' : assignment.status === 'in_progress' ? 'In Progress' : 'Active')
                                                    : (assignment.status === 'completed' ? 'Completed' : 'Failed')
                                            }
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {activeTab === 'assigned' ? (
                                        <>
                                            <button
                                                onClick={() => router.push(`/worker/courses/${assignment.id}/details`)}
                                                className="px-6 py-2 bg-[#4758E0] text-white text-sm font-medium rounded-lg hover:bg-[#4758E0]/90 transition-colors"
                                            >
                                                {assignment.status === 'not_started' ? 'Start Course' : 'Continue Course'}
                                            </button>
                                            {assignment.status === 'not_started' && (
                                                <button
                                                    onClick={() => handleRejectCourse(assignment.id)}
                                                    className="px-6 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
                                                >
                                                    Reject
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => router.push(`/worker/quiz/${assignment.id}?view=results`)}
                                            className="px-6 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                                        >
                                            View Results
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
