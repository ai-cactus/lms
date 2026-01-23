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

            // Hide onboarding banner once any course has been started (status is not 'not_started')
            // Note: DB status is 'not_started' (underscore), but frontend might use hyphen. Let's check DB value.
            // Actually the DB usually uses underscores 'not_started'.
            if (normalizedData.some(assignment => assignment.status !== 'not_started')) {
                localStorage.setItem("theraptly-welcome-seen", "true");
            }

            // Calculate stats
            const totalCourses = normalizedData.length;
            const completedCourses = normalizedData.filter(c => c.status === 'completed' || c.status === 'failed').length;

            // Fetch all scores in bulk to avoid N+1 queries
            const { data: allCompletions, error: completionsError } = await supabase
                .from("course_completions")
                .select("*")
                .eq("worker_id", user.id);

            if (completionsError) {
                console.error("Error fetching completions:", completionsError);
            }

            const { data: allAttempts, error: attemptsError } = await supabase
                .from("quiz_attempts")
                .select("*")
                .eq("worker_id", user.id)
                .order("completed_at", { ascending: false });

            if (attemptsError) {
                console.error("Error fetching attempts:", attemptsError);
            }

            console.log('All Completions:', allCompletions);
            console.log('All Attempts:', allAttempts);

            // Fetch scores for all assignments to populate grades and calculate average
            const scoreMap: { [key: string]: number | null } = {};
            let totalScore = 0;
            let scoreCount = 0;

            for (const assignment of normalizedData) {
                try {
                    let score = null;

                    // 1. Try to find in course_completions (Official Record)
                    const completion = allCompletions?.find(c =>
                        c.course_id === assignment.course_id || c.assignment_id === assignment.id
                    );

                    if (completion?.quiz_score != null) {
                        score = completion.quiz_score;
                    } else {
                        // 2. Fallback to quiz_attempts (Best/Latest Attempt)
                        const attempt = allAttempts?.find(a =>
                            a.course_id === assignment.course_id || a.assignment_id === assignment.id
                        );

                        if (attempt?.score != null) {
                            score = attempt.score;
                        }
                    }

                    console.log(`Final score for ${assignment.id}: ${score}`);

                    scoreMap[assignment.id] = score;

                    // Calculate stats
                    // Include 'passed' status and ensure score is present
                    if (score !== null && (assignment.status === 'completed' || assignment.status === 'failed' || assignment.status === 'passed' || assignment.progress_percentage === 100)) {
                        totalScore += score;
                        scoreCount++;
                    }
                } catch (error) {
                    console.error(`Error processing score for assignment ${assignment.id}:`, error);
                    scoreMap[assignment.id] = null;
                }
            }

            console.log(`Total Score: ${totalScore}, Count: ${scoreCount}`);

            const averageGrade = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

            setStats({
                totalCourses,
                coursesCompleted: completedCourses,
                averageGrade
            });

            // Transform data for the courses table (show all courses)
            const transformedCourses: WorkerCourse[] = normalizedData.map((assignment: any) => {
                // Use actual progress_percentage from database, fallback to status/score-based calculation
                let progress = assignment.progress_percentage;

                const score = scoreMap[assignment.id];
                const isPassed = score !== null && score >= 80; // Assuming 80 is passing

                if (progress === null || progress === undefined) {
                    if (assignment.status === 'completed' || isPassed) {
                        progress = 100;
                    } else if (assignment.status === 'in_progress') {
                        progress = 50;
                    } else {
                        progress = 0;
                    }
                }

                // Force 100% if passed regardless of stored progress
                if (isPassed) {
                    progress = 100;
                }

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
                    grade: score
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
