"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
    Award,
    CheckCircle,
    Download,
    ChevronRight,
    BookOpen
} from "lucide-react";
import { getBadgeForAssignment, getBadgeDetails } from "@/app/actions/badge";
import { getAssignmentForAttestation } from "@/app/actions/attestation";

export default function CourseCompletePage({ params }: { params: Promise<{ assignmentId: string }> }) {
    const { assignmentId } = use(params);
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [badge, setBadge] = useState<any>(null);
    const [assignment, setAssignment] = useState<any>(null);

    useEffect(() => {
        loadData();
    }, [assignmentId]);

    const loadData = async () => {
        try {
            // Get assignment info
            const assignmentResult = await getAssignmentForAttestation(assignmentId);
            if (assignmentResult.success && assignmentResult.assignment) {
                setAssignment(assignmentResult.assignment);
            }

            // Get badge
            const badgeResult = await getBadgeForAssignment(assignmentId);
            if (badgeResult.success && badgeResult.badge) {
                // Get full badge details
                const detailsResult = await getBadgeDetails(badgeResult.badge.id);
                if (detailsResult.success && detailsResult.badge) {
                    setBadge(detailsResult.badge);
                }
            }

            setLoading(false);
        } catch (err) {
            console.error("Error loading completion data:", err);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-slate-600">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <main className="max-w-2xl mx-auto px-4 py-12">
                {/* Success Icon */}
                <div className="text-center mb-8">
                    <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-14 h-14 text-green-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-3">
                        Course Completed
                    </h1>
                    <p className="text-slate-600 text-lg">
                        Your quiz result, attestation, and badge record have been saved.
                    </p>
                </div>

                {/* Summary Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">Completion Summary</h2>

                    <div className="space-y-4">
                        {assignment && (
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                                    <BookOpen className="w-6 h-6 text-indigo-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Course</p>
                                    <p className="font-semibold text-slate-900">{assignment.courseTitle}</p>
                                </div>
                            </div>
                        )}

                        {assignment?.quizScore !== undefined && (
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Quiz Score</p>
                                    <p className="font-semibold text-slate-900">{assignment.quizScore}%</p>
                                </div>
                            </div>
                        )}

                        {badge && (
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                                    <Award className="w-6 h-6 text-purple-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Badge ID</p>
                                    <p className="font-semibold text-slate-900 font-mono">{badge.badgeIdDisplay}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                    {badge && (
                        <button
                            onClick={() => router.push(`/worker/badge/${badge.id}`)}
                            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                        >
                            <Award className="w-5 h-5" />
                            View My Badge
                        </button>
                    )}

                    <button
                        onClick={() => {/* TODO: Implement download */ }}
                        className="w-full py-4 bg-white text-slate-700 rounded-xl font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 border border-gray-200"
                    >
                        <Download className="w-5 h-5" />
                        Download Completion Record
                    </button>

                    <button
                        onClick={() => router.push('/worker/dashboard')}
                        className="w-full py-3 text-indigo-600 font-medium hover:text-indigo-700 transition-colors flex items-center justify-center gap-1"
                    >
                        Go to My Courses
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </main>
        </div>
    );
}
