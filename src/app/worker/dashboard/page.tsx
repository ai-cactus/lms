"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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

export default function WorkerDashboardPage() {
    const [inProgressCourses, setInProgressCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadInProgressCourses();
    }, []);

    const loadInProgressCourses = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get only in-progress courses
            const { data: assignmentsData, error } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    course_id,
                    deadline,
                    courses(title, objectives)
                `)
                .eq("worker_id", user.id)
                .eq("status", "in_progress")
                .order("deadline", { ascending: true });

            if (error) throw error;

            // Normalize data
            const normalizedData = (assignmentsData || []).map((a: any) => ({
                ...a,
                courses: Array.isArray(a.courses) ? a.courses[0] : a.courses,
            }));

            setInProgressCourses(normalizedData);
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
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading your courses...</div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Dashboard</h1>
                <p className="text-slate-500">Continue your training journey</p>
            </div>

            {inProgressCourses.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
                    <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <TrendUp className="w-10 h-10 text-indigo-600" weight="fill" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">No courses in progress</h3>
                    <p className="text-slate-500 mb-6">You don't have any courses in progress. Start a new course to begin learning!</p>
                    <button
                        onClick={() => router.push("/worker/courses")}
                        className="px-6 py-3 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        Browse Available Courses
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {inProgressCourses.map((course) => (
                        <div
                            key={course.id}
                            onClick={() => router.push(`/worker/courses/${course.id}`)}
                            className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-xl hover:border-indigo-200 transition-all cursor-pointer group"
                        >
                            <div className="flex items-start gap-4 mb-4">
                                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                                    {getCourseIcon(course.courses?.title || "Course")}
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors line-clamp-2">
                                        {course.courses?.title || "Untitled Course"}
                                    </h3>
                                    <p className="text-sm text-slate-500 line-clamp-2">
                                        {getDescription(course.courses?.objectives)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                    <Clock className="w-4 h-4" />
                                    <span>Due: {new Date(course.deadline).toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm font-medium text-indigo-600 group-hover:gap-3 transition-all">
                                    <span>Continue</span>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
