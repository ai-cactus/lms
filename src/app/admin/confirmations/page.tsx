"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    CheckCircle,
    XCircle,
    Clock,
    User,
    Award,
    Calendar,
    Filter,
    ArrowLeft,
} from "lucide-react";

interface PendingCompletion {
    id: string;
    worker: {
        id: string;
        full_name: string;
        email: string;
        role: string;
    };
    course: {
        title: string;
    };
    completed_at: string;
    quiz_score: number;
    quiz_attempts: number;
    acknowledgment_signature: string;
    assignment_id: string;
    worker_id: string;
    course_id: string;
}

export default function PendingConfirmationsPage() {
    const [completions, setCompletions] = useState<PendingCompletion[]>([]);
    const [filteredCompletions, setFilteredCompletions] = useState<PendingCompletion[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "at-risk">("all");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showBatchDialog, setShowBatchDialog] = useState(false);
    const [batchAction, setBatchAction] = useState<"approve" | "deny" | null>(null);
    const [batchReason, setBatchReason] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        const loadCompletions = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    router.push("/login");
                    return;
                }

                const { data: userData } = await supabase
                    .from("users")
                    .select("organization_id, role")
                    .eq("id", user.id)
                    .single();

                if (!userData || userData.role !== "admin") {
                    router.push("/");
                    return;
                }

                const { data, error } = await supabase
                    .from("course_completions")
                    .select(`
              id,
              completed_at,
              quiz_score,
              quiz_attempts,
              acknowledgment_signature,
              assignment_id,
              worker_id,
              course_id,
              worker:worker_id(id, full_name, email, role, organization_id),
              course:course_id(title)
            `)
                    .eq("status", "pending_confirmation")
                    .order("completed_at", { ascending: true });

                if (error) throw error;

                const filtered = (data || [])
                    .filter((c) => {
                        const worker = Array.isArray(c.worker) ? c.worker[0] : c.worker;
                        return worker?.organization_id === userData.organization_id;
                    })
                    .map((c) => ({
                        ...c,
                        worker: Array.isArray(c.worker) ? c.worker[0] : c.worker,
                        course: Array.isArray(c.course) ? c.course[0] : c.course,
                    }));

                setCompletions(filtered);
                setLoading(false);
            } catch (error) {
                console.error("Error loading completions:", error);
                setLoading(false);
            }
        };

        loadCompletions();
    }, []);

    useEffect(() => {
        const applyFilter = () => {
            if (filter === "at-risk") {
                setFilteredCompletions(
                    completions.filter((c) => getDaysWaiting(c.completed_at) > 7)
                );
            } else {
                setFilteredCompletions(completions);
            }
        };

        applyFilter();
    }, [filter, completions]);

    const getDaysWaiting = (completedAt: string) => {
        return Math.floor(
            (Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
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

    const toggleSelection = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const selectAll = () => {
        setSelectedIds(new Set(filteredCompletions.map((c) => c.id)));
    };

    const deselectAll = () => {
        setSelectedIds(new Set());
    };

    const handleBatchAction = (action: "approve" | "deny") => {
        if (selectedIds.size === 0) {
            alert("Please select at least one completion");
            return;
        }
        setBatchAction(action);
        setBatchReason("");
        setShowBatchDialog(true);
    };

    const submitBatchAction = async () => {
        if (!batchAction) return;
        if (batchAction === "deny" && !batchReason.trim()) {
            alert("Please provide a reason for denial");
            return;
        }

        setSubmitting(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const selectedCompletions = completions.filter((c) => selectedIds.has(c.id));

            for (const completion of selectedCompletions) {
                // Create confirmation
                await supabase.from("admin_confirmations").insert({
                    completion_id: completion.id,
                    admin_id: user.id,
                    confirmed: batchAction === "approve",
                    reason: batchAction === "deny" ? batchReason : null,
                });

                // Update completion status
                await supabase
                    .from("course_completions")
                    .update({ status: batchAction === "approve" ? "confirmed" : "denied" })
                    .eq("id", completion.id);

                // If denied, trigger retraining
                if (batchAction === "deny") {
                    await supabase
                        .from("course_assignments")
                        .update({ status: "not_started" })
                        .eq("id", completion.assignment_id);

                    await supabase.from("retraining_logs").insert({
                        worker_id: completion.worker_id,
                        course_id: completion.course_id,
                        reason: batchReason,
                        triggered_by: user.id,
                    });
                }
            }

            setShowBatchDialog(false);
            setSelectedIds(new Set());
            loadCompletions();
        } catch (error: any) {
            console.error("Error submitting batch action:", error);
            alert(error.message || "Failed to submit batch action");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading pending confirmations...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.push("/")}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </button>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Pending Confirmations</h1>
                    <p className="text-slate-600">Review and approve worker training completions</p>
                </div>

                {/* Filters and Actions */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 mb-6">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 text-slate-600" />
                                <select
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value as "all" | "at-risk")}
                                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                >
                                    <option value="all">All ({completions.length})</option>
                                    <option value="at-risk">
                                        At Risk ({completions.filter((c) => getDaysWaiting(c.completed_at) > 7).length})
                                    </option>
                                </select>
                            </div>

                            {selectedIds.size > 0 && (
                                <span className="text-sm text-slate-600">
                                    {selectedIds.size} selected
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            {filteredCompletions.length > 0 && (
                                <>
                                    <button
                                        onClick={selectedIds.size === filteredCompletions.length ? deselectAll : selectAll}
                                        className="px-3 py-2 text-sm border border-gray-300 text-slate-700 rounded-lg hover:bg-gray-50"
                                    >
                                        {selectedIds.size === filteredCompletions.length ? "Deselect All" : "Select All"}
                                    </button>
                                    <button
                                        onClick={() => handleBatchAction("approve")}
                                        disabled={selectedIds.size === 0}
                                        className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Approve Selected
                                    </button>
                                    <button
                                        onClick={() => handleBatchAction("deny")}
                                        disabled={selectedIds.size === 0}
                                        className="px-4 py-2 border border-red-600 text-red-600 rounded-lg font-medium hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Deny Selected
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Completions List */}
                {filteredCompletions.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
                        <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">
                            {filter === "at-risk" ? "No at-risk confirmations" : "All caught up!"}
                        </h3>
                        <p className="text-slate-600">
                            {filter === "at-risk"
                                ? "There are no confirmations waiting more than 7 days"
                                : "All training completions have been reviewed"}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredCompletions.map((completion) => {
                            const daysWaiting = getDaysWaiting(completion.completed_at);
                            const isAtRisk = daysWaiting > 7;
                            const isSelected = selectedIds.has(completion.id);

                            return (
                                <div
                                    key={completion.id}
                                    className={`bg-white rounded-xl shadow-lg border-2 p-6 transition-all ${isSelected
                                            ? "border-indigo-600"
                                            : isAtRisk
                                                ? "border-red-300"
                                                : "border-gray-200"
                                        }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelection(completion.id)}
                                            className="mt-1 w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
                                        />

                                        <div className="flex-1">
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <User className="w-4 h-4 text-slate-600" />
                                                        <span className="font-semibold text-slate-900">
                                                            {completion.worker.full_name}
                                                        </span>
                                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                                                            {completion.worker.role}
                                                        </span>
                                                        {isAtRisk && (
                                                            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                                At Risk - {daysWaiting} days
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-slate-500">{completion.worker.email}</p>
                                                </div>
                                            </div>

                                            <h4 className="font-medium text-slate-900 mb-3">{completion.course.title}</h4>

                                            <div className="flex items-center gap-6 text-sm text-slate-600 mb-4">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="w-4 h-4" />
                                                    {formatDate(completion.completed_at)}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Award className="w-4 h-4" />
                                                    Score: {completion.quiz_score}%
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Clock className="w-4 h-4" />
                                                    Attempts: {completion.quiz_attempts}
                                                </div>
                                            </div>

                                            <div className="bg-white rounded-lg p-3 mb-4">
                                                <p className="text-xs text-slate-600 mb-1">Digital Signature:</p>
                                                <p className="text-sm font-serif text-slate-900">
                                                    {completion.acknowledgment_signature}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Batch Action Dialog */}
            {showBatchDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">
                            {batchAction === "approve" ? "Approve" : "Deny"} {selectedIds.size} Training
                            {selectedIds.size > 1 ? "s" : ""}
                        </h3>

                        {batchAction === "deny" && (
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Reason for Denial <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={batchReason}
                                    onChange={(e) => setBatchReason(e.target.value)}
                                    placeholder="Explain why these trainings are being denied..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    rows={4}
                                    required
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    All selected workers will be required to retake their training
                                </p>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowBatchDialog(false)}
                                disabled={submitting}
                                className="flex-1 px-4 py-2 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitBatchAction}
                                disabled={submitting || (batchAction === "deny" && !batchReason.trim())}
                                className={`flex-1 px-4 py-2 rounded-lg font-medium text-white disabled:opacity-50 ${batchAction === "approve"
                                        ? "bg-green-600 hover:bg-green-700"
                                        : "bg-red-600 hover:bg-red-700"
                                    }`}
                            >
                                {submitting
                                    ? "Processing..."
                                    : batchAction === "approve"
                                        ? `Approve ${selectedIds.size}`
                                        : `Deny ${selectedIds.size}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
