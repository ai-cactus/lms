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

interface TrainingCoverageData {
    completed: number;
    inProgress: number;
    notStarted: number;
}

interface TrainingCoverageChartProps {
    data: TrainingCoverageData;
}

export function TrainingCoverageChart({ data }: TrainingCoverageChartProps) {
    const chartData = {
        labels: [
            "% of staff who have completed required courses",
            "% of staff currently enrolled (in progress)",
            "% of staff yet to begin any course"
        ],
        datasets: [
            {
                data: [data.completed, data.inProgress, data.notStarted],
                backgroundColor: [
                    "#a5b4fc", // Light purple for completed
                    "#3b82f6", // Blue for in progress  
                    "#ef4444", // Red for not started
                ],
                borderWidth: 0,
                cutout: "60%",
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
            tooltip: {
                callbacks: {
                    label: function(context: any) {
                        return `${context.label}: ${context.parsed}%`;
                    }
                }
            }
        },
    };

    return (
        <div className="bg-white rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-bold text-slate-900 mb-6">Training Coverage</h3>
            
            {/* Chart on its own row */}
            <div className="flex justify-center mb-6">
                <div className="w-48 h-48">
                    <Doughnut data={chartData} options={options} />
                </div>
            </div>
            
            {/* Legend on its own row */}
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-purple-300"></div>
                    <div className="flex-1">
                        <p className="text-sm text-slate-600">% of staff who have completed required courses</p>
                        <p className="text-lg font-semibold text-slate-900">{data.completed}%</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <div className="flex-1">
                        <p className="text-sm text-slate-600">% of staff currently enrolled (in progress)</p>
                        <p className="text-lg font-semibold text-slate-900">{data.inProgress}%</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="flex-1">
                        <p className="text-sm text-slate-600">% of staff yet to begin any course</p>
                        <p className="text-lg font-semibold text-slate-900">{data.notStarted}%</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
