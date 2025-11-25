"use client";

import { useMemo, useState, useEffect } from "react";
import { PencilSimple, FileText, BookOpen, X, Hexagon, CaretDown, CaretUp } from "@phosphor-icons/react";
import { CourseData } from "@/types/course";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface Step5ReviewContentProps {
    data: CourseData;
    onNext: () => void;
    onBack: () => void;
    isGenerating?: boolean;
}

interface Heading {
    id: string;
    text: string;
    level: number;
}

export function Step5ReviewContent({ data, onNext, onBack, isGenerating }: Step5ReviewContentProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState("");
    const [isSlideView, setIsSlideView] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [showAllModules, setShowAllModules] = useState(false);

    // Split content into slides based on H2 headings
    const slides = useMemo(() => {
        if (!data.generatedContent) return [];

        const lines = data.generatedContent.split('\n');
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
    }, [data.generatedContent]);

    // Extract headings from markdown content for table of contents
    const headings = useMemo(() => {
        if (!data.generatedContent) return [];

        const headingRegex = /^(#{2,3})\s+(.+)$/gm;
        const extractedHeadings: Heading[] = [];
        let match;

        while ((match = headingRegex.exec(data.generatedContent)) !== null) {
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
    }, [data.generatedContent]);

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

    const handleEdit = () => {
        setEditedContent(data.generatedContent || "");
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        setIsEditing(false);
        alert("Content saved! (Note: This is a preview. In production, this would update the course data.)");
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedContent("");
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
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSlideView, currentSlide, slides.length]);

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
            <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col">
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
                                <span className="text-slate-900">{data.title || 'Course Content'}</span>
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
                                    onClick={handleExitSlides}
                                    className="absolute right-8 top-1/2 -translate-y-1/2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex items-center gap-2"
                                >
                                    Next <CaretRight />
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

    return (
        <div className="flex flex-col h-full">
            <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Course Content</h2>
                <p className="text-slate-500 max-w-2xl mx-auto">
                    Review the AI-generated course content based on your uploaded documents. You can edit this now if needed.
                </p>
            </div>

            <div className="flex gap-8 flex-1 min-h-0">
                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto pr-4">
                    <div className="bg-white rounded-lg">
                        {isGenerating ? (
                            <div className="space-y-4">
                                <div className="animate-pulse">
                                    <div className="h-8 bg-slate-200 rounded w-3/4 mb-4"></div>
                                    <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
                                    <div className="h-4 bg-slate-200 rounded w-5/6 mb-8"></div>

                                    <div className="h-6 bg-slate-200 rounded w-1/2 mb-4"></div>
                                    <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
                                    <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
                                    <div className="h-4 bg-slate-200 rounded w-4/5 mb-8"></div>

                                    <div className="h-6 bg-slate-200 rounded w-2/3 mb-4"></div>
                                    <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
                                    <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
                                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                                </div>
                                <div className="text-center text-slate-600 mt-8">
                                    <p className="font-medium">Generating course content...</p>
                                    <p className="text-sm text-slate-500 mt-2">This may take a minute or two</p>
                                </div>
                            </div>
                        ) : (
                            <>

                                <div className="prose prose-slate max-w-none">
                                    {data.generatedContent ? (
                                        isEditing ? (
                                            <textarea
                                                value={editedContent}
                                                onChange={(e) => setEditedContent(e.target.value)}
                                                className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm resize-y"
                                                placeholder="Edit your course content in Markdown format..."
                                            />
                                        ) : (
                                            <ReactMarkdown
                                                remarkPlugins={[remarkMath, remarkGfm]}
                                                rehypePlugins={[rehypeKatex]}
                                                components={components}
                                            >
                                                {data.generatedContent}
                                            </ReactMarkdown>
                                        )
                                    ) : (
                                        <p className="text-slate-500 italic">No content generated yet.</p>
                                    )}
                                </div>

                                <div className="flex justify-between items-center mt-8 pt-8 border-t border-gray-200">
                                    {isEditing ? (
                                        <>
                                            <button
                                                onClick={handleCancelEdit}
                                                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-gray-50 text-sm font-medium"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleSaveEdit}
                                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                                            >
                                                Save Changes
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={onBack}
                                                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-gray-50 text-sm font-medium"
                                            >
                                                <CaretLeft /> Previous Step
                                            </button>
                                            <button
                                                onClick={onNext}
                                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                                            >
                                                Next Step <CaretRight />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                <div className="w-80 flex-shrink-0">
                    {!isEditing && !isGenerating && (
                        <>
                            <button
                                onClick={handleEdit}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-slate-700 font-medium hover:bg-gray-50 mb-3 transition-colors"
                            >
                                <PencilSimple className="text-lg" />
                                Edit Content
                            </button>
                            <button
                                onClick={handleViewAsSlides}
                                disabled={slides.length === 0}
                                className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 mb-8 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                View as Slides
                            </button>
                        </>
                    )}

                    <div className="bg-white rounded-lg border border-gray-200 p-4 max-h-[calc(100vh-16rem)] flex flex-col">
                        <h3 className="font-bold text-slate-900 mb-4">Table of Content</h3>
                        {isGenerating ? (
                            <div className="space-y-3">
                                <div className="h-4 bg-slate-200 rounded animate-pulse"></div>
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-5/6"></div>
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-4/5"></div>
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-full"></div>
                            </div>
                        ) : headings.length > 0 ? (
                            <div className="space-y-3 text-sm overflow-y-auto flex-1 -mr-2 pr-2">
                                {visibleHeadings.map((heading, index) => (
                                    <button
                                        key={index}
                                        onClick={() => scrollToHeading(heading.id)}
                                        className={`block text-left w-full hover:text-blue-600 transition-colors ${heading.level === 2
                                            ? 'text-blue-600 font-medium'
                                            : 'text-slate-600 pl-3'
                                            }`}
                                    >
                                        {heading.text}
                                    </button>
                                ))}

                                {/* Show More/Less Button */}
                                {headings.length > 7 && (
                                    <button
                                        onClick={() => setShowAllModules(!showAllModules)}
                                        className="w-full flex items-center justify-center gap-2 px-3 py-2 mt-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors"
                                    >
                                        {showAllModules ? (
                                            <>
                                                <CaretUp size={16} />
                                                Show Less
                                            </>
                                        ) : (
                                            <>
                                                <CaretDown size={16} />
                                                Show {remainingCount} more module{remainingCount > 1 ? 's' : ''}
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 italic">No headings found in content</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

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
