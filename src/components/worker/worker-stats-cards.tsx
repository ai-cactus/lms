"use client";

import { BookOpen, CheckCircle, Target } from "lucide-react";

interface WorkerStats {
    totalCourses: number;
    coursesCompleted: number;
    averageGrade: number;
}

interface WorkerStatsCardsProps {
    stats: WorkerStats;
}

export function WorkerStatsCards({ stats }: WorkerStatsCardsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Total Courses */}
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                        <BookOpen className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-sm font-medium text-emerald-700">Total Courses</p>
                </div>
                <p className="text-3xl font-bold text-emerald-900">{stats.totalCourses}</p>
            </div>

            {/* Courses Completed */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-sm font-medium text-blue-700">Courses Completed</p>
                </div>
                <p className="text-3xl font-bold text-blue-900">{stats.coursesCompleted}</p>
            </div>

            {/* Average Grade */}
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 border border-red-200 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center">
                        <Target className="w-4 h-4 text-white" />
                    </div>
                    <p className="text-sm font-medium text-red-700">Average Grade</p>
                </div>
                <p className="text-3xl font-bold text-red-900">{stats.averageGrade}%</p>
            </div>
        </div>
    );
}
