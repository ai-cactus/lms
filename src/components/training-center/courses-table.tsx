"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink, Download, Loader2 } from "lucide-react";
import { useState } from "react";

interface Course {
    id: string;
    title: string;
    level: string;
    assignedStaff: number;
    completion: number;
    dateCreated: string;
}

interface CoursesTableProps {
    courses: Course[];
}

export function CoursesTable({ courses }: CoursesTableProps) {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        if (isExporting) return;

        setIsExporting(true);
        try {
            const response = await fetch('/api/training-center/export');
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Training_Center_Report_${new Date().toISOString().split('T')[0]}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } else {
                alert('Failed to generate PDF report');
            }
        } catch (error) {
            console.error('Error downloading PDF:', error);
            alert('Failed to download PDF report');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">My Courses</h3>
                <div className="flex items-center gap-4">
                    <input
                        type="search"
                        placeholder="Search for courses..."
                        className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isExporting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Exporting...
                            </>
                        ) : (
                            <>
                                <Download className="w-4 h-4" />
                                Export
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-white border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Course Name
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Assigned Staff
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Date Created
                            </th>
                            <th className="px-6 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {courses.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                                    No courses found. Create your first course to get started!
                                </td>
                            </tr>
                        ) : (
                            courses.map((course) => (
                                <tr key={course.id} className="hover:bg-white transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <span className="text-blue-600 font-semibold text-sm">
                                                    {course.title.charAt(0)}
                                                </span>
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-900">{course.title}</p>
                                                <p className="text-sm text-slate-500">{course.level}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-slate-700">{course.assignedStaff}</td>
                                    <td className="px-6 py-4 text-slate-700">{course.dateCreated}</td>
                                    <td className="px-6 py-4">
                                        <Link
                                            href={`/admin/courses/${course.id}`}
                                            className="text-slate-400 hover:text-blue-600 transition-colors"
                                        >
                                            <ChevronRight className="w-5 h-5" />
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            {courses.length > 0 && (
                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-center">
                    <Link
                        href="/admin/courses"
                        className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                    >
                        View all
                        <ExternalLink className="w-4 h-4" />
                    </Link>
                </div>
            )}
        </div>
    );
}
