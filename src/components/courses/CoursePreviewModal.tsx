"use client";

import { useMemo, useState, useEffect } from "react";
import { X } from "lucide-react";
import { Hexagon, CaretDown, CaretUp, CaretLeft, CaretRight } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface CoursePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    courseData: {
        title: string;
        content: string; // The raw markdown content (lesson_notes)
    };
}

interface Heading {
    id: string;
    text: string;
    level: number;
}

export default function CoursePreviewModal({ isOpen, onClose, courseData }: CoursePreviewModalProps) {
    const [isSlideView, setIsSlideView] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [showAllModules, setShowAllModules] = useState(false);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setIsSlideView(false);
            setCurrentSlide(0);
            setShowAllModules(false);
        }
    }, [isOpen]);

    // Split content into slides based on H2 headings
    const slides = useMemo(() => {
        if (!courseData.content) return [];

        const lines = courseData.content.split('\n');
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
    }, [courseData.content]);

    // Extract headings from markdown content for table of contents
    const headings = useMemo(() => {
        if (!courseData.content) return [];

        const headingRegex = /^(#{2,3})\s+(.+)$/gm;
        const extractedHeadings: Heading[] = [];
        let match;

        while ((match = headingRegex.exec(courseData.content)) !== null) {
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
    }, [courseData.content]);

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
            return <h2 id={id} className="text-2xl font-bold text-slate-900 mt-8 mb-4" {...props}>{children}</h2>;
        },
        h3: ({ children, ...props }: any) => {
            const text = String(children);
            const id = text
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .substring(0, 50);
            return <h3 id={id} className="text-xl font-bold text-slate-900 mt-6 mb-3" {...props}>{children}</h3>;
        },
        p: ({ children, ...props }: any) => (
            <p className="text-slate-700 mb-4 leading-relaxed" {...props}>{children}</p>
        ),
        ul: ({ children, ...props }: any) => (
            <ul className="list-disc pl-6 mb-4 text-slate-700 space-y-2" {...props}>{children}</ul>
        ),
        ol: ({ children, ...props }: any) => (
            <ol className="list-decimal pl-6 mb-4 text-slate-700 space-y-2" {...props}>{children}</ol>
        ),
        li: ({ children, ...props }: any) => (
            <li className="pl-1" {...props}>{children}</li>
        ),
        blockquote: ({ children, ...props }: any) => (
            <blockquote className="border-l-4 border-indigo-200 pl-4 italic text-slate-600 my-4" {...props}>{children}</blockquote>
        ),
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

    // Keyboard navigation
    useEffect(() => {
        if (!isSlideView) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') {
                handlePrevSlide();
            } else if (e.key === 'ArrowRight') {
                handleNextSlide();
            } else if (e.key === 'Escape') {
                handleExitSlides();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSlideView, currentSlide, slides.length]);

    if (!isOpen) return null;

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
            <div className="fixed inset-0 bg-white z-[60] flex flex-col">
                {/* Header */}
                <div className="bg-white border-b border-gray-200 px-8 py-4">
                    <div className="flex items-center justify-between max-w-7xl mx-auto">
                        <div className="flex items-center gap-2">
                            <Hexagon size={24} weight="fill" className="text-indigo-600" />
                            <span className="text-lg font-bold text-slate-900">Theraptly</span>
                        </div>

                        <div className="flex items-center gap-8">
                            {/* Breadcrumb */}
                            <div className="text-sm text-slate-500">
                                <span className="hover:text-indigo-600 cursor-pointer">Trainings</span>
                                <span className="mx-2">/</span>
                                <span className="text-slate-900">{courseData.title}</span>
                            </div>

                            {/* Progress */}
                            <div className="flex items-center gap-2">
                                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                                    <span className="text-sm font-bold text-indigo-600">
                                        {Math.round(((currentSlide + 1) / slides.length) * 100)}%
                                    </span>
                                </div>
                                <div className="text-xs text-slate-500">
                                    <div className="font-semibold">Your Progress</div>
                                    <div>{currentSlide + 1} of {slides.length} Completed</div>
                                </div>
                            </div>

                            {/* View as Notes Button */}
                            <button
                                onClick={handleExitSlides}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                            >
                                View as Notes
                            </button>

                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-600" />
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
                        <CaretLeft size={24} />
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
                                    onClick={handleExitSlides}
                                    className="absolute right-8 top-1/2 -translate-y-1/2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex items-center gap-2"
                                >
                                    Next <CaretRight size={16} />
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
                        <CaretRight size={24} />
                    </button>
                </div>

                {/* Thumbnail Strip */}
                <div className="bg-white border-t border-gray-200 px-8 py-3">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex gap-2 justify-center flex-wrap">
                            {slides.map((slide, index) => {
                                const slideH2 = slide.match(/^##\s+(.+)$/m)?.[1] || '';
                                return (
                                    <button
                                        key={index}
                                        onClick={() => setCurrentSlide(index)}
                                        className={`flex-shrink-0 w-28 h-16 rounded border-2 transition-all ${index === currentSlide
                                            ? 'border-indigo-600 shadow-md'
                                            : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                    >
                                        <div className="w-full h-full bg-white rounded overflow-hidden p-1.5">
                                            <div className="text-[5px] text-slate-600 line-clamp-3 font-mono leading-tight">
                                                {slideH2 || slide.substring(0, 80)}...
                                            </div>
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

    // Default View (Notes View)
    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose}></div>

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-6xl w-full h-[90vh] overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10 flex-shrink-0">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900">Course Preview</h2>
                            <p className="text-slate-500 text-sm">Viewing: {courseData.title}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-600" />
                        </button>
                    </div>

                    {/* Content Body */}
                    <div className="flex flex-1 min-h-0">
                        {/* Main Content Area */}
                        <div className="flex-1 overflow-y-auto p-8 bg-white">
                            <div className="bg-white rounded-lg shadow-sm p-8 min-h-full">
                                <div className="prose prose-slate max-w-none">
                                    {courseData.content ? (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkMath, remarkGfm]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={components}
                                        >
                                            {courseData.content}
                                        </ReactMarkdown>
                                    ) : (
                                        <p className="text-slate-500 italic">No content available.</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Sidebar */}
                        <div className="w-80 flex-shrink-0 border-l border-gray-200 bg-white p-4 flex flex-col">
                            <button
                                onClick={handleViewAsSlides}
                                disabled={slides.length === 0}
                                className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 mb-6 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Hexagon weight="fill" />
                                View as Slides
                            </button>

                            <div className="flex-1 overflow-y-auto">
                                <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wider">Table of Contents</h3>
                                {headings.length > 0 ? (
                                    <div className="space-y-1">
                                        {visibleHeadings.map((heading, index) => (
                                            <button
                                                key={index}
                                                onClick={() => scrollToHeading(heading.id)}
                                                className={`block text-left w-full py-2 px-3 rounded-lg hover:bg-white transition-colors text-sm ${heading.level === 2
                                                    ? 'text-blue-600 font-medium'
                                                    : 'text-slate-600 pl-6'
                                                    }`}
                                            >
                                                {heading.text}
                                            </button>
                                        ))}

                                        {/* Show More/Less Button */}
                                        {headings.length > 7 && (
                                            <button
                                                onClick={() => setShowAllModules(!showAllModules)}
                                                className="w-full flex items-center justify-center gap-2 px-3 py-2 mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-600/80 underline transition-colors"
                                            >
                                                {showAllModules ? (
                                                    <>
                                                        <CaretUp size={14} />
                                                        Show Less
                                                    </>
                                                ) : (
                                                    <>
                                                        <CaretDown size={14} />
                                                        Show {remainingCount} more
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 italic">No headings found</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
