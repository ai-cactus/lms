"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
    Award,
    CheckCircle,
    AlertCircle,
    ChevronRight,
    ExternalLink,
    Calendar,
    Building,
    Hash
} from "lucide-react";
import {
    getBadgeDetails,
    acknowledgeBadge
} from "@/app/actions/badge";

export default function BadgePage({ params }: { params: Promise<{ badgeId: string }> }) {
    const { badgeId } = use(params);
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [badge, setBadge] = useState<any>(null);
    const [fullName, setFullName] = useState("");
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState("");
    const [showAcknowledgement, setShowAcknowledgement] = useState(false);

    useEffect(() => {
        loadBadge();
    }, [badgeId]);

    const loadBadge = async () => {
        try {
            const result = await getBadgeDetails(badgeId);
            if (!result.success || !result.badge) {
                setError("Badge not found");
                setLoading(false);
                return;
            }

            setBadge(result.badge);
            setLoading(false);
        } catch (err) {
            console.error("Error loading badge:", err);
            setError("Failed to load badge");
            setLoading(false);
        }
    };

    const handleAcknowledge = async () => {
        setError("");

        if (!agreed) {
            setError("Please confirm you agree to continue.");
            return;
        }

        if (!fullName || fullName.trim().length < 2) {
            setError("Please type your full legal name.");
            return;
        }

        setSubmitting(true);

        try {
            const result = await acknowledgeBadge({
                badgeId,
                fullNameSignature: fullName.trim(),
                agreedCheckbox: agreed,
                userAgent: navigator.userAgent
            });

            if (!result.success) {
                setError(result.error || "Failed to acknowledge badge");
                setSubmitting(false);
                return;
            }

            // Redirect to completion screen
            router.push(`/worker/course-complete/${badge.assignmentId}`);
        } catch (err) {
            console.error("Error acknowledging badge:", err);
            setError("An error occurred. Please try again.");
            setSubmitting(false);
        }
    };

    // Replace template placeholders
    const getFormattedStatement = () => {
        if (!badge) return "";

        return badge.statementTemplate
            .replace(/{Employee Full Name}/g, badge.workerName)
            .replace(/{Course Title}/g, badge.courseTitle)
            .replace(/{Organization Name}/g, badge.issuingOrganization)
            .replace(/{Issued Date}/g, new Date(badge.issuedAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric"
            }))
            .replace(/{Badge ID}/g, badge.badgeIdDisplay);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-slate-600">Loading badge...</div>
            </div>
        );
    }

    if (!badge) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">Error</h2>
                    <p className="text-slate-600">{error || "Unable to load badge"}</p>
                </div>
            </div>
        );
    }

    // Badge Acknowledgement Screen
    if (showAcknowledgement) {
        return (
            <div className="min-h-screen bg-gray-50">
                <main className="max-w-2xl mx-auto px-4 py-8">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">
                            Acknowledge Badge Statement
                        </h1>
                        <p className="text-slate-600">{badge.courseTitle}</p>
                    </div>

                    {/* Intro */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                        <p className="text-blue-800 text-sm">
                            This acknowledgement confirms the badge claim is accurate.
                        </p>
                    </div>

                    {/* Badge Statement */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                        <h2 className="text-lg font-bold text-slate-900 mb-4">
                            Badge Statement
                        </h2>

                        <div className="prose prose-sm prose-slate max-w-none mb-6 bg-gray-50 p-4 rounded-xl">
                            {getFormattedStatement().split('\n').map((line, index) => (
                                <p key={index} className="text-slate-700 mb-2 text-sm">
                                    {line}
                                </p>
                            ))}
                        </div>

                        {/* Agreement Section */}
                        <div className="border-t border-gray-100 pt-6 space-y-5">
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <div className="relative mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={agreed}
                                        onChange={(e) => setAgreed(e.target.checked)}
                                        className="sr-only"
                                    />
                                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${agreed
                                            ? "bg-indigo-600 border-indigo-600"
                                            : "border-gray-300 group-hover:border-gray-400"
                                        }`}>
                                        {agreed && (
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                <span className="text-sm text-slate-700 font-medium">
                                    I acknowledge and agree.
                                </span>
                            </label>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Type your full legal name
                                </label>
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder="e.g., Jane Doe"
                                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-slate-900"
                                />
                            </div>

                            <p className="text-xs text-slate-400">
                                This acknowledgement is saved for audit and compliance records.
                            </p>
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                            <p className="text-red-700 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Button */}
                    <button
                        onClick={handleAcknowledge}
                        disabled={submitting}
                        className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
                    >
                        {submitting ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                Acknowledge Badge
                                <ChevronRight className="w-5 h-5" />
                            </>
                        )}
                    </button>

                    <button
                        onClick={() => setShowAcknowledgement(false)}
                        className="w-full mt-4 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors"
                    >
                        Back
                    </button>
                </main>
            </div>
        );
    }

    // Badge Issued Screen
    return (
        <div className="min-h-screen bg-gray-50">
            <main className="max-w-2xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200">
                        <Award className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        {badge.requiresAcknowledgement && !badge.isAcknowledged
                            ? "Badge Ready"
                            : "Badge Issued"}
                    </h1>
                    <p className="text-slate-600">{badge.courseTitle}</p>
                </div>

                {/* Badge requires acknowledgement message */}
                {badge.requiresAcknowledgement && !badge.isAcknowledged && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                        <p className="text-amber-800 text-sm">
                            Before you finish, acknowledge the badge statement below.
                        </p>
                    </div>
                )}

                {/* Badge Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                    {/* Badge Header */}
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-center">
                        <h2 className="text-white font-bold text-lg mb-1">
                            Verified Training Completion Badge
                        </h2>
                        <p className="text-indigo-100 text-sm">{badge.courseTitle}</p>
                    </div>

                    {/* Badge Details */}
                    <div className="p-6 space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Building className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Issued by</p>
                                <p className="text-slate-900 font-medium">{badge.issuingOrganization}</p>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Calendar className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Issued on</p>
                                <p className="text-slate-900 font-medium">
                                    {new Date(badge.issuedAt).toLocaleDateString("en-US", {
                                        month: "long",
                                        day: "numeric",
                                        year: "numeric"
                                    })}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Hash className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Badge ID</p>
                                <p className="text-slate-900 font-mono font-medium">{badge.badgeIdDisplay}</p>
                            </div>
                        </div>

                        {badge.verificationUrl && (
                            <a
                                href={badge.verificationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                            >
                                <ExternalLink className="w-4 h-4" />
                                View Verification
                            </a>
                        )}
                    </div>

                    {/* Status */}
                    <div className="border-t border-gray-100 p-4 bg-gray-50">
                        <div className="flex items-center justify-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="text-green-700 font-medium text-sm">
                                {badge.isAcknowledged ? "Acknowledged" : "Verified Badge"}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                {badge.requiresAcknowledgement && !badge.isAcknowledged ? (
                    <>
                        <button
                            onClick={() => setShowAcknowledgement(true)}
                            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                        >
                            Acknowledge Badge
                            <ChevronRight className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => router.push("/worker/dashboard")}
                            className="w-full mt-4 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors"
                        >
                            View Badge Details Later
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => router.push(`/worker/course-complete/${badge.assignmentId}`)}
                            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                        >
                            View Completion Summary
                            <ChevronRight className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => router.push("/worker/dashboard")}
                            className="w-full mt-4 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors"
                        >
                            Finish
                        </button>
                    </>
                )}
            </main>
        </div>
    );
}
