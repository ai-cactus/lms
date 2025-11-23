"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Clock, CheckCircle, Calendar } from "@phosphor-icons/react";

interface Course {
    id: string;
    title: string;
    description: string;
    level: string;
    duration: number;
    pass_mark: number;
    updated_at: string;
    learning_objectives?: string[];
}

export default function CourseDetailsPage() {
    const [course, setCourse] = useState<Course | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"about" | "ratings" | "discussions">("about");
    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const courseId = params.courseId as string;

    useEffect(() => {
        loadCourse();
    }, [courseId]);

    const loadCourse = async () => {
        try {
            const { data, error } = await supabase
                .from("courses")
                .select("*")
                .eq("id", courseId)
                .single();

            if (error) throw error;
            setCourse(data);
            setLoading(false);
        } catch (error) {
            console.error("Error loading course:", error);
            setLoading(false);
        }
    };

    const handleStartCourse = async () => {
        // Find the assignment for this course
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            const { data: assignment } = await supabase
                .from("course_assignments")
                .select("id")
                .eq("course_id", courseId)
                .eq("worker_id", user.id)
                .single();

            if (assignment) {
                router.push(`/worker/training/${assignment.id}`);
            } else {
                alert("No assignment found for this course.");
            }
        } catch (error) {
            console.error("Error starting course:", error);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading course details...</div>
            </div>
        );
    }

    if (!course) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-slate-600 mb-4">Course not found</p>
                    <button
                        onClick={() => router.push("/worker/dashboard")}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Dark Header Section */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white">
                <div className="max-w-6xl mx-auto px-8 py-12">
                    <div className="mb-4">
                        <p className="text-slate-300 text-sm mb-2">Trainings / Course details</p>
                        <h1 className="text-4xl font-bold mb-4">{course.title}</h1>
                        <p className="text-slate-300 text-lg mb-6">
                            Mandatory annual training aligned with CARF 1.H. 4. a-b
                        </p>
                    </div>

                    <div className="flex items-center gap-6 mb-6">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                            <CheckCircle className="w-4 h-4 mr-1.5" weight="fill" />
                            Active
                        </span>
                        <div className="flex items-center gap-2 text-slate-300">
                            <Clock className="w-5 h-5" />
                            <span className="text-sm">{course.duration || 10} min read</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-300">
                            <CheckCircle className="w-5 h-5" />
                            <span className="text-sm">Pass mark: {course.pass_mark || 80}%</span>
                        </div>
                    </div>

                    <button
                        onClick={handleStartCourse}
                        className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-900/30"
                    >
                        Start Course
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="max-w-6xl mx-auto px-8 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2">
                        {/* Tabs */}
                        <div className="border-b border-gray-200 mb-6">
                            <div className="flex gap-8">
                                <button
                                    onClick={() => setActiveTab("about")}
                                    className={`pb-3 px-1 font-medium transition-colors ${activeTab === "about"
                                            ? "text-indigo-600 border-b-2 border-indigo-600"
                                            : "text-slate-600 hover:text-slate-900"
                                        }`}
                                >
                                    About
                                </button>
                                <button
                                    onClick={() => setActiveTab("ratings")}
                                    className={`pb-3 px-1 font-medium transition-colors ${activeTab === "ratings"
                                            ? "text-indigo-600 border-b-2 border-indigo-600"
                                            : "text-slate-600 hover:text-slate-900"
                                        }`}
                                >
                                    Course Ratings
                                </button>
                                <button
                                    onClick={() => setActiveTab("discussions")}
                                    className={`pb-3 px-1 font-medium transition-colors ${activeTab === "discussions"
                                            ? "text-indigo-600 border-b-2 border-indigo-600"
                                            : "text-slate-600 hover:text-slate-900"
                                        }`}
                                >
                                    Discussions
                                </button>
                            </div>
                        </div>

                        {activeTab === "about" && (
                            <div className="space-y-8">
                                {/* Course Overview */}
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-4">Course Overview</h2>
                                    <p className="text-slate-700 leading-relaxed">
                                        {course.description ||
                                            "This course ensures all personnel understand and apply CARF-aligned safety principles in daily operations. It covers essential workplace safety measures, emergency response protocols, and staff responsibilities in maintaining a safe therapeutic environment."}
                                    </p>
                                    <p className="text-slate-700 leading-relaxed mt-4">
                                        Designed to meet CARF Standards 1.H.4.a-b, this training is a mandatory annual
                                        requirement for all staff.
                                    </p>
                                </div>

                                {/* What You'll Learn */}
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-4">What You'll Learn</h2>
                                    <ul className="space-y-3">
                                        <li className="flex items-start gap-3">
                                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" weight="fill" />
                                            <span className="text-slate-700">
                                                Recognize workplace hazards and apply preventive strategies.
                                            </span>
                                        </li>
                                        <li className="flex items-start gap-3">
                                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" weight="fill" />
                                            <span className="text-slate-700">
                                                Respond effectively to emergencies and safety incidents.
                                            </span>
                                        </li>
                                        <li className="flex items-start gap-3">
                                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" weight="fill" />
                                            <span className="text-slate-700">
                                                Comply with CARF and organizational safety standards.
                                            </span>
                                        </li>
                                        <li className="flex items-start gap-3">
                                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" weight="fill" />
                                            <span className="text-slate-700">
                                                Understand staff responsibilities for safety and reporting.
                                            </span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        )}

                        {activeTab === "ratings" && (
                            <div className="text-center py-12">
                                <p className="text-slate-500">Course ratings coming soon</p>
                            </div>
                        )}

                        {activeTab === "discussions" && (
                            <div className="text-center py-12">
                                <p className="text-slate-500">Discussions coming soon</p>
                            </div>
                        )}
                    </div>

                    {/* Sidebar - Course Content */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-xl border border-gray-200 p-6 sticky top-8">
                            <h3 className="font-bold text-slate-900 mb-4">Course Content</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between py-2">
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <CheckCircle className="w-4 h-4" weight="duotone" />
                                        <span>Skill Level</span>
                                    </div>
                                    <span className="text-sm font-medium text-slate-900">
                                        {course.level || "Beginner"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between py-2">
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <Clock className="w-4 h-4" weight="duotone" />
                                        <span>Duration</span>
                                    </div>
                                    <span className="text-sm font-medium text-slate-900">
                                        {course.duration || 30} mins
                                    </span>
                                </div>
                                <div className="flex items-center justify-between py-2">
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <Calendar className="w-4 h-4" weight="duotone" />
                                        <span>Last Updated</span>
                                    </div>
                                    <span className="text-sm font-medium text-slate-900">
                                        {new Date(course.updated_at).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                        })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
