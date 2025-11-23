"use client";

import { Check, Spinner } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Step5ProcessingProps {
    onComplete: () => void;
}

export function Step5Processing({ onComplete }: Step5ProcessingProps) {
    const router = useRouter();
    const [progress, setProgress] = useState(0);
    const [completedSteps, setCompletedSteps] = useState<number[]>([]);

    const steps = [
        "Analyzing policy and procedure",
        "Extract course input data",
        "Create course content and quiz",
        "Finalize all modules"
    ];

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= steps.length) {
                    clearInterval(interval);
                    return prev;
                }
                return prev + 1;
            });
        }, 1500);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (progress > 0 && progress <= steps.length) {
            setCompletedSteps((prev) => [...prev, progress - 1]);
        }
    }, [progress]);

    const isComplete = progress >= steps.length;

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Your course is being created...</h2>
            <p className="text-slate-500 mb-12 max-w-xl mx-auto text-base">
                We're reviewing your document to create the course.
                You'll receive an email notification once the course is complete and ready for review.
            </p>

            <div className="max-w-md mx-auto bg-white rounded-3xl border border-gray-200 p-8 shadow-sm mb-12">
                <div className="space-y-6 text-left">
                    {steps.map((step, idx) => {
                        const isDone = completedSteps.includes(idx);
                        const isCurrent = progress === idx;
                        const isPending = progress < idx;

                        return (
                            <div key={idx} className="flex items-center gap-4">
                                <div className="w-6 flex justify-center">
                                    {isDone ? (
                                        <Check size={20} className="text-slate-900" weight="bold" />
                                    ) : isCurrent ? (
                                        <Spinner size={20} className="text-slate-400 animate-spin" />
                                    ) : (
                                        <div className="w-2 h-2 rounded-full bg-slate-200" />
                                    )}
                                </div>
                                <span className={`text-lg ${isDone ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
                                    {step}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {isComplete && (
                <button
                    onClick={() => router.push("/admin/dashboard")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-12 py-3 rounded-lg font-medium shadow-sm transition-all animate-in fade-in zoom-in duration-300"
                >
                    Goto Dashboard
                </button>
            )}
        </div>
    );
}
