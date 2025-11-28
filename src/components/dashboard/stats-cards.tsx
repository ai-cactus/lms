"use client";

import { BookOpen, Users, CheckCircle } from "@phosphor-icons/react";

export function StatsCards() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Card 1 */}
            <div className="bg-green-50 rounded-xl p-6 border border-green-100 shadow-sm">
                <div className="bg-green-500 text-white w-10 h-10 rounded-lg flex items-center justify-center mb-4 shadow-green-200 shadow-md">
                    <BookOpen className="text-xl" weight="fill" />
                </div>
                <div className="text-sm text-green-700 font-medium mb-1">Total Courses</div>
                <div className="text-3xl font-bold text-green-900">15</div>
            </div>

            {/* Card 3 */}
            <div className="bg-red-50 rounded-xl p-6 border border-red-100 shadow-sm">
                <div className="bg-red-600 text-white w-10 h-10 rounded-lg flex items-center justify-center mb-4 shadow-red-200 shadow-md">
                    <CheckCircle className="text-xl" weight="fill" />
                </div>
                <div className="text-sm text-red-700 font-medium mb-1">Average Grade</div>
                <div className="text-3xl font-bold text-red-900">40%</div>
            </div>
        </div>
    );
}
