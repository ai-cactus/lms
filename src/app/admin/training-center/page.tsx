"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OnboardingModal } from "@/components/training-center/onboarding-modal";
import { StatsCards } from "@/components/training-center/stats-cards";
import { CoursesTable } from "@/components/training-center/courses-table";
import { PerformanceChart } from "@/components/training-center/performance-chart";
import { TrainingCoverageChart } from "@/components/training-center/training-coverage-chart";
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
    const [userRole, setUserRole] = useState<'admin' | 'worker'>('admin');
    const [performanceData, setPerformanceData] = useState<number[]>([
        65, 35, 80, 55, 70, 60, 55, 100, 75, 45, 70, 50
    ]);
    const [coverageData, setCoverageData] = useState({
        completed: 30,
        inProgress: 34,
        notStarted: 36
    });
    // Show onboarding modal (for testing - always show)
    // TODO: Change back to courseCount === 0 for production
    const [showOnboarding, setShowOnboarding] = useState(true);
    const supabase = createClient();

    const fetchTrainingData = async () => {
        try {
            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setLoading(false);
                return;
            }

            // Get user's organization and role
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id, role")
                .eq("id", user.id)
                .single();

            if (!userData) {
                setLoading(false);
                return;
            }

            const orgId = userData.organization_id;
            setUserRole(userData.role === 'admin' ? 'admin' : 'worker');

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

            // Fetch training stats
            const { data: statsData } = await supabase
                .from("courses")
                .select("id")
                .eq("organization_id", orgId);

            const totalCourses = statsData?.length || 0;

            // Get staff count (users with role 'worker' in the organization)
            const { count: staffCount } = await supabase
                .from("users")
                .select("*", { count: "exact", head: true })
                .eq("organization_id", orgId)
                .eq("role", "worker");

            // Calculate average grade from course assignments
            const { data: gradesData } = await supabase
                .from("course_assignments")
                .select("final_grade")
                .not("final_grade", "is", null);

            let averageGrade = 0;
            if (gradesData && gradesData.length > 0) {
                const totalGrades = gradesData.reduce((sum, item) => sum + (item.final_grade || 0), 0);
                averageGrade = Math.round(totalGrades / gradesData.length);
            }

            setStats({
                totalCourses,
                totalStaffAssigned: staffCount || 0,
                averageGrade,
            });

            // Fetch performance data for charts
            await fetchPerformanceData(orgId);
            await fetchCoverageData(orgId);

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

    useEffect(() => {
        fetchTrainingData();
    }, []);

    // Refetch data when page becomes visible (e.g., when navigating back to dashboard)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                fetchTrainingData();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    const fetchPerformanceData = async (orgId: string) => {
        try {
            // Get monthly performance data from course assignments
            const { data: performanceData } = await supabase
                .from("course_assignments")
                .select("final_grade, created_at")
                .not("final_grade", "is", null)
                .gte("created_at", new Date(new Date().getFullYear(), 0, 1).toISOString());

            // Group by month and calculate averages
            const monthlyData = new Array(12).fill(0);
            const monthlyCounts = new Array(12).fill(0);

            performanceData?.forEach(item => {
                const month = new Date(item.created_at).getMonth();
                monthlyData[month] += item.final_grade || 0;
                monthlyCounts[month]++;
            });

            // Calculate averages for each month
            const averages = monthlyData.map((total, index) => 
                monthlyCounts[index] > 0 ? Math.round(total / monthlyCounts[index]) : 0
            );

            setPerformanceData(averages);
        } catch (error) {
            console.error("Error fetching performance data:", error);
            // Use fallback data
            setPerformanceData([65, 35, 80, 55, 70, 60, 55, 100, 75, 45, 70, 50]);
        }
    };

    const fetchCoverageData = async (orgId: string) => {
        try {
            // Get total staff count
            const { count: totalStaff } = await supabase
                .from("users")
                .select("*", { count: "exact", head: true })
                .eq("organization_id", orgId)
                .eq("role", "worker");

            if (!totalStaff || totalStaff === 0) {
                setCoverageData({ completed: 0, inProgress: 0, notStarted: 100 });
                return;
            }

            // First get all worker IDs in the organization
            const { data: workers } = await supabase
                .from("users")
                .select("id")
                .eq("organization_id", orgId)
                .eq("role", "worker");

            const workerIds = workers?.map(w => w.id) || [];

            // Get assignment statuses for these workers
            const { data: assignments } = await supabase
                .from("course_assignments")
                .select("status, worker_id")
                .in("worker_id", workerIds);

            // Count unique workers by status
            const workerStatuses = new Map();
            assignments?.forEach(assignment => {
                const workerId = assignment.worker_id;
                const currentStatus = workerStatuses.get(workerId);
                
                // Priority: completed > in_progress > not_started
                if (!currentStatus || 
                    (assignment.status === 'completed' && currentStatus !== 'completed') ||
                    (assignment.status === 'in_progress' && currentStatus === 'not_started')) {
                    workerStatuses.set(workerId, assignment.status);
                }
            });

            const completed = Array.from(workerStatuses.values()).filter(s => s === 'completed').length;
            const inProgress = Array.from(workerStatuses.values()).filter(s => s === 'in_progress').length;
            const notStarted = totalStaff - completed - inProgress;

            setCoverageData({
                completed: Math.round((completed / totalStaff) * 100),
                inProgress: Math.round((inProgress / totalStaff) * 100),
                notStarted: Math.round((notStarted / totalStaff) * 100)
            });
        } catch (error) {
            console.error("Error fetching coverage data:", error);
            // Use fallback data
            setCoverageData({ completed: 30, inProgress: 34, notStarted: 36 });
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

    // Show onboarding modal when no courses exist
    if (courseCount === 0) {
        return (
            <div className="p-8">
                <OnboardingModal onClose={() => setShowOnboarding(false)} userRole={userRole} />
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

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <PerformanceChart data={performanceData} />
                <TrainingCoverageChart data={coverageData} />
            </div>

            {/* Courses Table */}
            <CoursesTable courses={courses} />
        </div>
    );
}
