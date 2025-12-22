"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Course } from "@/types/database";
import { Clock, BookOpen, Calendar, User } from "lucide-react";
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

export default function CoursePreviewPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const supabase = createClient();
    const [course, setCourse] = useState<CourseDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAllSections, setShowAllSections] = useState(false);

    useEffect(() => {
        loadCourseData();
    }, [id]);

    const loadCourseData = async () => {
        try {
            const { data: courseData, error: courseError } = await supabase
                .from("courses")
                .select(`
                    id,
                    title,
                    lesson_notes,
                    pass_mark,
                    published_at,
                    created_at,
                    objectives,
                    policy:policies(title, file_name)
                `)
                .eq("id", id)
                .single();

            if (courseError) throw courseError;
            setCourse(courseData as Course);
            setLoading(false);
        } catch (error) {
            console.error("Error loading course data:", error);
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

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#242424]">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!course) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#242424]">
                <div className="text-white text-center">
                    <h1 className="text-2xl font-bold mb-2">Course not found</h1>
                    <button
                        onClick={() => router.back()}
                        className="text-blue-400 hover:text-blue-300"
                    >
                        Go back
                    </button>
                </div>
            </div>
        );
    }

    const sections = extractSections(course.lesson_notes || '');
    const readTime = estimateReadTime(course.lesson_notes || '');

    return (
        <div className="min-h-screen bg-[#242424]">
            {/* Header Section */}
            <div className="bg-[#242424] text-white py-12 px-6">
                <div className="max-w-6xl mx-auto">
                    {/* Breadcrumb */}
                    <div className="mb-6">
                        <span className="text-gray-400">Course / {course.title}</span>
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
                                            <Clock className="w-4 h-4" />
                                            <span>{readTime} min read</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-300">
                                            <BookOpen className="w-4 h-4" />
                                            <span>Pass mark: {course.pass_mark}%</span>
                                        </div>
                                    </div>

                                    {/* Dotted border bottom */}
                                    <div className="border-t border-dotted border-gray-500 mb-8"></div>
                                </div>
                                <div className="ml-8 flex-1">
                                    <button
                                        onClick={() => router.back()}
                                        className="px-6 w-full py-3 h-[58px] bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                                    >
                                        View Course
                                    </button>
                                </div>
                            </div>
                            {/* Dotted border top */}

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
                                                    <div className="w-2 h-2 bg-blue-600 rounded-full mt-2 flex-shrink-0"></div>
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
                            <div className=" rounded-lg">
                                <h3 className="text-lg font-bold text-gray-900 mb-4">Course Content</h3>
                                 <div className="border-t border-dotted border-[#DFE1E6] mb-4"></div>
                                <div className="space-y-3">
                                    {sections.slice(0, showAllSections ? sections.length : 5).map((section, index) => (
                                        <div key={index} className="text-sm">
                                            <div className="text-[#808897] hover:text-[#2C3D8F] cursor-pointer">
                                                {section.title}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {sections.length > 5 && (
                                    <div className="mt-6">
                                        <button
                                            onClick={() => setShowAllSections(!showAllSections)}
                                            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                                        >
                                            {showAllSections ? "View Less" : `View ${sections.length - 5} More Sections`}
                                        </button>
                                    </div>
                                )}

                                <div className="mt-8 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <User className="w-4 h-4 text-gray-400" />
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">Skill Level</div>
                                            <div className="text-sm text-gray-600">
                                                {course.objectives?.difficulty || "Beginner"}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Clock className="w-4 h-4 text-gray-400" />
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">Duration</div>
                                            <div className="text-sm text-gray-600">{readTime} mins</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Calendar className="w-4 h-4 text-gray-400" />
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
