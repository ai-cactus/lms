"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { WorkerStatsCards } from "@/components/worker/worker-stats-cards";
import { WorkerCoursesTable } from "@/components/worker/worker-courses-table";
import { OnboardingModal } from "@/components/training-center/onboarding-modal";
import {
    BookOpen,
    ShieldCheck,
    FirstAid,
    Clock,
    TrendUp
} from "@phosphor-icons/react";

interface Course {
    id: string;
    course_id: string;
    deadline: string;
    courses: {
        title: string;
        objectives?: any;
    };
}

interface WorkerStats {
    totalCourses: number;
    coursesCompleted: number;
    averageGrade: number;
}

interface WorkerCourse {
    id: string;
    name: string;
    level: string;
    progress: number;
    deadline: string;
    status: 'not-started' | 'in-progress' | 'completed';
    grade?: number | null;
}

function WorkerDashboardContent() {
    const [inProgressCourses, setInProgressCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [stats, setStats] = useState<WorkerStats>({
        totalCourses: 0,
        coursesCompleted: 0,
        averageGrade: 0
    });
    const [workerCourses, setWorkerCourses] = useState<WorkerCourse[]>([]);
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    useEffect(() => {
        loadInProgressCourses();
        checkOnboardingStatus();
    }, []);

    // Check for refresh parameter and reload data
    useEffect(() => {
        if (searchParams.get('refresh') === 'true') {
            loadInProgressCourses();
            // Clean up URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('refresh');
            window.history.replaceState({}, '', newUrl.toString());
        }
    }, [searchParams]);

    const checkOnboardingStatus = () => {
        const hasSeenWelcome = localStorage.getItem("theraptly-welcome-seen");
        if (!hasSeenWelcome) {
            setShowOnboarding(true);
        }
    };

    const loadInProgressCourses = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get all course assignments for the worker
            const { data: assignmentsData, error } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    course_id,
                    deadline,
                    status,
                    progress_percentage,
                    courses(title, objectives)
                `)
                .eq("worker_id", user.id)
                .order("deadline", { ascending: true });

            if (error) throw error;

            // Normalize data
            const normalizedData = (assignmentsData || []).map((a: any) => ({
                ...a,
                courses: Array.isArray(a.courses) ? a.courses[0] : a.courses,
            }));

            setInProgressCourses(normalizedData);

            // Hide onboarding banner once any course has been started (status is not 'not-started')
            if (normalizedData.some(assignment => assignment.status !== 'not-started')) {
                localStorage.setItem("theraptly-welcome-seen", "true");
            }

            // Calculate stats
            const totalCourses = normalizedData.length;
            const completedCourses = normalizedData.filter(c => c.status === 'completed' || c.status === 'failed').length;

            // Fetch scores for all assignments to populate grades and calculate average
            const scoreMap: { [key: string]: number | null } = {};
            let totalScore = 0;
            let scoreCount = 0;

            for (const assignment of normalizedData) {
                try {
                    // Try to get score from course_completions first (try both course_id and assignment_id)
                    let completion = null;
                    try {
                        const { data } = await supabase
                            .from("course_completions")
                            .select("quiz_score")
                            .eq("course_id", assignment.course_id)
                            .eq("worker_id", assignment.worker_id)
                            .single();
                        completion = data;
                    } catch {
                        // Try with assignment_id
                        try {
                            const { data } = await supabase
                                .from("course_completions")
                                .select("quiz_score")
                                .eq("assignment_id", assignment.id)
                                .single();
                            completion = data;
                        } catch {
                            // Ignore
                        }
                    }

                    let score = null;
                    if (completion?.quiz_score && completion.quiz_score > 0) {
                        score = completion.quiz_score;
                    } else {
                        // Fallback to quiz_attempts
                        try {
                            const { data: attempt } = await supabase
                                .from("quiz_attempts")
                                .select("score")
                                .eq("course_id", assignment.course_id)
                                .eq("worker_id", assignment.worker_id)
                                .order("completed_at", { ascending: false })
                                .limit(1)
                                .single();

                            if (attempt?.score && attempt.score > 0) {
                                score = attempt.score;
                            }
                        } catch {
                            // Try with assignment_id
                            try {
                                const { data: attempt } = await supabase
                                    .from("quiz_attempts")
                                    .select("score")
                                    .eq("assignment_id", assignment.id)
                                    .order("completed_at", { ascending: false })
                                    .limit(1)
                                    .single();

                                if (attempt?.score && attempt.score > 0) {
                                    score = attempt.score;
                                }
                            } catch {
                                // Ignore
                            }
                        }
                    }

                    scoreMap[assignment.id] = score;
                    if (score !== null && (assignment.status === 'completed' || assignment.status === 'failed')) {
                        totalScore += score;
                        scoreCount++;
                    }
                } catch (error) {
                    console.error(`Error fetching score for assignment ${assignment.id}:`, error);
                    scoreMap[assignment.id] = null;
                }
            }

            const averageGrade = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

            setStats({
                totalCourses,
                coursesCompleted: completedCourses,
                averageGrade
            });

            // Transform data for the courses table (show all courses)
            const transformedCourses: WorkerCourse[] = normalizedData.map((assignment: any) => {
                // Use actual progress_percentage from database, fallback to status-based calculation
                const progress = assignment.progress_percentage !== null && assignment.progress_percentage !== undefined
                    ? assignment.progress_percentage
                    : (assignment.status === 'completed' ? 100 :
                       assignment.status === 'in_progress' ? 50 : 0); // Default 50% for in-progress if no specific progress
                
                return {
                    id: assignment.id,
                    name: assignment.courses?.title || 'Untitled Course',
                    level: 'Advanced', // Default level
                    progress,
                    deadline: new Date(assignment.deadline).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    }),
                    status: assignment.status as 'not-started' | 'in-progress' | 'completed',
                    grade: scoreMap[assignment.id] || null
                };
            });

            setWorkerCourses(transformedCourses);
            setLoading(false);
        } catch (error) {
            console.error("Error loading courses:", error);
            setLoading(false);
        }
    };

    const getCourseIcon = (title: string) => {
        const lowerTitle = title.toLowerCase();

        // HIPAA and Privacy
        if (lowerTitle.includes("hipaa") || lowerTitle.includes("privacy")) {
            return <ShieldCheck className="w-10 h-10 text-indigo-600" weight="fill" />;
        }

        // Safety, First Aid, Emergency
        if (lowerTitle.includes("safety") || lowerTitle.includes("first aid") || lowerTitle.includes("emergency") || lowerTitle.includes("cpr")) {
            return <FirstAid className="w-10 h-10 text-red-600" weight="fill" />;
        }

        // Compliance, Ethics, Policy, Regulatory
        if (lowerTitle.includes("compliance") || lowerTitle.includes("ethics") || lowerTitle.includes("policy") || lowerTitle.includes("regulatory")) {
            return <ShieldCheck className="w-10 h-10 text-green-600" weight="fill" />;
        }

        // Default: Book icon for general training
        return <BookOpen className="w-10 h-10 text-blue-600" weight="fill" />;
    };

    const getDescription = (objectives: any) => {
        if (Array.isArray(objectives) && objectives.length > 0) {
            // Try to get the first objective with meaningful text
            const meaningfulObjective = objectives.find(obj => obj?.text && obj.text.length > 20);
            if (meaningfulObjective) {
                return meaningfulObjective.text;
            }
            // Fallback to first objective if exists
            if (objectives[0]?.text) {
                return objectives[0].text;
            }
        }
        return "Continue your training progress with this course.";
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading your courses...</div>
            </div>
        );
    }

    // Show onboarding modal for first-time workers
    if (showOnboarding) {
        return (
            <div className="p-8">
                <OnboardingModal 
                    onClose={() => {
                        setShowOnboarding(false);
                        localStorage.setItem("theraptly-welcome-seen", "true");
                    }} 
                    userRole="worker" 
                />
            </div>
        );
    }

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Dashboard</h1>
                <p className="text-slate-600">Here is an overview of your courses</p>
            </div>

            {/* Stats Cards */}
            <WorkerStatsCards stats={stats} />

            {/* Courses Table */}
            <WorkerCoursesTable courses={workerCourses} />
        </div>
    );
}

export default function WorkerDashboardPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading your courses...</div>
            </div>
        }>
            <WorkerDashboardContent />
        </Suspense>
    );
}
