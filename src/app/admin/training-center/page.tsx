"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OnboardingModal } from "@/components/training-center/onboarding-modal";
import { StatsCards } from "@/components/training-center/stats-cards";
import { PerformanceChart } from "@/components/training-center/performance-chart";
import { CoverageChart } from "@/components/training-center/coverage-chart";
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
    const [performanceData, setPerformanceData] = useState<number[]>(new Array(12).fill(0));
    const [coverageData, setCoverageData] = useState({
        completed: 0,
        enrolled: 0,
        notStarted: 0,
    });
    const supabase = createClient();

    useEffect(() => {
        fetchTrainingData();
    }, []);

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

            // Fetch all courses for this org
            const { data: allCourses } = await supabase
                .from("courses")
                .select("id")
                .eq("organization_id", orgId);

            const courseIds = allCourses?.map(c => c.id) || [];

            if (courseIds.length > 0) {
                // Fetch total workers in organization
                const { count: totalWorkers } = await supabase
                    .from("users")
                    .select("*", { count: "exact", head: true })
                    .eq("organization_id", orgId);

                // Fetch all assignments for these courses (for Coverage Chart & Stats)
                const { data: allAssignments } = await supabase
                    .from("course_assignments")
                    .select("worker_id, status")
                    .in("course_id", courseIds);

                // Fetch all completions for these courses (for Performance Chart)
                const { data: allCompletions } = await supabase
                    .from("course_completions")
                    .select("quiz_score, completed_at, worker_id")
                    .in("course_id", courseIds);

                // Calculate Coverage Data based on unique workers
                if (totalWorkers && totalWorkers > 0) {
                    // Count unique workers with assignments
                    const uniqueWorkersWithAssignments = new Set(
                        allAssignments?.map(a => a.worker_id) || []
                    ).size;

                    // Count unique workers who completed courses
                    const uniqueWorkersCompleted = new Set(
                        allCompletions?.map(c => c.worker_id) || []
                    ).size;

                    // Workers yet to begin = total workers - workers with assignments
                    const workersNotStarted = totalWorkers - uniqueWorkersWithAssignments;

                    setCoverageData({
                        completed: Math.round((uniqueWorkersCompleted / totalWorkers) * 100),
                        enrolled: Math.round((uniqueWorkersWithAssignments / totalWorkers) * 100),
                        notStarted: Math.round((workersNotStarted / totalWorkers) * 100),
                    });
                }

                // Calculate Performance Data (Monthly Average Scores)
                const monthlyScores: { [key: number]: number[] } = {};
                allCompletions?.forEach(c => {
                    const date = new Date(c.completed_at);
                    const month = date.getMonth(); // 0-11
                    if (!monthlyScores[month]) monthlyScores[month] = [];
                    monthlyScores[month].push(c.quiz_score);
                });

                const newPerformanceData = new Array(12).fill(0).map((_, index) => {
                    const scores = monthlyScores[index];
                    if (!scores || scores.length === 0) return 0;
                    const sum = scores.reduce((a, b) => a + b, 0);
                    return Math.round(sum / scores.length);
                });
                setPerformanceData(newPerformanceData);
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

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <PerformanceChart data={performanceData} />
                <CoverageChart data={coverageData} />
            </div>

            {/* Courses Table */}
            <CoursesTable courses={courses} />
        </div>
    );
}
