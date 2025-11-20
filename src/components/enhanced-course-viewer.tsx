"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle, ArrowDown } from "lucide-react";

interface EnhancedCourseViewerProps {
    lessonContent: string;
    courseTitle: string;
    onComplete: () => void;
}

export default function EnhancedCourseViewer({
    lessonContent,
    courseTitle,
    onComplete,
}: EnhancedCourseViewerProps) {
    const [scrolledToBottom, setScrolledToBottom] = useState(false);
    const [scrollProgress, setScrollProgress] = useState(0);
    const contentRef = useRef<HTMLDivElement>(null);
    const bottomMarkerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        const handleScroll = () => {
            const scrollTop = contentElement.scrollTop;
            const scrollHeight = contentElement.scrollHeight;
            const clientHeight = contentElement.clientHeight;

            // Calculate scroll progress
            const progress = (scrollTop / (scrollHeight - clientHeight)) * 100;
            setScrollProgress(Math.min(progress, 100));

            // Check if scrolled to bottom (with small threshold)
            const threshold = 50; // pixels from bottom
            const isAtBottom = scrollHeight - scrollTop - clientHeight < threshold;

            if (isAtBottom && !scrolledToBottom) {
                setScrolledToBottom(true);
            }
        };

        contentElement.addEventListener("scroll", handleScroll);

        // Initial check in case content is short enough to not need scrolling
        handleScroll();

        return () => contentElement.removeEventListener("scroll", handleScroll);
    }, [scrolledToBottom]);

    // Alternative: Use IntersectionObserver for bottom detection
    useEffect(() => {
        const bottomMarker = bottomMarkerRef.current;
        if (!bottomMarker) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting && !scrolledToBottom) {
                        setScrolledToBottom(true);
                    }
                });
            },
            { threshold: 1.0 }
        );

        observer.observe(bottomMarker);

        return () => observer.disconnect();
    }, [scrolledToBottom]);

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Progress Bar */}
            <div className="h-1 bg-gray-200">
                <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${scrollProgress}%` }}
                />
            </div>

            {/* Content Area */}
            <div
                ref={contentRef}
                className="p-8 max-h-[600px] overflow-y-auto prose max-w-none"
            >
                <div dangerouslySetInnerHTML={{ __html: lessonContent }} />

                {/* Bottom marker for IntersectionObserver */}
                <div ref={bottomMarkerRef} className="h-1" />
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 p-6 bg-slate-50">
                {!scrolledToBottom ? (
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 text-slate-600 mb-3">
                            <ArrowDown className="w-5 h-5 animate-bounce" />
                            <p className="text-sm font-medium">
                                Please scroll to the bottom to review all content
                            </p>
                        </div>
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                            <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-600 transition-all duration-300"
                                    style={{ width: `${scrollProgress}%` }}
                                />
                            </div>
                            <span>{Math.round(scrollProgress)}%</span>
                        </div>
                    </div>
                ) : (
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 text-green-600 mb-4">
                            <CheckCircle className="w-5 h-5" />
                            <p className="text-sm font-medium">
                                You&apos;ve reviewed all the content!
                            </p>
                        </div>
                        <button
                            onClick={onComplete}
                            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                        >
                            Continue to Quiz
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
