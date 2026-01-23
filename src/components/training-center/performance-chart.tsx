"use client";

import { useState } from "react";
import { Bar } from "react-chartjs-2";
import { ChevronDown } from "lucide-react";
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
    const [timeFilter, setTimeFilter] = useState("Monthly");
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const timeFilters = ["Daily", "Weekly", "Monthly", "Yearly"];

    const getLabelsAndData = () => {
        switch (timeFilter) {
            case "Daily":
                return {
                    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                    data: data.slice(0, 7)
                };
            case "Weekly":
                return {
                    labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
                    data: data.slice(0, 4)
                };
            case "Yearly":
                return {
                    labels: ["2021", "2022", "2023", "2024"],
                    data: data.slice(0, 4)
                };
            default: // Monthly
                return {
                    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                    data: data
                };
        }
    };

    const { labels, data: chartDataPoints } = getLabelsAndData();

    const chartData = {
        labels,
        datasets: [
            {
                label: "Score (%)",
                data: chartDataPoints,
                backgroundColor: "#10b981",
                borderRadius: 6,
                barThickness: 24,
            },
        ],
    };

    // Calculate dynamic Y-axis max based on data
    const maxValue = Math.max(...chartDataPoints, 0);
    const dynamicMax = maxValue === 0 ? 100 : Math.ceil(maxValue / 10) * 10 + 10; // Round up to nearest 10 + buffer
    const dynamicStepSize = Math.max(Math.ceil(dynamicMax / 5), 1); // 5 steps on Y-axis

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
                max: dynamicMax,
                ticks: {
                    stepSize: dynamicStepSize,
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
                <div className="relative">
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center gap-2 px-3 py-1 text-sm text-slate-500 hover:text-slate-700 hover:bg-white rounded-md transition-colors"
                    >
                        {timeFilter}
                        <ChevronDown className="w-4 h-4" />
                    </button>

                    {isDropdownOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                            {timeFilters.map((filter) => (
                                <button
                                    key={filter}
                                    onClick={() => {
                                        setTimeFilter(filter);
                                        setIsDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white first:rounded-t-lg last:rounded-b-lg ${timeFilter === filter ? 'text-blue-600 bg-blue-50' : 'text-slate-700'
                                        }`}
                                >
                                    {filter}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="h-64">
                <Bar data={chartData} options={options} />
            </div>
        </div>
    );
}
