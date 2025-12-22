"use client";

import { useState, useEffect, useMemo, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

import {
    PencilSimple,
    Hexagon,
    CaretDown,
    CaretUp,
    CaretLeft as CaretLeftIcon,
    CaretRight as CaretRightIcon,
    BookOpen
} from "@phosphor-icons/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Icons for internal use
function CaretLeft() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function CaretRight() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

interface Heading {
    id: string;
    text: string;
    level: number;
}

export default function WorkerCoursePreviewPage({ params }: { params: Promise<{ assignmentId: string }> }) {
    const { assignmentId } = use(params);
    const router = useRouter();
    const supabase = createClient();

    const [loading, setLoading] = useState(true);
    const [assignment, setAssignment] = useState<any>(null);
    const [isSlideView, setIsSlideView] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [showAllModules, setShowAllModules] = useState(false);
    // Ref for the content container to track scroll
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadAssignment();
    }, [assignmentId]);

    const loadAssignment = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Query to select assignment details
            const selectQuery = `
                id,
                course_id,
                status,
                course:courses(
                    id,
                    title,
                    lesson_notes
                )
            `;

            // 1. Try treating param as assignment_id
            let { data, error } = await supabase
                .from("course_assignments")
                .select(selectQuery)
                .eq("id", assignmentId)
                .single();

            // 2. If failed, try treating param as course_id
            if (error) {
                console.log("Lookup by assignment ID failed, trying as Course ID...");

                const { data: fallbackData, error: fallbackError } = await supabase
                    .from("course_assignments")
                    .select(selectQuery)
                    .eq("course_id", assignmentId)
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (!fallbackError && fallbackData) {
                    console.log("Found assignment via Course ID");
                    data = fallbackData;
                    error = null;
                } else {
                    console.error("Final lookup failed:", error);
                    throw error;
                }
            }

            setAssignment(data);
            setLoading(false);
        } catch (error) {
            console.error("Error loading assignment:", error);
            setLoading(false);
        }
    };

    const content = assignment?.course?.lesson_notes || "";
    const courseTitle = assignment?.course?.title || "Course Content";

    // Split content into slides based on H2 headings
    const slides = useMemo(() => {
        if (!content) return [];

        const lines = content.split('\n');
        const slideContents: string[] = [];
        let currentSlideContent: string[] = [];

        for (const line of lines) {
            if (line.startsWith('## ')) {
                // New slide starts
                if (currentSlideContent.length > 0) {
                    slideContents.push(currentSlideContent.join('\n'));
                }
                currentSlideContent = [line];
            } else {
                currentSlideContent.push(line);
            }
        }

        // Add the last slide
        if (currentSlideContent.length > 0) {
            slideContents.push(currentSlideContent.join('\n'));
        }

        return slideContents;
    }, [content]);

    // Extract headings from markdown content for table of contents
    const headings = useMemo(() => {
        if (!content) return [];

        const headingRegex = /^(#{2,3})\s+(.+)$/gm;
        const extractedHeadings: Heading[] = [];
        let match;

        while ((match = headingRegex.exec(content)) !== null) {
            const level = match[1].length;
            const text = match[2].trim();
            const id = text
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 50);

            extractedHeadings.push({ id, text, level });
        }

        return extractedHeadings;
    }, [content]);

    // Filter headings for display (show first 7 by default)
    const visibleHeadings = showAllModules ? headings : headings.slice(0, 7);
    const remainingCount = headings.length - 7;

    const scrollToHeading = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // Custom renderer for headings to add IDs
    const components = {
        h2: ({ children, ...props }: any) => {
            const text = String(children);
            const id = text
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 50);
            return <h2 id={id} {...props}>{children}</h2>;
        },
        h3: ({ children, ...props }: any) => {
            const text = String(children);
            const id = text
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 50);
            return <h3 id={id} {...props}>{children}</h3>;
        },
    };

    const handleViewAsSlides = () => {
        setCurrentSlide(0);
        setIsSlideView(true);
    };

    const handleExitSlides = () => {
        setIsSlideView(false);
        setCurrentSlide(0);
    };

    const handleNextSlide = () => {
        if (currentSlide < slides.length - 1) {
            setCurrentSlide(currentSlide + 1);
        }
    };

    const handlePrevSlide = () => {
        if (currentSlide > 0) {
            setCurrentSlide(currentSlide - 1);
        }
    };

    const handleStartQuiz = () => {
        router.push(`/worker/quiz/${assignmentId}`);
    };

    // Keyboard navigation
    useEffect(() => {
        if (!isSlideView) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') {
                handlePrevSlide();
            } else if (e.key === 'ArrowRight') {
                handleNextSlide();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSlideView, currentSlide, slides.length]);

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading course content...</div>
            </div>
        );
    }

    if (!assignment) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Assignment not found</div>
            </div>
        );
    }

    // Slide View
    if (isSlideView && slides.length > 0) {
        const currentSlideContent = slides[currentSlide];
        const isFirstSlide = currentSlide === 0;
        const isLastSlide = currentSlide === slides.length - 1;

        // Extract module title (H2) from current slide
        const h2Match = currentSlideContent.match(/^##\s+(.+)$/m);
        const moduleTitle = h2Match ? h2Match[1] : 'Module Content';

        // Check if this is a title slide (has H2 but minimal content)
        const isTitleSlide = currentSlideContent.includes('##') && currentSlideContent.split('\n').filter(line => line.trim()).length < 5;

        return (
            <div className="fixed inset-0 bg-white z-50 flex flex-col">
                {/* Header */}
                <div className="bg-white border-b border-gray-200 px-6 py-4">
                    <div className="max-w-7xl mx-auto flex items-center justify-between">
                        {/* Left side - Breadcrumb */}
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span>Trainings</span>
                            <span>/</span>
                            <span className="text-gray-900 font-medium">{courseTitle}</span>
                        </div>

                        {/* Right side - Progress and Actions */}
                        <div className="flex items-center gap-4">
                            {/* Progress Indicator */}
                            <div className="flex items-center gap-4">
                                <div className="relative w-16 h-16">
                                    <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
                                        <path
                                            className="text-gray-200"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                            fill="transparent"
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                        <path
                                            className="text-[#4758E0]"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                            strokeDasharray={`${Math.round(((currentSlide + 1) / slides.length) * 100)}, 100`}
                                            strokeLinecap="round"
                                            fill="transparent"
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-sm font-bold text-[#4758E0]">
                                            {Math.round(((currentSlide + 1) / slides.length) * 100)}%
                                        </span>
                                    </div>
                                </div>
                                <div className="text-sm">
                                    <div className="font-bold text-gray-900 text-lg">Your Progress</div>
                                    <div className="text-gray-400">{currentSlide + 1} of {slides.length} Completed</div>
                                </div>
                            </div>

                            {/* Share Button */}
                            <button className="w-12 h-12 border-2 border-[#4758E0] rounded-xl flex items-center justify-center hover:bg-[#4758E0]/10 transition-colors">
                                <svg className="w-5 h-5 text-[#4758E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                                </svg>
                            </button>

                            {/* View as Notes Button */}
                            <button
                                onClick={handleExitSlides}
                                className="px-6 py-3 bg-[#4758E0] text-white rounded-xl hover:bg-[#4758E0]/90 transition-colors text-sm font-medium"
                            >
                                View as Notes
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Slide Area */}
                <div className="flex-1 flex items-center justify-center p-8 overflow-hidden relative">
                    {/* Navigation Arrows */}
                    <button
                        onClick={handlePrevSlide}
                        disabled={currentSlide === 0}
                        className="absolute left-8 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed z-10 shadow-sm"
                    >
                        <CaretLeft />
                    </button>

                    {/* Slide Content */}
                    <div className="w-[900px] h-[600px] bg-white rounded-lg shadow-xl border border-gray-200 relative overflow-hidden flex flex-col">
                        {isTitleSlide ? (
                            // Title Slide Layout
                            <div className="min-h-[500px] flex flex-col justify-center px-16 py-12 relative overflow-hidden">
                                <div className="prose prose-slate max-w-none relative z-10">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkMath, remarkGfm]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            h2: ({ children, ...props }: any) => (
                                                <h1 className="text-5xl font-bold text-slate-900 mb-6 leading-tight" {...props}>{children}</h1>
                                            ),
                                            p: ({ children, ...props }: any) => (
                                                <p className="text-lg text-slate-700 mb-4" {...props}>{children}</p>
                                            ),
                                        }}
                                    >
                                        {currentSlideContent}
                                    </ReactMarkdown>
                                </div>

                                {/* Decorative Shape */}
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-64 h-80 bg-teal-700 rounded-l-full opacity-90 z-0"></div>

                                <div className="absolute bottom-8 left-16 text-xs text-slate-500">
                                    Theraptly.co
                                </div>
                            </div>
                        ) : isLastSlide && currentSlideContent.toLowerCase().includes('thank') ? (
                            // Thank You Slide Layout
                            <div className="min-h-[500px] flex flex-col items-center justify-center py-12 relative">
                                <h1 className="text-6xl font-bold text-slate-900 mb-4">Thank you</h1>
                                <p className="text-sm text-slate-500">Theraptly.co</p>

                                <button
                                    onClick={handleStartQuiz}
                                    className="absolute right-8 top-1/2 -translate-y-1/2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex items-center gap-2"
                                >
                                    Start Quiz <CaretRight />
                                </button>
                            </div>
                        ) : (
                            // Content Slide Layout
                            <div className="h-full flex flex-col relative">
                                {/* Green Header Banner */}
                                <div className="bg-teal-700 text-white px-12 py-6 relative z-10 flex-shrink-0">
                                    <h2 className="text-2xl font-bold">
                                        {moduleTitle}
                                    </h2>
                                </div>

                                {/* Content Area */}
                                <div className="flex-1 px-12 py-8 overflow-y-auto relative z-10">
                                    <div className="prose prose-slate max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkMath, remarkGfm]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={{
                                                h2: () => null, // Don't show H2 in content area since it's in the banner
                                                h3: ({ children, ...props }: any) => (
                                                    <h3 className="text-xl font-bold text-slate-900 mb-3 mt-6" {...props}>{children}</h3>
                                                ),
                                                p: ({ children, ...props }: any) => (
                                                    <p className="text-base text-slate-700 mb-4 leading-relaxed" {...props}>{children}</p>
                                                ),
                                            }}
                                        >
                                            {currentSlideContent}
                                        </ReactMarkdown>
                                    </div>

                                    {/* Decorative Shape - Bottom Right */}
                                    <div className="absolute bottom-8 right-0 w-48 h-48 bg-teal-700/20 rounded-l-full pointer-events-none z-0"></div>
                                </div>

                                <div className="px-12 py-4 text-xs text-slate-500 border-t border-gray-100 flex-shrink-0">
                                    Theraptly.co
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleNextSlide}
                        disabled={currentSlide === slides.length - 1}
                        className="absolute right-8 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed z-10 shadow-sm"
                    >
                        <CaretRight />
                    </button>
                </div>

                {/* Thumbnail Strip */}
                <div className="bg-white border-t border-gray-200 px-8 py-3">
                    <div className="max-w-7xl mx-auto">
                        <div 
                            className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden" 
                            style={{ 
                                scrollbarWidth: 'none', 
                                msOverflowStyle: 'none'
                            }}
                        >
                            {slides.map((slide, index) => {
                                const slideH2 = slide.match(/^##\s+(.+)$/m)?.[1] || '';
                                const slideContent = slide.replace(/^##\s+.+$/m, '').trim();
                                const isFirstSlide = index === 0;
                                const isLastSlide = index === slides.length - 1;
                                
                                return (
                                    <button
                                        key={index}
                                        onClick={() => setCurrentSlide(index)}
                                        className={`flex-shrink-0 w-40 h-24 rounded border-2 transition-all ${index === currentSlide
                                            ? 'border-[#4758E0] shadow-md'
                                            : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                    >
                                        <div className="w-full h-full bg-white rounded overflow-hidden relative">
                                            {isFirstSlide ? (
                                                // First slide thumbnail - Title slide
                                                <div className="w-full h-full bg-gradient-to-br from-teal-600 to-teal-700 flex flex-col justify-center items-center p-2">
                                                    <div className="text-[8px] text-white font-bold text-center leading-tight">
                                                        Fundamental CARF Principles
                                                    </div>
                                                </div>
                                            ) : isLastSlide && slideContent.toLowerCase().includes('thank') ? (
                                                // Thank you slide thumbnail
                                                <div className="w-full h-full bg-gray-50 flex flex-col justify-center items-center p-2">
                                                    <div className="text-[10px] text-gray-800 font-bold">Thank you</div>
                                                    <div className="text-[6px] text-gray-500 mt-1">Theraptly.co</div>
                                                </div>
                                            ) : (
                                                // Content slide thumbnail
                                                <div className="w-full h-full bg-white flex flex-col">
                                                    {/* Green header */}
                                                    <div className="bg-teal-700 text-white px-1.5 py-1 flex-shrink-0">
                                                        <div className="text-[6px] font-bold leading-tight line-clamp-1">
                                                            {slideH2}
                                                        </div>
                                                    </div>
                                                    {/* Content area */}
                                                    <div className="flex-1 p-1.5 bg-white">
                                                        <div className="text-[5px] text-gray-600 leading-tight line-clamp-6">
                                                            {slideContent.substring(0, 200)}...
                                                        </div>
                                                    </div>
                                                    {/* Bottom line */}
                                                    <div className="border-t border-gray-100 px-1.5 py-0.5">
                                                        <div className="text-[4px] text-gray-400">Theraptly.co</div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    {/* Left side - Breadcrumb */}
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>Trainings</span>
                        <span>/</span>
                        <span className="text-gray-900 font-medium">{courseTitle}</span>
                    </div>

                    {/* Right side - Progress and Actions */}
                    <div className="flex items-center gap-4">
                        {/* Progress Indicator */}
                        <div className="flex items-center gap-4">
                            <div className="relative w-16 h-16">
                                <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
                                    <path
                                        className="text-[#4758E0]"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                        fill="transparent"
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    />
                                    <path
                                        className="text-[#4758E0]"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                        strokeDasharray="80, 100"
                                        strokeLinecap="round"
                                        fill="transparent"
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-bold text-[#4758E0]">80%</span>
                                </div>
                            </div>
                            <div className="text-sm">
                                <div className="font-bold text-gray-900 text-lg">Your Progress</div>
                                <div className="text-gray-400">8 of 16 Completed</div>
                            </div>
                        </div>

                        {/* Share Button */}
                        <button className="w-12 h-12 border-2 border-[#4758E0] rounded-xl flex items-center justify-center hover:bg-[#4758E0]/10 transition-colors">
                            <svg className="w-5 h-5 text-[#4758E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                            </svg>
                        </button>

                        {/* View as Slides Button */}
                        <button
                            onClick={handleViewAsSlides}
                            className="px-6 py-3 bg-[#4758E0] text-white rounded-xl hover:bg-[#4758E0]/90 transition-colors text-sm font-medium"
                        >
                            View as Slides
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Main Content Area */}
                    <div className="lg:col-span-3">
                        {/* Course Header */}
                        <div className="mb-8">
                            <div className="inline-flex items-center px-3 py-1 bg-[#4758E0]/10 text-[#4758E0] text-sm font-medium rounded-full mb-4">
                                CARF Policy
                            </div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-4">{courseTitle}</h1>
                            <p className="text-gray-600 mb-4">(8 of 16 Completed)</p>
                        </div>

                        {/* Course Content */}
                        <div className="bg-white rounded-lg border border-gray-200 p-8 mb-8">
                            <div className="prose prose-lg max-w-none text-gray-700">
                                {content ? (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkMath, remarkGfm]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={components}
                                    >
                                        {content}
                                    </ReactMarkdown>
                                ) : (
                                    <p className="text-gray-500 italic">No content available.</p>
                                )}
                            </div>
                        </div>

                        {/* Navigation */}
                        <div className="flex items-center justify-between">
                            <button 
                                onClick={() => router.push('/worker/courses')}
                                className="flex items-center gap-2 px-4 py-2 text-[#4758E0] hover:text-[#4758E0]/80"
                            >
                                <ChevronLeft className="w-4 h-4" />
                                Back to Courses
                            </button>
                            <button 
                                onClick={handleStartQuiz}
                                className="flex items-center gap-2 px-4 py-2 bg-[#4758E0] text-white rounded-lg hover:bg-[#4758E0]/90"
                            >
                                Start Quiz
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Sidebar - Table of Contents */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-lg border border-gray-200 p-6 sticky top-8 max-h-[calc(100vh-200px)] overflow-y-auto">
                            <h3 className="text-lg font-bold text-gray-900 mb-4">Table of Content</h3>
                            <div className="space-y-2">
                                {headings.length > 0 ? (
                                    visibleHeadings.map((heading, index) => (
                                        <button
                                            key={index}
                                            onClick={() => scrollToHeading(heading.id)}
                                            className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors"
                                        >
                                            {heading.text}
                                        </button>
                                    ))
                                ) : (
                                    <>
                                        <button className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors">
                                            Benefits of remote worksop
                                        </button>
                                        <button className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors">
                                            Challenges for remote workshops
                                        </button>
                                        <button className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors">
                                            What goes into a successful remote work...
                                        </button>
                                        <button className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors">
                                            Best practices for a remote workshop
                                        </button>
                                        <button className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors">
                                            Common remote workshop mistakes
                                        </button>
                                        <button className="block w-full text-left text-sm py-2 px-3 text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors">
                                            Tools needed for remote workshops
                                        </button>
                                    </>
                                )}

                                {headings.length > 7 && (
                                    <button
                                        onClick={() => setShowAllModules(!showAllModules)}
                                        className="w-full text-center py-2 text-xs text-[#4758E0] hover:bg-[#4758E0]/10 rounded-lg transition-colors"
                                    >
                                        {showAllModules ? 'Show less' : `Show ${remainingCount} more`}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
