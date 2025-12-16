"use client";

import { useState, useEffect } from "react";
import { getWorkerLearningNeeds, LearningNeed } from "@/app/actions/analytics";
import { AlertTriangle, CheckCircle, BookOpen, Activity, Loader2 } from "lucide-react";

interface LearningNeedsTabProps {
    workerId: string;
}

export default function LearningNeedsTab({ workerId }: LearningNeedsTabProps) {
    const [needs, setNeeds] = useState<LearningNeed[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        loadNeeds();
    }, [workerId]);

    const loadNeeds = async () => {
        try {
            const result = await getWorkerLearningNeeds(workerId);
            if (result.success) {
                setNeeds(result.needs || []);
            } else {
                setError(result.error || "Failed to load learning needs");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {error}
            </div>
        );
    }

    if (needs.length === 0) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-slate-900">No Learning Needs Identified</h3>
                <p className="text-slate-500 max-w-md mx-auto mt-1">
                    This worker is performing well across all assessed objectives. No specific areas for improvement found.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Identified Learning Needs</h2>
                <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium">
                    {needs.length} Area{needs.length !== 1 ? 's' : ''} for Improvement
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {needs.map((need, index) => (
                    <div key={index} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${need.status === 'at_risk'
                                            ? 'bg-red-100 text-red-800'
                                            : 'bg-amber-100 text-amber-800'
                                        }`}>
                                        {need.status === 'at_risk' ? 'At Risk' : 'Needs Support'}
                                    </span>
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                        <BookOpen className="w-3 h-3" />
                                        {need.courseTitle}
                                    </span>
                                </div>
                                <h3 className="font-medium text-slate-900 leading-snug">
                                    {need.objectiveText}
                                </h3>
                            </div>
                        </div>

                        <div className="mb-4">
                            <div className="flex items-center justify-between text-sm mb-1">
                                <span className="text-slate-600">Proficiency</span>
                                <span className={`font-medium ${need.correctPercentage < 50 ? 'text-red-600' : 'text-amber-600'
                                    }`}>
                                    {need.correctPercentage}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                                <div
                                    className={`h-2 rounded-full ${need.correctPercentage < 50 ? 'bg-red-500' : 'bg-amber-500'
                                        }`}
                                    style={{ width: `${need.correctPercentage}%` }}
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                                Based on {need.totalQuestions} questions across attempts
                            </p>
                        </div>

                        <div className="pt-4 border-t border-gray-100">
                            <div className="flex items-start gap-2 text-sm text-slate-700">
                                <Activity className="w-4 h-4 text-indigo-600 mt-0.5" />
                                <div>
                                    <span className="font-medium block text-xs text-slate-500 uppercase tracking-wider mb-0.5">
                                        Suggested Action
                                    </span>
                                    {need.suggestedAction}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
