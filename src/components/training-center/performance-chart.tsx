"use client";

import { Bar } from "react-chartjs-2";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from "chart.js";

// Register ChartJS components
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

interface PerformanceChartProps {
    data?: number[];
}

export function PerformanceChart({ data }: { data: number[] }) {
    const performanceData = data;

    const chartData = {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        datasets: [
            {
                label: "Score (%)",
                data: performanceData,
                backgroundColor: "#10b981",
                borderRadius: 6,
                barThickness: 24,
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
            title: {
                display: false,
            },
        },
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                    stepSize: 20,
                },
                grid: {
                    display: true,
                    color: "#f1f5f9",
                },
            },
            x: {
                grid: {
                    display: false,
                },
            },
        },
    };

    return (
        <div className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-900">Performance of Learners</h3>
                <span className="text-sm text-slate-500">Monthly</span>
            </div>
            <div className="h-64">
                <Bar data={chartData} options={options} />
            </div>
        </div>
    );
}
