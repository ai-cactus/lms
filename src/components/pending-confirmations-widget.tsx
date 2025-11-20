"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, XCircle, Clock, User, Award, Calendar } from "lucide-react";

interface PendingCompletion {
    id: string;
    worker: {
        full_name: string;
        email: string;
    };
    course: {
        title: string;
    };
    completed_at: string;
    quiz_score: number;
    quiz_attempts: number;
    acknowledgment_signature: string;
}

interface PendingConfirmationsWidgetProps {
    onConfirmationUpdate?: () => void;
}

export default function PendingConfirmationsWidget({
    onConfirmationUpdate,
}: PendingConfirmationsWidgetProps) {
    const [pendingCompletions, setPendingCompletions] = useState<PendingCompletion[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCompletion, setSelectedCompletion] = useState<PendingCompletion | null>(null);
    const [showDialog, setShowDialog] = useState(false);
    const [confirmAction, setConfirmAction] = useState<"approve" | "deny" | null>(null);
    const [reason, setReason] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        loadPendingCompletions();
    }, []);

    const loadPendingCompletions = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) return;

            // Get pending completions for workers in the same organization
            const { data, error } = await supabase
                .from("course_completions")
                .select(`
          id,
          completed_at,
          quiz_score,
          quiz_attempts,
          acknowledgment_signature,
          worker:worker_id(full_name, email, organization_id),
          course:course_id(title)
        `)
                .eq("status", "pending_confirmation")
                .order("completed_at", { ascending: true });

            if (error) throw error;

            // Filter by organization and normalize data
            const filtered = (data || [])
                .filter((c: any) => {
                    const worker = Array.isArray(c.worker) ? c.worker[0] : c.worker;
                    return worker?.organization_id === userData.organization_id;
                })
                .map((c: any) => ({
                    ...c,
                    worker: Array.isArray(c.worker) ? c.worker[0] : c.worker,
                    course: Array.isArray(c.course) ? c.course[0] : c.course,
                }));

            setPendingCompletions(filtered);
            setLoading(false);
        } catch (error) {
            console.error("Error loading pending completions:", error);
            setLoading(false);
        }
    };

    const handleConfirmClick = (completion: PendingCompletion, action: "approve" | "deny") => {
        setSelectedCompletion(completion);
        setConfirmAction(action);
        setShowDialog(true);
        setReason("");
        setNotes("");
    };

    const handleSubmitConfirmation = async () => {
        if (!selectedCompletion || !confirmAction) return;

        if (confirmAction === "deny" && !reason.trim()) {
            alert("Please provide a reason for denial");
            return;
        }

        setSubmitting(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            // Create admin confirmation
            const { error: confirmError } = await supabase
                .from("admin_confirmations")
                .insert({
                    completion_id: selectedCompletion.id,
                    admin_id: user.id,
                    confirmed: confirmAction === "approve",
                    reason: confirmAction === "deny" ? reason : null,
                    notes: notes.trim() || null,
                });

            if (confirmError) throw confirmError;

            // Update completion status
            const { error: updateError } = await supabase
                .from("course_completions")
                .update({
                    status: confirmAction === "approve" ? "confirmed" : "denied",
                })
                .eq("id", selectedCompletion.id);

            if (updateError) throw updateError;

            // If denied, trigger retraining
            if (confirmAction === "deny") {
                // Get assignment_id from completion
                const { data: completionData } = await supabase
                    .from("course_completions")
                    .select("assignment_id, worker_id, course_id")
                    .eq("id", selectedCompletion.id)
                    .single();

                if (completionData) {
                    // Reset assignment status
                    await supabase
                        .from("course_assignments")
                        .update({ status: "not_started" })
                        .eq("id", completionData.assignment_id);

                    // Log retraining
                    await supabase
                        .from("retraining_logs")
                        .insert({
                            worker_id: completionData.worker_id,
                            course_id: completionData.course_id,
                            reason: reason,
                            triggered_by: user.id,
                        });
                }
            }

            // Success!
            setShowDialog(false);
            setSelectedCompletion(null);
            setConfirmAction(null);
            loadPendingCompletions();
            onConfirmationUpdate?.();
        } catch (error: any) {
            console.error("Error submitting confirmation:", error);
            alert(error.message || "Failed to submit confirmation");
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getDaysWaiting = (completedAt: string) => {
        const days = Math.floor(
            (Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        return days;
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Pending Confirmations</h3>
                <p className="text-slate-600">Loading...</p>
            </div>
        );
    }

    return (
        <>
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900">Pending Confirmations</h3>
                    <span className="px-3 py-1 bg-yellow-100 text-yellow-700 text-sm font-medium rounded-full">
                        {pendingCompletions.length} pending
                    </span>
                </div>

                {pendingCompletions.length === 0 ? (
                    <div className="text-center py-8">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-600" />
                        <p className="text-slate-600">All training completions have been reviewed!</p>
                    </div>
                ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                        {pendingCompletions.map((completion) => {
                            const daysWaiting = getDaysWaiting(completion.completed_at);
                            const isAtRisk = daysWaiting > 7;

                            return (
                                <div
                                    key={completion.id}
                                    className={`border rounded-lg p-4 ${isAtRisk ? "border-red-300 bg-red-50" : "border-gray-200"
                                        }`}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <User className="w-4 h-4 text-slate-600" />
                                                <span className="font-medium text-slate-900">
                                                    {completion.worker.full_name}
                                                </span>
                                                {isAtRisk && (
                                                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                        At Risk
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-700 mb-2">{completion.course.title}</p>
                                            <div className="flex items-center gap-4 text-xs text-slate-500">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {formatDate(completion.completed_at)}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Award className="w-3 h-3" />
                                                    Score: {completion.quiz_score}%
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {daysWaiting} {daysWaiting === 1 ? "day" : "days"} waiting
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleConfirmClick(completion, "approve")}
                                            className="flex-1 px-3 py-2 bg-green-600 text-white text-sm rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-1"
                                        >
                                            <CheckCircle className="w-4 h-4" />
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => handleConfirmClick(completion, "deny")}
                                            className="flex-1 px-3 py-2 border border-red-600 text-red-600 text-sm rounded-lg font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-1"
                                        >
                                            <XCircle className="w-4 h-4" />
                                            Deny
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Confirmation Dialog */}
            {showDialog && selectedCompletion && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">
                            {confirmAction === "approve" ? "Approve Training" : "Deny Training"}
                        </h3>

                        <div className="mb-4 p-4 bg-slate-50 rounded-lg">
                            <p className="text-sm text-slate-600 mb-1">Worker</p>
                            <p className="font-medium text-slate-900">{selectedCompletion.worker.full_name}</p>
                            <p className="text-sm text-slate-600 mt-2 mb-1">Course</p>
                            <p className="font-medium text-slate-900">{selectedCompletion.course.title}</p>
                            <p className="text-sm text-slate-600 mt-2 mb-1">Quiz Score</p>
                            <p className="font-medium text-slate-900">{selectedCompletion.quiz_score}%</p>
                        </div>

                        {confirmAction === "deny" && (
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Reason for Denial <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Explain why this training is being denied..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    rows={3}
                                    required
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Worker will be required to retake the training
                                </p>
                            </div>
                        )}

                        <div className="mb-6">
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Additional Notes (Optional)
                            </label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Add any additional notes..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                rows={2}
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDialog(false)}
                                disabled={submitting}
                                className="flex-1 px-4 py-2 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmitConfirmation}
                                disabled={submitting || (confirmAction === "deny" && !reason.trim())}
                                className={`flex-1 px-4 py-2 rounded-lg font-medium text-white disabled:opacity-50 transition-colors ${confirmAction === "approve"
                                        ? "bg-green-600 hover:bg-green-700"
                                        : "bg-red-600 hover:bg-red-700"
                                    }`}
                            >
                                {submitting ? "Submitting..." : confirmAction === "approve" ? "Approve" : "Deny & Retrain"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
