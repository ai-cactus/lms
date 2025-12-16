"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Download, Calendar, ArrowLeft, CheckCircle } from "lucide-react";

export default function ReportsPage() {
    const [generating, setGenerating] = useState(false);
    const router = useRouter();

    const handleGenerateReport = async () => {
        setGenerating(true);

        try {
            const response = await fetch("/api/reports/accreditation");

            if (!response.ok) {
                throw new Error("Failed to generate report");
            }

            // Get the blob
            const blob = await response.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `CARF_Training_Report_${new Date().toISOString().split("T")[0]}.md`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error("Error generating report:", error);
            alert("Failed to generate report. Please try again.");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-white py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/")}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </button>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Compliance Reports</h1>
                    <p className="text-slate-600">
                        Generate CARF accreditation reports for training compliance
                    </p>
                </div>

                {/* Report Cards */}
                <div className="space-y-6">
                    {/* Accreditation Report */}
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-indigo-100 rounded-lg">
                                <FileText className="w-8 h-8 text-indigo-600" />
                            </div>

                            <div className="flex-1">
                                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                    CARF Accreditation Training Report
                                </h3>
                                <p className="text-slate-600 mb-4">
                                    Comprehensive training compliance report for CARF accreditation surveys.
                                    Includes worker statistics, completion rates, and compliance metrics.
                                </p>

                                <div className="bg-white rounded-lg p-4 mb-4">
                                    <h4 className="font-medium text-slate-900 mb-2">Report Includes:</h4>
                                    <ul className="space-y-1 text-sm text-slate-700">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            Executive summary with key metrics
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            Compliance rates by worker role
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            Course completion statistics
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            Recent training completions
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            Overdue training assignments
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                            CARF compliance statement
                                        </li>
                                    </ul>
                                </div>

                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={handleGenerateReport}
                                        disabled={generating}
                                        className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                                    >
                                        {generating ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-5 h-5" />
                                                Generate Report
                                            </>
                                        )}
                                    </button>

                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <Calendar className="w-4 h-4" />
                                        <span>Generated: {new Date().toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Future Reports Placeholder */}
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 opacity-60">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-gray-100 rounded-lg">
                                <FileText className="w-8 h-8 text-gray-400" />
                            </div>

                            <div className="flex-1">
                                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                    Custom Training Reports
                                </h3>
                                <p className="text-slate-600 mb-4">
                                    Generate custom reports filtered by date range, role, or course.
                                </p>
                                <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded-full">
                                    Coming Soon
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 opacity-60">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-gray-100 rounded-lg">
                                <FileText className="w-8 h-8 text-gray-400" />
                            </div>

                            <div className="flex-1">
                                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                    Worker Training History
                                </h3>
                                <p className="text-slate-600 mb-4">
                                    Individual worker training records with certificates and completion dates.
                                </p>
                                <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded-full">
                                    Coming Soon
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Info Box */}
                <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-medium text-blue-900 mb-2">Report Format</h4>
                    <p className="text-sm text-blue-700">
                        Reports are generated in Markdown (.md) format, which can be easily converted to PDF or
                        DOCX using tools like Pandoc or online converters. The markdown format ensures
                        compatibility and easy editing if needed.
                    </p>
                </div>
            </div>
        </div>
    );
}
