"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TokenValidationResult } from "@/lib/course-tokens";
import { Hexagon, Shield, Clock, CheckCircle } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";

export default function CourseAccessPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;
    
    const [validation, setValidation] = useState<TokenValidationResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) {
            setError("No access token provided");
            setLoading(false);
            return;
        }

        validateToken();
    }, [token]);

    const validateToken = async () => {
        try {
            setLoading(true);
            
            const response = await fetch('/api/course/validate-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token }),
            });
            
            const result = await response.json();
            setValidation(result);
            
            if (!result.isValid) {
                setError(result.error || "Invalid access token");
            }
        } catch (err: any) {
            setError("Failed to validate access token");
            console.error("Token validation error:", err);
        } finally {
            setLoading(false);
        }
    };

    const startCourse = () => {
        if (validation?.assignment) {
            // Redirect to the course content with the token for continued access
            router.push(`/course/content/${validation.assignment.id}?token=${token}`);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <Hexagon size={48} weight="fill" className="text-indigo-600 animate-pulse" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900">Validating Access...</h2>
                    <p className="text-slate-500">Please wait while we verify your course access.</p>
                </div>
            </div>
        );
    }

    if (error || !validation?.isValid) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center max-w-md w-full">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
                    <p className="text-slate-600 mb-6">{error}</p>
                    <p className="text-sm text-slate-500">
                        This link may have expired or been used already. Please contact your administrator for a new course access link.
                    </p>
                </div>
            </div>
        );
    }

    const { assignment } = validation;
    
    if (!assignment) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center max-w-md w-full">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Assignment Not Found</h1>
                    <p className="text-slate-600 mb-6">The course assignment could not be found.</p>
                </div>
            </div>
        );
    }
    
    const course = assignment.course;
    const worker = assignment.worker;

    // Calculate estimated read time (200 words per minute)
    const wordCount = course.lesson_notes?.split(/\s+/).length || 0;
    const readTime = Math.max(1, Math.ceil(wordCount / 200));

    // Extract course sections from markdown headings
    const sections = course.lesson_notes?.match(/^## .+$/gm) || [];

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header Section - Dark */}
            <div className="bg-slate-800 text-white">
                <div className="max-w-4xl mx-auto px-6 py-12">
                    {/* Breadcrumb */}
                    <nav className="text-sm mb-6">
                        <span className="text-slate-300">Trainings</span>
                        <span className="mx-2 text-slate-500">/</span>
                        <span className="text-white">Course details</span>
                    </nav>

                    {/* Course Header */}
                    <div className="flex items-start justify-between mb-8">
                        <div className="flex-1">
                            <h1 className="text-3xl font-bold mb-4">{course.title}</h1>
                            <p className="text-slate-300 text-lg leading-relaxed mb-6">
                                Welcome, {worker.full_name}! You&apos;ve been assigned this training course.
                                Complete it by your deadline to stay compliant with organizational requirements.
                            </p>

                            {/* Course Meta */}
                            <div className="flex items-center gap-6 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full font-medium">
                                        Active
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock size={16} />
                                    <span>{readTime} min read</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} />
                                    <span>Pass mark: {course.pass_mark}%</span>
                                </div>
                            </div>
                        </div>

                        {/* Start Course Button */}
                        <button
                            onClick={startCourse}
                            className="ml-8 px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <Shield size={20} />
                            Start Course
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Section - White */}
            <div className="max-w-4xl mx-auto px-6 py-12">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                    {/* Main Content */}
                    <div className="lg:col-span-2">
                        {/* Tabs */}
                        <div className="border-b border-gray-200 mb-8">
                            <nav className="flex space-x-8">
                                <button className="py-2 px-1 border-b-2 border-blue-600 text-blue-600 font-medium text-sm">
                                    About
                                </button>
                                <button className="py-2 px-1 text-gray-500 hover:text-gray-700 font-medium text-sm">
                                    Course Ratings
                                </button>
                                <button className="py-2 px-1 text-gray-500 hover:text-gray-700 font-medium text-sm">
                                    Discussions
                                </button>
                            </nav>
                        </div>

                        {/* Course Overview */}
                        <div className="mb-12">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">Course Overview</h2>
                            <div className="prose prose-slate max-w-none">
                                <ReactMarkdown>{course.lesson_notes}</ReactMarkdown>
                            </div>
                        </div>

                        {/* What You'll Learn */}
                        {course.objectives && course.objectives.length > 0 && (
                            <div className="mb-12">
                                <h2 className="text-2xl font-bold text-slate-900 mb-6">What You&apos;ll Learn</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {course.objectives.map((objective, index) => (
                                        <div key={index} className="flex items-start gap-3">
                                            <CheckCircle size={20} className="text-green-600 mt-0.5 flex-shrink-0" />
                                            <span className="text-slate-700">{objective}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1">
                        {/* Course Content */}
                        {sections.length > 0 && (
                            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
                                <h3 className="font-bold text-slate-900 mb-4">Course Content</h3>
                                <div className="space-y-3">
                                    {sections.map((section, index) => {
                                        const title = section.replace(/^## /, '');
                                        return (
                                            <div key={index} className="flex items-center gap-3 text-sm">
                                                <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-600">
                                                    {index + 1}
                                                </div>
                                                <span className="text-slate-700">{title}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Course Info */}
                        <div className="bg-white rounded-lg border border-gray-200 p-6">
                            <h3 className="font-bold text-slate-900 mb-4">Course Information</h3>
                            <div className="space-y-4 text-sm">
                                <div>
                                    <span className="text-slate-500">Skill Level</span>
                                    <p className="font-medium text-slate-900">Beginner</p>
                                </div>
                                <div>
                                    <span className="text-slate-500">Duration</span>
                                    <p className="font-medium text-slate-900">{readTime} minutes</p>
                                </div>
                                <div>
                                    <span className="text-slate-500">Deadline</span>
                                    <p className="font-medium text-slate-900">
                                        {assignment?.deadline ? new Date(assignment.deadline).toLocaleDateString() : 'No deadline set'}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-slate-500">Status</span>
                                    <p className="font-medium text-slate-900 capitalize">
                                        {assignment?.status?.replace('_', ' ') || 'Unknown'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
