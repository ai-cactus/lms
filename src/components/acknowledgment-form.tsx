"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, AlertCircle } from "lucide-react";

interface AcknowledgmentFormProps {
    assignmentId: string;
    courseId: string;
    courseTitle: string;
    workerName: string;
    quizScore: number;
    onComplete: () => void;
}

export default function AcknowledgmentForm({
    assignmentId,
    courseId,
    courseTitle,
    workerName,
    quizScore,
    onComplete,
}: AcknowledgmentFormProps) {
    const [acknowledged, setAcknowledged] = useState(false);
    const [signature, setSignature] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const supabase = createClient();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!acknowledged) {
            setError("Please check the acknowledgment box");
            return;
        }

        if (!signature.trim()) {
            setError("Please provide your digital signature");
            return;
        }

        if (signature.trim().toLowerCase() !== workerName.toLowerCase()) {
            setError("Signature must match your full name");
            return;
        }

        setSubmitting(true);
        setError("");

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            // Create course completion record
            const { data: completionData, error: completionError } = await supabase
                .from("course_completions")
                .insert({
                    worker_id: user.id,
                    course_id: courseId,
                    assignment_id: assignmentId,
                    quiz_score: quizScore,
                    quiz_attempts: 1, // TODO: Track actual attempts
                    completed_at: new Date().toISOString(),
                    status: "pending_confirmation",
                    acknowledgment_signature: signature.trim(),
                })
                .select()
                .single();

            if (completionError) throw completionError;

            // Update assignment status
            const { error: assignmentError } = await supabase
                .from("course_assignments")
                .update({ status: "pending_confirmation" })
                .eq("id", assignmentId);

            if (assignmentError) throw assignmentError;

            // Success!
            onComplete();
        } catch (err: any) {
            console.error("Error submitting acknowledgment:", err);
            setError(err.message || "Failed to submit acknowledgment");
            setSubmitting(false);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Training Acknowledgment</h2>
                <p className="text-slate-600">
                    Congratulations on passing the quiz with a score of <strong>{quizScore}%</strong>!
                    Please acknowledge that you have completed this training.
                </p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Course Info */}
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                    <h3 className="font-semibold text-slate-900 mb-2">Training Completed</h3>
                    <p className="text-sm text-slate-700">{courseTitle}</p>
                    <p className="text-xs text-slate-500 mt-1">
                        Completed on {new Date().toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                        })}
                    </p>
                </div>

                {/* Worker Name */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Your Name
                    </label>
                    <input
                        type="text"
                        readOnly
                        value={workerName}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-slate-700"
                    />
                </div>

                {/* Acknowledgment Checkbox */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={acknowledged}
                            onChange={(e) => setAcknowledged(e.target.checked)}
                            className="mt-1 w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
                            required
                        />
                        <span className="text-sm text-slate-700 leading-relaxed">
                            I acknowledge that I have completed this training and understand the material covered.
                            I will apply this knowledge in my work and comply with all relevant policies and procedures.
                        </span>
                    </label>
                </div>

                {/* Digital Signature */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Digital Signature <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={signature}
                        onChange={(e) => setSignature(e.target.value)}
                        placeholder="Type your full name exactly as shown above"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-serif text-lg"
                        required
                    />
                    <p className="text-xs text-slate-500 mt-1">
                        By typing your name, you are providing a legal digital signature
                    </p>
                </div>

                {/* Submit Button */}
                <div className="pt-4 border-t border-gray-200">
                    <button
                        type="submit"
                        disabled={submitting || !acknowledged || !signature.trim()}
                        className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                        {submitting ? (
                            "Submitting..."
                        ) : (
                            <>
                                <CheckCircle className="w-5 h-5" />
                                Submit Training for Supervisor Review
                            </>
                        )}
                    </button>
                    <p className="text-xs text-center text-slate-500 mt-2">
                        Your training will be marked as complete after supervisor confirmation
                    </p>
                </div>
            </form>
        </div>
    );
}
