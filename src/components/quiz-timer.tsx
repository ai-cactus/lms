"use client";

import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

interface QuizTimerProps {
    durationSeconds: number; // Total duration in seconds
    onTimeUp: () => void;
    isActive: boolean;
}

export function QuizTimer({ durationSeconds, onTimeUp, isActive }: QuizTimerProps) {
    const [timeLeft, setTimeLeft] = useState(durationSeconds);

    useEffect(() => {
        if (!isActive) return;

        if (timeLeft <= 0) {
            onTimeUp();
            return;
        }

        const timer = setInterval(() => {
            setTimeLeft((prev) => prev - 1);
        }, 1000);

        return () => clearInterval(timer);
    }, [isActive, timeLeft, onTimeUp]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Warning color when less than 30 seconds
    const isWarning = timeLeft <= 30;

    return (
        <div className={`flex items-center gap-2 font-mono font-bold text-lg ${isWarning ? "text-red-600" : "text-green-600"
            }`}>
            <Clock className="w-5 h-5" />
            {formatTime(timeLeft)}
        </div>
    );
}
