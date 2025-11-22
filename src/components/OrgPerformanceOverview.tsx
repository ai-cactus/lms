"use client";

import { useState, useEffect } from "react";
import { getOrgPerformanceOverview } from "@/app/actions/analytics";
import { BarChart3, AlertTriangle, Loader2, BookOpen, TrendingUp } from "lucide-react";

interface OrgPerformanceOverviewProps {
    organizationId: string;
}

interface StrugglingObjective {
    objectiveText: string;
    courseTitle: string;
    incorrectPercentage: number;
    totalAttempts: number;
}

export default function OrgPerformanceOverview({ organizationId }: OrgPerformanceOverviewProps) {
    const [objectives, setObjectives] = useState<StrugglingObjective[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        loadData();
    }, [organizationId]);

    const loadData = async () => {
        try {
            const result = await getOrgPerformanceOverview(organizationId);
            if (result.success) {
                setObjectives(result.topStrugglingObjectives || []);
            } else {
                setError(result.error || "Failed to load performance data");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full flex items-center justify-center min-h-[300px]">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full min-h-[300px]">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-5 h-5 text-slate-500" />
                    <h2 className="text-lg font-semibold text-slate-900">Performance Overview</h2>
                </div>
                <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    {error}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-slate-900">Top Areas for Improvement</h2>
                </div>
                <a
                    href="/admin/analytics/performance"
                    className="text-xs font-medium px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                >
                    View Full Report
                </a>
            </div>

            {objectives.length === 0 ? (
                <div className="text-center py-12">
                    <div className="bg-green-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                        <BarChart3 className="w-6 h-6 text-green-600" />
                    </div>
                    <h3 className="text-sm font-medium text-slate-900">No Data Available</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-[200px] mx-auto">
                        Not enough quiz attempts to analyze performance trends yet.
                    </p>
                </div>
            ) : (
                <div className="space-y-6">
                    {objectives.map((obj, index) => (
                        <div key={index}>
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex-1 pr-4">
                                    <h4 className="text-sm font-medium text-slate-900 line-clamp-2" title={obj.objectiveText}>
                                        {obj.objectiveText}
                                    </h4>
                                    <div className="flex items-center gap-1 mt-1">
                                        <BookOpen className="w-3 h-3 text-slate-400" />
                                        <span className="text-xs text-slate-500 truncate max-w-[200px]" title={obj.courseTitle}>
                                            {obj.courseTitle}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-lg font-bold text-red-600">
                                        {obj.incorrectPercentage}%
                                    </span>
                                    <span className="block text-[10px] text-slate-400 uppercase tracking-wide">
                                        Incorrect
                                    </span>
                                </div>
                            </div>

                            <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className="absolute top-0 left-0 h-full bg-red-500 rounded-full"
                                    style={{ width: `${obj.incorrectPercentage}%` }}
                                />
                            </div>

                            <div className="mt-1 text-right">
                                <span className="text-xs text-slate-400">
                                    Based on {obj.totalAttempts} attempts
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
