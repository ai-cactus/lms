"use client";

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

interface ScoreDistributionChartProps {
    data: {
        courseTitle: string;
        avgScore: number;
        passRate: number;
    }[];
}

export default function ScoreDistributionChart({ data }: ScoreDistributionChartProps) {
    const chartData = {
        labels: data.map(d => d.courseTitle.length > 20 ? d.courseTitle.substring(0, 20) + '...' : d.courseTitle),
        datasets: [
            {
                label: 'Average Score (%)',
                data: data.map(d => d.avgScore),
                backgroundColor: 'rgba(79, 70, 229, 0.6)', // Indigo-600
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
            },
            {
                label: 'Pass Rate (%)',
                data: data.map(d => d.passRate),
                backgroundColor: 'rgba(16, 185, 129, 0.6)', // Emerald-500
                borderColor: 'rgba(16, 185, 129, 1)',
                borderWidth: 1,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
            },
            title: {
                display: false,
                text: 'Course Performance',
            },
        },
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
            },
        },
    };

    return (
        <div className="h-[300px] w-full">
            <Bar options={options} data={chartData} />
        </div>
    );
}
