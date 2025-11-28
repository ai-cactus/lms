"use client";

import { BookOpen, Users, Target } from "lucide-react";

interface TrainingStats {
    totalCourses: number;
    totalStaffAssigned: number;
    averageGrade: number;
}

interface StatsCardsProps {
    stats: TrainingStats;
}

export function StatsCards({ stats }: StatsCardsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Total Courses */}
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-6 border border-emerald-200">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-emerald-500 rounded-lg flex items-center justify-center">
                        <BookOpen className="w-6 h-6 text-white" />
                    </div>
                </div>
                <p className="text-sm font-medium text-emerald-700 mb-1">Total Courses</p>
                <p className="text-4xl font-bold text-emerald-900">{stats.totalCourses}</p>
            </div>

            {/* Average Grade */}
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 bg-red-500 rounded-lg flex items-center justify-center">
                        <Target className="w-6 h-6 text-white" />
                    </div>
                </div>
                <p className="text-sm font-medium text-red-700 mb-1">Average Grade</p>
                <p className="text-4xl font-bold text-red-900">{stats.averageGrade}%</p>
            </div>
        </div>
    );
}
