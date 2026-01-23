"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, AlertCircle, ChevronRight } from "lucide-react";
import {
    getAttestationTemplate,
    getAssignmentForAttestation,
    signAttestation
} from "@/app/actions/attestation";
import { issueBadge } from "@/app/actions/badge";

export default function AttestationPage({ params }: { params: Promise<{ assignmentId: string }> }) {
    const { assignmentId } = use(params);
    const router = useRouter();
    const supabase = createClient();

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [assignment, setAssignment] = useState<any>(null);
    const [template, setTemplate] = useState<any>(null);
    const [fullName, setFullName] = useState("");
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState("");
    const [showConfirmation, setShowConfirmation] = useState(false);

    useEffect(() => {
        loadData();
    }, [assignmentId]);

    const loadData = async () => {
        try {
            // Get assignment details
            const assignmentResult = await getAssignmentForAttestation(assignmentId);
            if (!assignmentResult.success || !assignmentResult.assignment) {
                setError("Assignment not found");
                setLoading(false);
                return;
            }

            setAssignment(assignmentResult.assignment);

            // Get attestation template
            const templateResult = await getAttestationTemplate(assignmentResult.assignment.courseId);
            if (templateResult.success && templateResult.template) {
                setTemplate(templateResult.template);
            }

            setLoading(false);
        } catch (err) {
            console.error("Error loading attestation data:", err);
            setError("Failed to load attestation data");
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        setError("");

        // Validation
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
            // Sign the attestation
            const result = await signAttestation({
                assignmentId,
                fullNameSignature: fullName.trim(),
                agreedCheckbox: agreed,
                userAgent: navigator.userAgent
            });

            if (!result.success) {
                setError(result.error || "Failed to sign attestation");
                setSubmitting(false);
                return;
            }

            // Show confirmation modal
            setShowConfirmation(true);

            // Issue badge
            const badgeResult = await issueBadge({
                assignmentId,
                attestationId: result.attestationId!
            });

            // After short delay, redirect to badge page
            setTimeout(() => {
                if (badgeResult.success && badgeResult.badgeId) {
                    router.push(`/worker/badge/${badgeResult.badgeId}`);
                } else {
                    // Fallback to dashboard
                    router.push("/worker/dashboard?refresh=true");
                }
            }, 2000);
        } catch (err) {
            console.error("Error signing attestation:", err);
            setError("An error occurred. Please try again.");
            setSubmitting(false);
        }
    };

    // Replace template placeholders with actual values
    const getFormattedBody = () => {
        if (!template || !assignment) return "";

        return template.bodyTemplate
            .replace(/{Course Title}/g, assignment.courseTitle)
            .replace(/{Completion Date}/g, new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric"
            }));
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-slate-600">Loading attestation...</div>
            </div>
        );
    }

    if (!assignment || !template) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">Error</h2>
                    <p className="text-slate-600">{error || "Unable to load attestation"}</p>
                </div>
            </div>
        );
    }

    // Confirmation Modal
    if (showConfirmation) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-3">Attestation Signed</h2>
                    <p className="text-slate-600 mb-6">
                        Your attestation has been recorded. Next, we'll issue your completion badge.
                    </p>
                    <div className="flex items-center justify-center gap-2 text-indigo-600">
                        <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <main className="max-w-2xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Sign Training Attestation
                    </h1>
                    <p className="text-slate-600">{assignment.courseTitle}</p>
                </div>

                {/* Intro */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                    <p className="text-blue-800 text-sm">
                        Read the attestation carefully. Your signature will be saved for audit and compliance records.
                    </p>
                </div>

                {/* Attestation Content */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">
                        {template.title}
                    </h2>

                    <div className="prose prose-sm prose-slate max-w-none mb-6">
                        {getFormattedBody().split('\n').map((paragraph, index) => (
                            <p key={index} className="text-slate-700 mb-3">
                                {paragraph}
                            </p>
                        ))}
                    </div>

                    {/* Agreement Checkbox */}
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
                                I agree to the attestation above.
                            </span>
                        </label>

                        {/* Name Field */}
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
                            {assignment.workerName && (
                                <p className="text-sm text-slate-500 mt-2">
                                    Signing as: <span className="font-medium">{assignment.workerName}</span>
                                </p>
                            )}
                        </div>

                        {/* Disclosure */}
                        <p className="text-xs text-slate-400">
                            This signature is recorded with the date/time and your account details.
                        </p>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <p className="text-red-700 text-sm">{error}</p>
                    </div>
                )}

                {/* Submit Button */}
                <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
                >
                    {submitting ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Signing...
                        </>
                    ) : (
                        <>
                            Sign Attestation
                            <ChevronRight className="w-5 h-5" />
                        </>
                    )}
                </button>

                {/* Back Link */}
                <button
                    onClick={() => router.back()}
                    className="w-full mt-4 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors"
                >
                    Back to quiz results
                </button>
            </main>
        </div>
    );
}
