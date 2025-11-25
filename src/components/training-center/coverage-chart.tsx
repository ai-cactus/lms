"use client";

import { Doughnut } from "react-chartjs-2";
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend,
} from "chart.js";

// Register ChartJS components
ChartJS.register(ArcElement, Tooltip, Legend);

interface CoverageData {
    completed: number;
    enrolled: number;
    notStarted: number;
}

interface CoverageChartProps {
    data?: CoverageData;
}

export function CoverageChart({ data }: { data: CoverageData }) {
    const coverageData = data;

    const chartData = {
        labels: [
            "% of staff who have completed courses",
            "% of staff currently enrolled in programs",
            "% of staff yet to begin any course",
        ],
        datasets: [
            {
                data: [coverageData.completed, coverageData.enrolled, coverageData.notStarted],
                backgroundColor: ["#a78bfa", "#3b82f6", "#ef4444"],
                borderWidth: 0,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
        },
        cutout: "70%",
    };

    return (
        <div className="bg-white rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-bold text-slate-900 mb-6">Training Coverage</h3>
            <div className="flex items-center gap-8">
                {/* Chart */}
                <div className="w-48 h-48 flex-shrink-0">
                    <Doughnut data={chartData} options={options} />
                </div>

                {/* Legend */}
                <div className="flex-1 space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-purple-400 mt-0.5 flex-shrink-0"></div>
                        <div className="flex-1">
                            <p className="text-sm text-slate-600">% of staff who have completed courses</p>
                            <p className="text-2xl font-bold text-slate-900">{coverageData.completed}%</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-blue-500 mt-0.5 flex-shrink-0"></div>
                        <div className="flex-1">
                            <p className="text-sm text-slate-600">% of staff currently enrolled in programs</p>
                            <p className="text-2xl font-bold text-slate-900">{coverageData.enrolled}%</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-red-500 mt-0.5 flex-shrink-0"></div>
                        <div className="flex-1">
                            <p className="text-sm text-slate-600">% of staff yet to begin any course</p>
                            <p className="text-2xl font-bold text-slate-900">{coverageData.notStarted}%</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
