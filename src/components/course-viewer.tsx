"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { motion, useScroll, useSpring } from "framer-motion";
import { ChevronRight, BookOpen, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface CourseViewerProps {
    content: string;
    onComplete: () => void;
}

export function CourseViewer({ content, onComplete }: CourseViewerProps) {
    const [activeSection, setActiveSection] = useState<string>("");
    const [readSections, setReadSections] = useState<Set<string>>(new Set());
    const [showAllModules, setShowAllModules] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: contentRef,
        offset: ["start start", "end end"],
    });
    const scaleX = useSpring(scrollYProgress, {
        stiffness: 100,
        damping: 30,
        restDelta: 0.001,
    });

    // Extract headings for sidebar
    const headings = content.match(/^#{1,3}\s.+/gm) || [];
    const outline = headings.map((h) => {
        const level = h.match(/^#+/)?.[0].length || 1;
        const title = h.replace(/^#+\s/, "");
        const id = title.toLowerCase().replace(/[^\w]+/g, "-");
        return { level, title, id };
    });

    useEffect(() => {
        // Add IDs to headings in the rendered content
        const elements = contentRef.current?.querySelectorAll("h1, h2, h3");
        elements?.forEach((el) => {
            if (!el.id) {
                el.id = el.textContent?.toLowerCase().replace(/[^\w]+/g, "-") || "";
            }
        });

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveSection(entry.target.id);
                        // Mark section as read when it comes into view
                        setReadSections((prev) => new Set(prev).add(entry.target.id));
                    }
                });
            },
            { rootMargin: "-20% 0px -35% 0px" }
        );

        elements?.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, [content]);

    useEffect(() => {
        // Set initial active section to first heading
        const elements = contentRef.current?.querySelectorAll("h1, h2, h3");
        if (elements && elements.length > 0 && !activeSection) {
            setActiveSection(elements[0].id);
            setReadSections(new Set([elements[0].id]));
        }
    }, [content, activeSection]);

    const scrollToSection = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: "smooth" });
        }
    };

    // Filter outline for display (show first 7 by default)
    const visibleOutline = showAllModules ? outline : outline.slice(0, 7);
    const remainingCount = outline.length - 7;

    return (
        <div className="flex h-screen overflow-hidden bg-white text-slate-900">
            {/* Sidebar */}
            <div className="w-80 flex-shrink-0 bg-white p-6 hidden lg:block">
                <div className="sticky top-6 bg-white border border-gray-200 rounded-lg shadow-sm p-6 max-h-[calc(100vh-3rem)] flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 rounded-lg bg-indigo-50">
                            <BookOpen className="w-5 h-5 text-indigo-600" />
                        </div>
                        <h2 className="font-bold text-lg text-slate-900">Course Outline</h2>
                    </div>

                    {/* Progress Indicator */}
                    <div className="mb-8 p-4 rounded-lg bg-white border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-slate-500">Progress</span>
                            <span className="text-sm font-bold text-indigo-600">
                                {Math.round((readSections.size / outline.length) * 100)}%
                            </span>
                        </div>
                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-indigo-600"
                                initial={{ width: 0 }}
                                animate={{ width: `${(readSections.size / outline.length) * 100}%` }}
                                transition={{ duration: 0.5 }}
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            {readSections.size} of {outline.length} sections completed
                        </p>
                    </div>

                    <nav className="space-y-1 overflow-y-auto flex-1 -mr-2 pr-2 scrollbar-thin">
                        {visibleOutline.map((item, index) => (
                            <button
                                key={index}
                                onClick={() => scrollToSection(item.id)}
                                className={cn(
                                    "w-full text-left px-4 py-3 rounded-lg transition-colors duration-200 flex items-center gap-3",
                                    activeSection === item.id
                                        ? "bg-indigo-50 text-indigo-700 font-semibold"
                                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
                                    // H1 - Largest, no indent
                                    item.level === 1 && "text-base font-bold",
                                    // H2 - Medium, slight indent
                                    item.level === 2 && "text-sm pl-6 font-medium",
                                    // H3 - Smaller, more indent
                                    item.level === 3 && "text-xs pl-10"
                                )}
                            >
                                {readSections.has(item.id) ? (
                                    <CheckCircle className={cn(
                                        "text-green-500 flex-shrink-0",
                                        item.level === 1 && "w-5 h-5",
                                        item.level === 2 && "w-4 h-4",
                                        item.level === 3 && "w-3.5 h-3.5"
                                    )} />
                                ) : (
                                    <div className={cn(
                                        "rounded-full border-2 border-slate-300 flex-shrink-0",
                                        item.level === 1 && "w-5 h-5",
                                        item.level === 2 && "w-4 h-4",
                                        item.level === 3 && "w-3.5 h-3.5"
                                    )} />
                                )}
                                <span className="truncate leading-tight">{item.title}</span>
                            </button>
                        ))}

                        {/* Show More/Less Button */}
                        {outline.length > 7 && (
                            <button
                                onClick={() => setShowAllModules(!showAllModules)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 mt-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors"
                            >
                                {showAllModules ? (
                                    <>
                                        <ChevronUp className="w-4 h-4" />
                                        Show Less
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="w-4 h-4" />
                                        Show {remainingCount} more module{remainingCount > 1 ? 's' : ''}
                                    </>
                                )}
                            </button>
                        )}
                    </nav>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 relative overflow-hidden flex flex-col bg-white">
                {/* Progress Bar */}
                <motion.div
                    className="absolute top-0 left-0 right-0 h-1 bg-indigo-600 origin-left z-50"
                    style={{ scaleX }}
                />

                <div
                    ref={contentRef}
                    className="flex-1 overflow-y-auto p-8 lg:p-16 scroll-smooth"
                >
                    <div className="max-w-3xl mx-auto prose prose-slate prose-lg 
                        prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900
                        prose-h1:!text-4xl prose-h1:!mb-8 prose-h1:!mt-0 prose-h1:pb-4 prose-h1:border-b prose-h1:border-slate-200
                        prose-h2:!text-2xl prose-h2:!mt-12 prose-h2:!mb-6
                        prose-h3:!text-xl prose-h3:!mt-8 prose-h3:!mb-4
                        prose-p:text-slate-600 prose-p:leading-relaxed prose-p:mb-6
                        prose-strong:text-slate-900 prose-strong:font-semibold
                        prose-code:text-indigo-600 prose-code:bg-indigo-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                        prose-pre:bg-slate-900 prose-pre:text-slate-50 prose-pre:rounded-xl prose-pre:p-6
                        prose-ul:my-6 prose-ul:space-y-2
                        prose-ol:my-6 prose-ol:space-y-2
                        prose-li:text-slate-600
                        prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-50 prose-blockquote:py-4 prose-blockquote:text-slate-700
                        prose-table:border-collapse prose-table:w-full
                        prose-th:bg-white prose-th:border prose-th:border-slate-200 prose-th:p-3 prose-th:text-slate-900
                        prose-td:border prose-td:border-slate-200 prose-td:p-3 prose-td:text-slate-600
                        prose-img:rounded-xl prose-img:shadow-lg"
                    >
                        <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                        >
                            {content}
                        </ReactMarkdown>

                        {/* End of Course Action */}
                        <div className="mt-20 pt-10 border-t border-slate-200 flex flex-col items-center text-center">
                            <h3 className="text-2xl font-bold mb-4 text-slate-900">Course Completed</h3>
                            <p className="text-slate-500 mb-8">
                                You've reached the end of the material. Ready to test your knowledge?
                            </p>
                            <button
                                onClick={onComplete}
                                className="group relative px-8 py-4 bg-indigo-600 rounded-full font-bold text-lg text-white overflow-hidden transition-transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-indigo-200"
                            >
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                                <span className="relative flex items-center gap-2">
                                    Take the Quiz <ChevronRight className="w-5 h-5" />
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
