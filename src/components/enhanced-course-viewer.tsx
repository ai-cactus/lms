"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle, ArrowLeft, ArrowRight, Lightbulb, Eye } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";

interface EnhancedCourseViewerProps {
    lessonContent: string;
    courseTitle: string;
    onComplete: () => void;
}

interface Section {
    id: string;
    title: string;
    level: number;
}

export default function EnhancedCourseViewer({
    lessonContent,
    courseTitle,
    onComplete,
}: EnhancedCourseViewerProps) {
    const [sections, setSections] = useState<Section[]>([]);
    const [activeSection, setActiveSection] = useState<string>("");
    const [scrollProgress, setScrollProgress] = useState(0);
    const [completedSections, setCompletedSections] = useState<number>(0);
    const contentRef = useRef<HTMLDivElement>(null);

    // Extract sections from content on mount
    useEffect(() => {
        const extractedSections: Section[] = [];
        const lines = lessonContent.split("\n");

        lines.forEach((line, index) => {
            // Match markdown headers (# Header or ## Header)
            const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                const title = headerMatch[2].trim();
                extractedSections.push({
                    id: `section-${index}`,
                    title,
                    level,
                });
            }
        });

        setSections(extractedSections);
    }, [lessonContent]);

    // Track scroll progress
    useEffect(() => {
        const handleScroll = () => {
            if (!contentRef.current) return;

            const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
            const progress = (scrollTop / (scrollHeight - clientHeight)) * 100;
            setScrollProgress(Math.min(Math.max(progress, 0), 100));

            // Calculate completed sections (mock calculation)
            const completed = Math.floor((progress / 100) * sections.length);
            setCompletedSections(Math.min(completed, sections.length));
        };

        const contentElement = contentRef.current;
        if (contentElement) {
            contentElement.addEventListener("scroll", handleScroll);
            handleScroll(); // Initial call
        }

        return () => contentElement?.removeEventListener("scroll", handleScroll);
    }, [sections.length]);

    const scrollToSection = (sectionId: string) => {
        const element = document.getElementById(sectionId);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
            setActiveSection(sectionId);
        }
    };

    // Add IDs to headers in the markdown content
    const processedContent = lessonContent.split("\n").map((line, index) => {
        const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (headerMatch) {
            return `<div id="section-${index}">${line}</div>`;
        }
        return line;
    }).join("\n");

    return (
        <div className="flex flex-col h-screen bg-white">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-8 py-5">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                            CARF Policy
                        </span>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">{courseTitle}</h1>
                            <p className="text-sm text-slate-500 mt-0.5">
                                {completedSections} of {sections.length || 16} Completed
                            </p>
                        </div>
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors">
                        <Eye className="w-4 h-4" />
                        View as Slides
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Main Content */}
                <div
                    ref={contentRef}
                    className="flex-1 overflow-y-auto px-8 py-8"
                >
                    <div className="max-w-4xl mx-auto">
                        <article className="prose prose-lg max-w-none
                            prose-headings:font-bold prose-headings:text-slate-900
                            prose-h1:text-3xl prose-h1:mb-6
                            prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-8
                            prose-h3:text-xl prose-h3:mb-3 prose-h3:mt-6
                            prose-p:text-slate-700 prose-p:leading-relaxed
                            prose-li:text-slate-700
                            prose-strong:text-slate-900
                            prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline">

                            <ReactMarkdown
                                components={{
                                    blockquote: ({ children }) => (
                                        <div className="flex gap-3 p-4 bg-blue-50 border-l-4 border-blue-500 rounded-r-lg my-6 not-prose">
                                            <Lightbulb className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" weight="fill" />
                                            <div className="text-sm text-slate-700 leading-relaxed">
                                                {children}
                                            </div>
                                        </div>
                                    ),
                                }}
                            >
                                {processedContent}
                            </ReactMarkdown>
                        </article>
                    </div>
                </div>

                {/* Sidebar - Table of Contents */}
                <aside className="w-80 bg-white border-l border-gray-200 overflow-y-auto p-6">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
                        Table of Content
                    </h3>
                    <nav className="space-y-1">
                        {sections.length > 0 ? (
                            sections.map((section, index) => (
                                <button
                                    key={section.id}
                                    onClick={() => scrollToSection(section.id)}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${activeSection === section.id
                                            ? "bg-indigo-50 text-indigo-700 font-medium"
                                            : "text-slate-600 hover:bg-white hover:text-slate-900"
                                        } ${section.level === 2 ? "pl-6" : section.level === 3 ? "pl-9" : ""}`}
                                >
                                    {section.title}
                                </button>
                            ))
                        ) : (
                            <>
                                <a href="#benefits" className="block px-3 py-2 text-sm text-slate-600 hover:bg-white hover:text-slate-900 rounded-lg">
                                    Benefits of remote worksop
                                </a>
                                <a href="#challenges" className="block px-3 py-2 text-sm text-slate-600 hover:bg-white hover:text-slate-900 rounded-lg">
                                    Challenges for remote workshops
                                </a>
                                <a href="#successful" className="block px-3 py-2 text-sm text-slate-600 hover:bg-white hover:text-slate-900 rounded-lg">
                                    What goes into a successful remote work...
                                </a>
                                <a href="#best-practices" className="block px-3 py-2 text-sm text-indigo-700 bg-indigo-50 font-medium rounded-lg">
                                    Best practices for a remote workshop
                                </a>
                                <a href="#mistakes" className="block px-3 py-2 text-sm text-slate-600 hover:bg-white hover:text-slate-900 rounded-lg">
                                    Common remote workshop mistakes
                                </a>
                                <a href="#tools" className="block px-3 py-2 text-sm text-slate-600 hover:bg-white hover:text-slate-900 rounded-lg">
                                    Tools needed for remote workshops
                                </a>
                            </>
                        )}
                    </nav>
                </aside>
            </div>

            {/* Bottom Navigation */}
            <div className="bg-white border-t border-gray-200 px-8 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg transition-colors">
                        <ArrowLeft className="w-4 h-4" />
                        Previous
                    </button>

                    {scrollProgress >= 80 && (
                        <button
                            onClick={onComplete}
                            className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
                        >
                            Complete & Continue to Quiz
                        </button>
                    )}

                    <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition-colors">
                        Next
                        <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
