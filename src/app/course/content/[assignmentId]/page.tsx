"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { User, BookOpen, Clock, CheckCircle } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";

interface Assignment {
    id: string;
    course_id: string;
    worker_id: string;
    status: string;
    deadline: string;
    course: {
        id: string;
        title: string;
        lesson_notes: string;
        objectives: string[];
        pass_mark: number;
    };
    worker: {
        id: string;
        full_name: string;
        email: string;
    };
}

export default function CourseContentPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const assignmentId = params.assignmentId as string;
    const token = searchParams.get('token');
    
    const [assignment, setAssignment] = useState<Assignment | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (!assignmentId) {
            setError("No assignment ID provided");
            setLoading(false);
            return;
        }

        loadAssignment();
    }, [assignmentId, token]);

    const loadAssignment = async () => {
        try {
            setLoading(true);
            
            // If we have a token, validate it first
            if (token) {
                const response = await fetch('/api/course/validate-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ token }),
                });
                
                const validation = await response.json();
                if (!validation.isValid) {
                    setError(validation.error || "Invalid access token");
                    setLoading(false);
                    return;
                }
                
                // Verify the token matches this assignment
                if (validation.assignment?.id !== assignmentId) {
                    setError("Access token does not match this assignment");
                    setLoading(false);
                    return;
                }
                
                setAssignment(validation.assignment as Assignment);
                setLoading(false);
                return;
            }
            
            // Fallback: try to load with regular authentication
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            
            if (!user) {
                setError("Authentication required. Please use the provided course access link.");
                setLoading(false);
                return;
            }
            
            // Load assignment with user authentication
            const { data: assignmentData, error: assignmentError } = await supabase
                .from('course_assignments')
                .select(`
                    id,
                    course_id,
                    worker_id,
                    status,
                    deadline,
                    course:courses (
                        id,
                        title,
                        lesson_notes,
                        objectives,
                        pass_mark
                    ),
                    worker:users (
                        id,
                        full_name,
                        email
                    )
                `)
                .eq('id', assignmentId)
                .eq('worker_id', user.id)
                .single();
                
            if (assignmentError || !assignmentData) {
                setError("Assignment not found or access denied");
                setLoading(false);
                return;
            }
            
            // Transform the Supabase result to match our Assignment interface
            const transformedAssignment: Assignment = {
                id: assignmentData.id,
                course_id: assignmentData.course_id,
                worker_id: assignmentData.worker_id,
                status: assignmentData.status,
                deadline: assignmentData.deadline,
                course: Array.isArray(assignmentData.course) ? assignmentData.course[0] : assignmentData.course,
                worker: Array.isArray(assignmentData.worker) ? assignmentData.worker[0] : assignmentData.worker
            };
            
            setAssignment(transformedAssignment);
            
        } catch (err: any) {
            setError("Failed to load course content");
            console.error("Course loading error:", err);
        } finally {
            setLoading(false);
        }
    };

    const markAsStarted = async () => {
        if (!assignment || assignment.status !== 'not_started') return;
        
        try {
            const supabase = createClient();
            await supabase
                .from('course_assignments')
                .update({ 
                    status: 'in_progress',
                    started_at: new Date().toISOString()
                })
                .eq('id', assignment.id);
                
            setAssignment(prev => prev ? { ...prev, status: 'in_progress' } : null);
        } catch (error) {
            console.error('Error marking course as started:', error);
        }
    };

    const completeReading = () => {
        setProgress(100);
        // Redirect to quiz page
        const quizUrl = token 
            ? `/worker/quiz/${assignmentId}?token=${token}`
            : `/worker/quiz/${assignmentId}`;
        router.push(quizUrl);
    };

    useEffect(() => {
        if (assignment && assignment.status === 'not_started') {
            markAsStarted();
        }
    }, [assignment]);

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <h2 className="text-xl font-semibold text-slate-900">Loading Course...</h2>
                    <p className="text-slate-500">Please wait while we prepare your training content.</p>
                </div>
            </div>
        );
    }

    if (error || !assignment) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center max-w-md w-full">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Error</h1>
                    <p className="text-slate-600 mb-6">{error}</p>
                    <button
                        onClick={() => router.back()}
                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    const course = assignment.course;
    const worker = assignment.worker;

    // Calculate estimated read time
    const wordCount = course.lesson_notes?.split(/\s+/).length || 0;
    const readTime = Math.max(1, Math.ceil(wordCount / 200));

    // Extract table of contents from markdown headings
    const tableOfContents = course.lesson_notes?.match(/^## .+$/gm)?.map(heading => 
        heading.replace(/^## /, '')
    ) || [];

    return (
        <div className="min-h-screen bg-white">
            {/* Header */}
            <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <h1 className="text-xl font-semibold text-slate-900">My Training</h1>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <User size={16} />
                                <span>{worker.full_name}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Course Header */}
            <div className="bg-slate-50 border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-6 py-8">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-4">
                                <BookOpen size={24} className="text-blue-600" />
                                <h2 className="text-2xl font-bold text-slate-900">{course.title}</h2>
                            </div>
                            
                            <div className="flex items-center gap-6 text-sm text-slate-600">
                                <div className="flex items-center gap-2">
                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                        assignment.status === 'completed' ? 'bg-green-100 text-green-800' :
                                        assignment.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                                        'bg-gray-100 text-gray-800'
                                    }`}>
                                        {assignment.status === 'not_started' ? 'Not Started' :
                                         assignment.status === 'in_progress' ? 'In Progress' :
                                         assignment.status === 'completed' ? 'Completed' :
                                         assignment.status}
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

                        <button
                            onClick={() => {
                                if (token) {
                                    // For tokenized access, go back to course access page
                                    router.push(`/course/access/${token}`);
                                } else {
                                    // For authenticated users, go to worker courses
                                    router.push('/worker/courses');
                                }
                            }}
                            className="px-4 py-2 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                        >
                            {token ? 'Back to Course Overview' : 'View as Slides'}
                        </button>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-6">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="font-medium text-slate-700">Progress</span>
                            <span className="text-slate-500">{progress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Course Content */}
                    <div className="lg:col-span-3">
                        <div className="bg-white rounded-lg border border-gray-200 p-8">
                            <div className="prose prose-slate max-w-none">
                                <ReactMarkdown>{course.lesson_notes}</ReactMarkdown>
                            </div>

                            {/* Complete Reading Button */}
                            <div className="mt-12 pt-8 border-t border-gray-200 text-center">
                                <button
                                    onClick={completeReading}
                                    className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                                >
                                    Complete Reading & Take Quiz
                                </button>
                                <p className="text-sm text-slate-500 mt-2">
                                    Click when you&apos;ve finished reading to proceed to the assessment
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="lg:col-span-1">
                        {/* Table of Contents */}
                        {tableOfContents.length > 0 && (
                            <div className="bg-white rounded-lg border border-gray-200 p-6 sticky top-24">
                                <h3 className="font-bold text-slate-900 mb-4">Table of Contents</h3>
                                <div className="space-y-2">
                                    {tableOfContents.map((section, index) => (
                                        <div key={index} className="text-sm">
                                            <a
                                                href={`#section-${index}`}
                                                className="text-slate-600 hover:text-blue-600 transition-colors block py-1"
                                            >
                                                {index + 1}. {section}
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
