"use client";

import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend,
} from "chart.js";
import { Pie } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            position: "bottom" as const,
        },
    },
};

const data = {
    labels: ["Completed", "In Progress", "Not Started"],
    datasets: [
        {
            data: [300, 50, 100],
            backgroundColor: ["#EF4444", "#3B82F6", "#E5E7EB"],
            hoverOffset: 4,
        },
    ],
};

export function CoverageChart() {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-slate-800">Training Coverage</h3>
            </div>
            <div className="h-64 w-full">
                <Pie options={options} data={data} />
            </div>
        </div>
    );
}
