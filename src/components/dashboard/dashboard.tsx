"use client";

import { PlusCircle } from "@phosphor-icons/react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { StatsCards } from "./stats-cards";
import { PerformanceChart } from "./performance-chart";
import { CoverageChart } from "./coverage-chart";

interface DashboardProps {
    onCreateCourse: () => void;
}

export function Dashboard({ onCreateCourse }: DashboardProps) {
    return (
        <div className="flex h-full w-full bg-slate-50">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            <main className="flex-1 ml-64 h-full overflow-y-auto">
                <Header />

                <div className="p-8 max-w-7xl mx-auto">
                    {/* Welcome & Action */}
                    <div className="flex justify-between items-end mb-8">
                        <div>
                            <p className="text-sm text-slate-500 mb-1">Admin / Training</p>
                            <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
                            <p className="text-slate-500 mt-1">Here is an overview of your courses.</p>
                        </div>
                        <button
                            onClick={onCreateCourse}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                        >
                            <PlusCircle className="text-lg" />
                            Create Course
                        </button>
                    </div>

                    {/* Stats Cards */}
                    <StatsCards />

                    {/* Charts Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-8">
                        <PerformanceChart />
                        <CoverageChart />
                    </div>
                </div>
            </main>
        </div>
    );
}
