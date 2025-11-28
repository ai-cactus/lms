"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OnboardingModal } from "@/components/training-center/onboarding-modal";
import { StatsCards } from "@/components/training-center/stats-cards";
import { CoursesTable } from "@/components/training-center/courses-table";
import Link from "next/link";
import { Plus } from "lucide-react";

interface TrainingStats {
    totalCourses: number;
    totalStaffAssigned: number;
    averageGrade: number;
}

interface Course {
    id: string;
    title: string;
    level: string;
    assignedStaff: number;
    completion: number;
    dateCreated: string;
}

export default function TrainingCenterPage() {
    const [loading, setLoading] = useState(true);
    const [courseCount, setCourseCount] = useState(0);
    const [stats, setStats] = useState<TrainingStats>({
        totalCourses: 0,
        totalStaffAssigned: 0,
        averageGrade: 0,
    });
    const [courses, setCourses] = useState<Course[]>([]);
    const supabase = createClient();

    useEffect(() => {
        fetchTrainingData();
    }, []);

    // Refetch data when page becomes visible (e.g., when navigating back to dashboard)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && !loading) {
                fetchTrainingData();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [loading]);

    const fetchTrainingData = async () => {
        try {
            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setLoading(false);
                return;
            }

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) {
                setLoading(false);
                return;
            }

            const orgId = userData.organization_id;

            // Fetch course count
            const { count } = await supabase
                .from("courses")
                .select("*", { count: "exact", head: true })
                .eq("organization_id", orgId);

            setCourseCount(count || 0);

            // If no courses, stop here (empty state)
            if (!count || count === 0) {
                setLoading(false);
                return;
            }

            // Fetch recent courses for the table
            const { data: coursesData } = await supabase
                .from("courses")
                .select(`
                    id,
                    title,
                    objectives,
                    created_at
                `)
                .eq("organization_id", orgId)
                .order("created_at", { ascending: false })
                .limit(5);

            // For each course, count assignments and calculate completion
            const coursesWithStats = await Promise.all(
                (coursesData || []).map(async (course) => {
                    // Count total assignments
                    const { count: assignmentsCount } = await supabase
                        .from("course_assignments")
                        .select("*", { count: "exact", head: true })
                        .eq("course_id", course.id);

                    // Count completed assignments
                    const { count: completedCount } = await supabase
                        .from("course_completions")
                        .select("*", { count: "exact", head: true })
                        .eq("course_id", course.id);

                    const completion = assignmentsCount
                        ? Math.round(((completedCount || 0) / assignmentsCount) * 100)
                        : 0;

                    // Extract difficulty from objectives JSONB
                    const difficulty = course.objectives?.difficulty || "Beginner";

                    return {
                        id: course.id,
                        title: course.title,
                        level: difficulty,
                        assignedStaff: assignmentsCount || 0,
                        completion,
                        dateCreated: new Date(course.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                        }),
                    };
                })
            );

            setCourses(coursesWithStats);

            // Calculate total staff assigned across all courses
            const totalAssigned = coursesWithStats.reduce(
                (sum, course) => sum + course.assignedStaff,
                0
            );

            // Calculate average completion
            const avgCompletion = coursesWithStats.length
                ? Math.round(
                    coursesWithStats.reduce((sum, course) => sum + course.completion, 0) /
                    coursesWithStats.length
                )
                : 0;

            setStats({
                totalCourses: count,
                totalStaffAssigned: totalAssigned,
                averageGrade: avgCompletion,
            });

            setLoading(false);
        } catch (error) {
            console.error("Error fetching training data:", error);
            setLoading(false);
        }
    };

    // Loading state
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading training center...</p>
                </div>
            </div>
        );
    }

    // Empty state - Show onboarding modal
    if (courseCount === 0) {
        return (
            <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50 p-4">
                <OnboardingModal />
            </div>
        );
    }

    // Active state - Show dashboard
    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <p className="text-sm text-slate-500 mb-1">Home / Training</p>
                    <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
                    <p className="text-slate-600 mt-1">Here is an overview of your courses</p>
                </div>
                <Link
                    href="/admin/courses/create"
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
                >
                    <Plus className="w-5 h-5" />
                    Create Course
                </Link>
            </div>

            {/* Stats Cards */}
            <StatsCards stats={stats} />

            {/* Courses Table */}
            <CoursesTable courses={courses} />
        </div>
    );
}
