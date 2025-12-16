"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    BookOpen
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

export default function WorkerCoursesPage() {
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
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
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get active assignments (including failed ones so they can see results)
            const { data: activeData, error: activeError } = await supabase
                .from("course_assignments")
                .select(`
                  id,
                  course_id,
                  deadline,
                  status,
                  courses(title)
                `)
                .eq("worker_id", user.id)
                .in("status", ["not_started", "in_progress", "overdue"])
                .order("deadline", { ascending: true });

            if (activeError) {
                console.error("Error fetching active assignments:", activeError);
                throw activeError;
            }

            // Get completed assignments
            const { data: completedData, error: completedError } = await supabase
                .from("course_assignments")
                .select(`
                  id,
                  course_id,
                  status,
                  courses(title),
                  deadline
                `)
                .eq("worker_id", user.id)
                .eq("status", "completed")
                .order("deadline", { ascending: false }); // Fallback to deadline for sorting

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

    return (
        <div className="p-8  mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Assigned Courses</h1>
            </div>

            <div style={{border: "1px solid #DFE1E6", borderRadius:'17px', boxShadow: "0 1px 2px 0 #E4E5E73D", padding: "0px 14px"}} className="space-y-4">
                {assignments.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-slate-500">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <BookOpen className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 mb-1">No courses assigned</h3>
                        <p>You don't have any courses assigned to you yet.</p>
                    </div>
                ) : (
                    assignments
                        .filter(assignment => assignment.status !== "completed" && assignment.status !== "failed")
                        .map((assignment) => (
                            <div key={assignment.id} style={{borderBottom: "1px dotted #DFE1E6"}} className="bg-white   p-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-[#0D25FF] rounded-lg flex items-center justify-center">
                                            <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path fillRule="evenodd" clipRule="evenodd" d="M20.0695 2.63179e-07V6.02085V20.0695H14.0487V13.0485C14.0468 16.9264 10.9027 20.0695 7.02433 20.0695C3.1449 20.0695 0 16.9246 0 13.0452C0 9.16575 3.1449 6.02085 7.02433 6.02085C10.9027 6.02085 14.0468 9.16395 14.0487 13.0419V6.02085H7.02433H0V2.63179e-07L14.0487 0L20.0695 2.63179e-07Z" fill="white"/>
                                            </svg>
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-semibold text-slate-900 mb-1">
                                                {assignment.course?.title || "Untitled Course"}
                                            </h3>
                                            <p className="text-sm text-slate-500">
                                                Beginner
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => router.push(`/worker/courses/${assignment.id}/details`)}
                                            className="px-6 py-2 bg-[#4758E0] text-white text-sm font-medium rounded-lg hover:bg-[#4758E0]/90 transition-colors"
                                        >
                                            Start Course
                                        </button>
                                        <button
                                            onClick={() => handleRejectCourse(assignment.id)}
                                            className="px-6 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                )}
            </div>
        </div>
    );
}
