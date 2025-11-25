"use client";

import { X } from "lucide-react";

interface CoursePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    courseData: {
        title: string;
        description: string;
        objectives: string[];
        tableOfContents: string[];
    };
}

export default function CoursePreviewModal({ isOpen, onClose, courseData }: CoursePreviewModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose}></div>

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
                    {/* Header */}
                    <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                        <h2 className="text-2xl font-bold text-slate-900">Course Preview</h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-600" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="px-6 py-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                        {/* Course Title */}
                        <div className="mb-8">
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">{courseData.title}</h1>
                            <div className="h-1 w-20 bg-indigo-600 rounded"></div>
                        </div>

                        {/* Course Description */}
                        {courseData.description && (
                            <section className="mb-8">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">Course Overview</h3>
                                <div className="prose max-w-none text-slate-600 whitespace-pre-line">
                                    {courseData.description}
                                </div>
                            </section>
                        )}

                        {/* Learning Objectives */}
                        {courseData.objectives.length > 0 && (
                            <section className="mb-8">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">What You'll Learn</h3>
                                <ul className="space-y-3">
                                    {courseData.objectives.map((objective, index) => (
                                        <li key={index} className="flex items-start gap-3">
                                            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-600 flex-shrink-0"></span>
                                            <span className="text-slate-600">{objective}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Table of Contents */}
                        {courseData.tableOfContents.length > 0 && (
                            <section className="mb-8">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">Course Content</h3>
                                <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                                    <div className="space-y-2">
                                        {courseData.tableOfContents.map((item, index) => (
                                            <div key={index} className="flex items-start gap-3 text-sm text-slate-700">
                                                <span className="text-slate-400 font-medium">{index + 1}.</span>
                                                <span>{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Preview Notice */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800">
                                <span className="font-semibold">Preview Mode:</span> This is a read-only preview of the first page.
                                The full course content is available to assigned learners.
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
