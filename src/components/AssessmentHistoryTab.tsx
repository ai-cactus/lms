"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Calendar, CheckCircle, XCircle, Eye, Loader2 } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface AssessmentHistoryProps {
    workerId: string
}

interface Attempt {
    id: string
    score: number
    passed: boolean
    attempt_number: number
    completed_at: string
    course: {
        id: string
        title: string
        version: string
    }
}

export default function AssessmentHistoryTab({ workerId }: AssessmentHistoryProps) {
    const [attempts, setAttempts] = useState<Attempt[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null)
    const [attemptDetails, setAttemptDetails] = useState<any>(null)
    const [loadingDetails, setLoadingDetails] = useState(false)
    const supabase = createClient()

    useEffect(() => {
        loadAttempts()
    }, [workerId])

    const loadAttempts = async () => {
        try {
            const { getWorkerAttempts } = await import("@/app/actions/quiz")
            const result = await getWorkerAttempts(workerId)

            if (result.success && result.attempts) {
                setAttempts(result.attempts)
            }
        } catch (error) {
            console.error("Error loading attempts:", error)
        } finally {
            setLoading(false)
        }
    }

    const handleViewDetails = async (attemptId: string) => {
        setSelectedAttempt(attemptId)
        setLoadingDetails(true)

        try {
            const { getAttemptDetails } = await import("@/app/actions/quiz")
            const result = await getAttemptDetails(attemptId)

            if (result.success) {
                setAttemptDetails(result)
            }
        } catch (error) {
            console.error("Error loading attempt details:", error)
        } finally {
            setLoadingDetails(false)
        }
    }

    const closeModal = () => {
        setSelectedAttempt(null)
        setAttemptDetails(null)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
        )
    }

    if (attempts.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-slate-600">No quiz attempts found for this worker.</p>
            </div>
        )
    }

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Course</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Version</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Attempt</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Score</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Result</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Date</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {attempts.map((attempt) => (
                            <tr key={attempt.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 text-sm text-slate-900">
                                    {attempt.course?.title || "Unknown Course"}
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">
                                    {attempt.course?.version || "1.0"}
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">
                                    #{attempt.attempt_number}
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-slate-900">
                                    {attempt.score}%
                                </td>
                                <td className="px-4 py-3">
                                    {attempt.passed ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                            <CheckCircle className="w-3 h-3" />
                                            Pass
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">
                                            <XCircle className="w-3 h-3" />
                                            Fail
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">
                                    <div className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {formatDistanceToNow(new Date(attempt.completed_at), { addSuffix: true })}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <button
                                        onClick={() => handleViewDetails(attempt.id)}
                                        className="inline-flex items-center gap-1 px-3 py-1 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    >
                                        <Eye className="w-4 h-4" />
                                        View Details
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Attempt Details Modal */}
            {selectedAttempt && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-slate-900">
                                {loadingDetails ? "Loading..." : "Attempt Details"}
                            </h3>
                            <button
                                onClick={closeModal}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <XCircle className="w-5 h-5 text-slate-600" />
                            </button>
                        </div>

                        {loadingDetails ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                            </div>
                        ) : attemptDetails ? (
                            <div className="p-6">
                                {/* Summary */}
                                <div className="bg-slate-50 rounded-lg p-4 mb-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-slate-600 mb-1">Course</p>
                                            <p className="font-medium text-slate-900">
                                                {attemptDetails.attempt?.course?.title}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-600 mb-1">Score</p>
                                            <p className="text-2xl font-bold text-slate-900">
                                                {attemptDetails.attempt?.score}%
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-600 mb-1">Result</p>
                                            {attemptDetails.attempt?.passed ? (
                                                <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                                                    <CheckCircle className="w-4 h-4" />
                                                    Passed
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                                                    <XCircle className="w-4 h-4" />
                                                    Failed
                                                </span>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-600 mb-1">Attempt Number</p>
                                            <p className="font-medium text-slate-900">
                                                #{attemptDetails.attempt?.attempt_number}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Answers */}
                                <h4 className="font-semibold text-slate-900 mb-4">Questions & Answers</h4>
                                <div className="space-y-4">
                                    {attemptDetails.answers?.map((answer: any, index: number) => (
                                        <div
                                            key={answer.id}
                                            className={`border-l-4 p-4 rounded-lg ${answer.is_correct
                                                    ? "border-green-500 bg-green-50"
                                                    : "border-red-500 bg-red-50"
                                                }`}
                                        >
                                            <div className="flex items-start gap-2 mb-2">
                                                {answer.is_correct ? (
                                                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                                ) : (
                                                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                                )}
                                                <div className="flex-1">
                                                    <p className="font-medium text-slate-900 mb-2">
                                                        {index + 1}. {answer.question?.question_text}
                                                    </p>
                                                    <p className="text-sm text-slate-700">
                                                        <span className="font-medium">Selected:</span>{" "}
                                                        {answer.selected_option_text}
                                                    </p>
                                                    {!answer.is_correct && (
                                                        <p className="text-sm text-green-700 mt-1">
                                                            <span className="font-medium">Correct Answer:</span>{" "}
                                                            {answer.question?.correct_answer}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="p-6 text-center text-slate-600">
                                Failed to load attempt details
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
