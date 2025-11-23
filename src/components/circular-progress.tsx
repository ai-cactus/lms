"use client";

interface CircularProgressProps {
    percentage: number;
    size?: number;
    strokeWidth?: number;
    color?: string;
    trackColor?: string;
    showText?: boolean;
}

export function CircularProgress({
    percentage,
    size = 60,
    strokeWidth = 6,
    color = "text-indigo-600",
    trackColor = "text-slate-100",
    showText = true,
}: CircularProgressProps) {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (percentage / 100) * circumference;

    return (
        <div className="relative inline-flex items-center justify-center">
            <svg width={size} height={size} className="transform -rotate-90">
                {/* Track */}
                <circle
                    className={trackColor}
                    strokeWidth={strokeWidth}
                    stroke="currentColor"
                    fill="transparent"
                    r={radius}
                    cx={size / 2}
                    cy={size / 2}
                />
                {/* Progress */}
                <circle
                    className={`${color} transition-all duration-1000 ease-out`}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r={radius}
                    cx={size / 2}
                    cy={size / 2}
                />
            </svg>
            {showText && (
                <span className="absolute text-xs font-bold text-slate-700">
                    {percentage}%
                </span>
            )}
        </div>
    );
}
