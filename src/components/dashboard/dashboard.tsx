"use client";

import { Plus, CheckCircle, X } from "@phosphor-icons/react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { StatsCards } from "./stats-cards";
import { PerformanceChart } from "./performance-chart";
import { CoverageChart } from "./coverage-chart";
import { useState } from "react";

interface DashboardProps {
    onCreateCourse: () => void;
}

export function Dashboard({ onCreateCourse }: DashboardProps) {
    const [showBanner, setShowBanner] = useState(true);

    return (
        <div className="flex h-full w-full bg-white">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            <main className="flex-1 ml-64 h-full overflow-y-auto">
                <Header />

                <div className="p-8 max-w-7xl mx-auto">
                    {/* Success Banner */}
                    {showBanner && (
                        <div className="mb-8 bg-green-50 border border-green-100 rounded-lg p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center text-white">
                                    <CheckCircle size={14} weight="bold" />
                                </div>
                                <p className="text-sm text-slate-800">
                                    Training resources for the course <span className="font-semibold">“10 Fundamental CARF Principle...”</span> is ready.
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                <button className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-md transition-colors">
                                    View
                                </button>
                                <button
                                    onClick={() => setShowBanner(false)}
                                    className="text-slate-400 hover:text-slate-600"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Welcome & Action */}
                    <div className="flex justify-between items-end mb-8">
                        <div>
                            <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
                                <span>Home</span>
                                <span>/</span>
                                <span className="text-slate-900 font-medium">Training</span>
                            </div>
                            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
                            <p className="text-slate-500 mt-2">Here is an overview of your courses</p>
                        </div>
                        <button
                            onClick={onCreateCourse}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                        >
                            <Plus className="text-lg" weight="bold" />
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
