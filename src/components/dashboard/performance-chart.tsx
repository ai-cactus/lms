"use client";

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { DotsThree } from "@phosphor-icons/react";

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: false,
        },
    },
    scales: {
        y: {
            beginAtZero: true,
            grid: {
                display: false,
            },
        },
        x: {
            grid: {
                display: false,
            },
        },
    },
};

const data = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
    datasets: [
        {
            label: "Completion Rate",
            data: [65, 59, 80, 81, 56, 55, 40, 75],
            backgroundColor: "#34D399",
            borderRadius: 4,
        },
    ],
};

export function PerformanceChart() {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 lg:col-span-2">
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-slate-800">Performance of Learners</h3>
                <button className="text-slate-400 hover:text-slate-600">
                    <DotsThree className="text-xl" />
                </button>
            </div>
            <div className="h-64 w-full">
                <Bar options={options} data={data} />
            </div>
        </div>
    );
}
