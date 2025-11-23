"use client";

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
} from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ArcElement
);

export function PerformanceChart({ data = [] }: { data?: number[] }) {
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
                    color: '#f1f5f9',
                },
                border: {
                    display: false
                }
            },
            x: {
                grid: {
                    display: false,
                },
                border: {
                    display: false
                }
            },
        },
    };

    // Use provided data or fall back to zeros
    const chartData = data.length === 12 ? data : [65, 35, 80, 55, 65, 58, 55, 95, 75, 45, 65, 45];

    const chartConfig = {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        datasets: [
            {
                label: 'Scores (%)',
                data: chartData,
                backgroundColor: '#22c55e', // Green-500
                borderRadius: 4,
                barThickness: 8,
            },
        ],
    };

    return <Bar options={options} data={chartConfig} />;
}

export function CoverageChart({ data }: {
    data?: { completed: number; inProgress: number; notStarted: number }
}) {
    // Use provided data or fall back to defaults
    const completed = data?.completed ?? 30;
    const inProgress = data?.inProgress ?? 34;
    const notStarted = data?.notStarted ?? 36;

    const chartData = {
        labels: ['Completed', 'In Progress', 'Not Started'],
        datasets: [
            {
                data: [completed, inProgress, notStarted],
                backgroundColor: [
                    '#ef4444', // Red-500
                    '#818cf8', // Indigo-400
                    '#c7d2fe', // Indigo-200
                ],
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
        cutout: '0%', // Pie chart, not doughnut
    };

    return <Pie data={chartData} options={options} />;
}
