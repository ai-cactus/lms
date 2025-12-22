"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface CourseDetails {
    id: string;
    title: string;
    lesson_notes: string;
    pass_mark: number;
    published_at: string;
    created_at: string;
    objectives?: {
        items?: string[];
        difficulty?: string;
    };
    policy?: {
        title: string;
        file_name: string;
    };
}

interface Assignment {
    id: string;
    course_id: string;
    deadline: string;
    status: string;
    course: CourseDetails;
}

export default function WorkerCourseDetailsPage({ params }: { params: Promise<{ assignmentId: string }> }) {
    const { assignmentId } = use(params);
    const router = useRouter();
    const supabase = createClient();
    const [assignment, setAssignment] = useState<Assignment | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAllSections, setShowAllSections] = useState(false);

    useEffect(() => {
        loadAssignmentData();
    }, [assignmentId]);

    const loadAssignmentData = async () => {
        try {
            console.log("Loading assignment data for ID:", assignmentId);

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            console.log("Current user ID:", user.id);

            const { data: assignmentData, error: assignmentError } = await supabase
                .from("course_assignments")
                .select(`
                    id,
                    course_id,
                    deadline,
                    status,
                    course:courses(
                        id,
                        title,
                        lesson_notes,
                        pass_mark,
                        published_at,
                        created_at,
                        objectives,
                        policy:policies(title, file_name)
                    )
                `)
                .eq("id", assignmentId)
                .eq("worker_id", user.id)
                .single();

            if (assignmentError) {
                if (assignmentError.code === 'PGRST116') {
                    // No assignment found for this user - let's check what assignments they do have
                    console.error("Assignment not found or access denied:", assignmentId);

                    // Debug: Check what assignments this user has access to
                    const { data: userAssignments, error: checkError } = await supabase
                        .from("course_assignments")
                        .select("id, course_id, status")
                        .eq("worker_id", user.id);

                    console.log("User's available assignments:", userAssignments);

                    // Also check if this assignment ID exists at all (without worker_id filter)
                    const { data: allAssignments, error: allError } = await supabase
                        .from("course_assignments")
                        .select("id, worker_id, course_id")
                        .eq("id", assignmentId);

                    console.log("Assignment exists in database?", allAssignments);
                    if (allAssignments && allAssignments.length > 0) {
                        console.log("Assignment belongs to user?", allAssignments[0].worker_id === user.id);
                        console.log("Assignment worker_id:", allAssignments[0].worker_id);
                        console.log("Current user_id:", user.id);
                    }

                    alert("Course assignment not found. You may not have access to this course.");
                    router.push("/worker/dashboard");
                    return;
                }
                throw assignmentError;
            }

            setAssignment(assignmentData as any);
            setLoading(false);
        } catch (error) {
            console.error("Error loading assignment data:", error);
            setLoading(false);
        }
    };

    // Extract course content sections
    const extractSections = (content: string) => {
        const sections = [];
        const lines = content.split('\n');
        let currentSection = { title: '', content: '' };

        for (const line of lines) {
            if (line.startsWith('## ')) {
                if (currentSection.title) {
                    sections.push(currentSection);
                }
                currentSection = { title: line.replace('## ', ''), content: '' };
            } else if (currentSection.title) {
                currentSection.content += line + '\n';
            }
        }

        if (currentSection.title) {
            sections.push(currentSection);
        }

        return sections;
    };

    const estimateReadTime = (content: string) => {
        const wordCount = content ? content.split(/\s+/).length : 0;
        return Math.ceil(wordCount / 200); // 200 words per minute average reading speed
    };

    const handleStartCourse = () => {
        router.push(`/worker/courses/${assignmentId}`);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="w-16 h-16 border-4 border-[#4758E0] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!assignment) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h1 className="text-2xl font-bold mb-2 text-gray-900">Assignment not found</h1>
                    <button
                        onClick={() => router.push('/worker/courses')}
                        className="text-[#4758E0] hover:text-[#4758E0]/80"
                    >
                        Back to courses
                    </button>
                </div>
            </div>
        );
    }

    const course = assignment.course;
    const sections = extractSections(course.lesson_notes || '');
    const visibleSections = showAllSections ? sections : sections.slice(0, 5);
    const remainingCount = sections.length - 5;

    return (
        <div className="min-h-screen bg-[#242424]">
            {/* Header Section */}
            <div className="bg-[#242424] text-white py-12 px-6">
                <div className="max-w-6xl mx-auto">
                    {/* Breadcrumb */}
                    <div className="mb-6">
                        <span className="text-gray-400">Trainings / Course details</span>
                    </div>

                    <div className="flex justify-between items-start">
                        <div className="flex-1">
                            <h1 className="text-4xl font-bold mb-4">{course.title}</h1>
                            <p className="text-gray-300 mb-6">
                                {course.policy?.title || "Mandatory annual training aligned with CARF 1.H. 4. a-b"}
                            </p>
                            <p className="text-gray-400 mb-8">
                                By {course.policy?.title || "John Doe Organization Policy"}
                            </p>

                            <div className="flex">
                                <div className="w-[60%]">
                                    <div className="border-t border-dotted border-gray-500 mb-4"></div>
                                    <div className="flex items-center gap-6 mb-4">
                                        <span className="inline-flex items-center px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-full">
                                            Active
                                        </span>
                                        <div className="flex items-center gap-2 text-gray-300">
                                            <span>⏱</span>
                                            <span>{estimateReadTime(course.lesson_notes || '')} min read</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-300">
                                            <span>📖</span>
                                            <span>Pass mark: {course.pass_mark}%</span>
                                        </div>
                                    </div>
                                    <div className="border-t border-dotted border-gray-500 mb-8"></div>
                                </div>
                                <div className="ml-8 flex-1">
                                    <button
                                        onClick={handleStartCourse}
                                        className="px-6 w-full py-3 h-[58px] bg-[#4758E0] text-white rounded-lg font-medium hover:bg-[#4758E0]/90 transition-colors"
                                    >
                                        Start Course
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            <div className="bg-white">
                <div className="mx-auto px-[30px] py-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Main Content */}
                        <div style={{border: "1px solid #EEEFF2", borderRadius: "12px", padding: "35px", boxShadow: "0 4px 4px 0 #0000000D"}} className="lg:col-span-2">
                            <div className="space-y-8">
                                {/* Course Overview */}
                                <div>
                                    <h3 className="text-xl font-bold text-gray-900 mb-4">Course Overview</h3>
                                    <div className="text-gray-700 leading-relaxed">
                                        {course.objectives?.difficulty && (
                                            <p className="mb-3">
                                                <span className="font-medium">Skill Level:</span> {course.objectives.difficulty}
                                            </p>
                                        )}
                                        <p className="mb-3">
                                            <span className="font-medium">Duration:</span> {estimateReadTime(course.lesson_notes || '')} minutes
                                        </p>
                                        <p className="mb-3">
                                            <span className="font-medium">Pass Mark:</span> {course.pass_mark}%
                                        </p>
                                        {course.policy?.title && (
                                            <p>
                                                <span className="font-medium">Related Policy:</span> {course.policy.title}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* What You Will Learn */}
                                {course.objectives?.items && course.objectives.items.length > 0 && (
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-900 mb-4">What You Will Learn</h3>
                                        <ul className="space-y-3">
                                            {course.objectives.items.map((item, index) => (
                                                <li key={index} className="flex items-start gap-3">
                                                    <div className="w-2 h-2 bg-[#4758E0] rounded-full mt-2 flex-shrink-0"></div>
                                                    <span className="text-gray-700">{item}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Sidebar */}
                        <div style={{border: "1px solid #EEEFF2", borderRadius: "12px", padding: "27px 20px", boxShadow: "0 4px 4px 0 #0000000D"}} className="lg:col-span-1">
                            <div className="rounded-lg">
                                <h3 className="text-lg font-bold text-gray-900 mb-4">Course Content</h3>
                                <div className="border-t border-dotted border-[#DFE1E6] mb-4"></div>
                                <div className="space-y-3">
                                    {visibleSections.map((section, index) => (
                                        <div key={index} className="text-sm">
                                            <div className="text-[#808897] hover:text-[#2C3D8F] cursor-pointer">
                                                {section.title}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {sections.length > 5 && (
                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                        <button
                                            onClick={() => setShowAllSections(!showAllSections)}
                                            className="text-sm text-[#2C3D8F] hover:text-[#1e2d5f] font-medium hover:underline"
                                        >
                                            {showAllSections ? "View Less" : `View ${remainingCount} More Sections`}
                                        </button>
                                    </div>
                                )}

                                <div className="mt-8 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <span className="w-4 h-4 text-gray-400">👤</span>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">Skill Level</div>
                                            <div className="text-sm text-gray-600">
                                                {course.objectives?.difficulty || "Beginner"}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="w-4 h-4 text-gray-400">⏱</span>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">Duration</div>
                                            <div className="text-sm text-gray-600">{estimateReadTime(course.lesson_notes || '')} mins</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="w-4 h-4 text-gray-400">📅</span>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">Last Updated</div>
                                            <div className="text-sm text-gray-600">
                                                {new Date(course.created_at).toLocaleDateString('en-US', {
                                                    month: 'long',
                                                    day: 'numeric',
                                                    year: 'numeric'
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
