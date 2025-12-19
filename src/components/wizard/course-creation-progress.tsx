"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Loader2 } from "lucide-react";

interface ProgressStep {
    label: string;
    status: 'pending' | 'loading' | 'completed';
}

interface CourseCreationProgressProps {
    onComplete: () => void;
}

export function CourseCreationProgress({ onComplete }: CourseCreationProgressProps) {
    const [steps, setSteps] = useState<ProgressStep[]>([
        { label: "Analyzing policy and procedure", status: 'loading' },
        { label: "Extract course input data", status: 'pending' },
        { label: "Create course content and quiz", status: 'pending' },
        { label: "Finalize all modules", status: 'pending' },
    ]);

    useEffect(() => {
        // Step 1: Analyzing (2 seconds)
        const timer1 = setTimeout(() => {
            setSteps(prev => [
                { ...prev[0], status: 'completed' },
                { ...prev[1], status: 'loading' },
                prev[2],
                prev[3],
            ]);
        }, 2000);

        // Step 2: Extracting (4 seconds)
        const timer2 = setTimeout(() => {
            setSteps(prev => [
                prev[0],
                { ...prev[1], status: 'completed' },
                { ...prev[2], status: 'loading' },
                prev[3],
            ]);
        }, 4000);

        // Step 3: Creating content (this takes the actual time for AI generation)
        // We'll leave this as loading until the parent component tells us we're done
        // For now, we'll simulate it finishing after 6 seconds
        const timer3 = setTimeout(() => {
            setSteps(prev => [
                prev[0],
                prev[1],
                { ...prev[2], status: 'completed' },
                { ...prev[3], status: 'loading' },
            ]);
        }, 8000);

        // Step 4: Finalizing (10 seconds)
        const timer4 = setTimeout(() => {
            setSteps(prev => [
                prev[0],
                prev[1],
                prev[2],
                { ...prev[3], status: 'completed' },
            ]);
            // Notify completion after a brief pause
            setTimeout(onComplete, 1000);
        }, 10000);

        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
            clearTimeout(timer4);
        };
    }, [onComplete]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-white">
            <div className="max-w-lg w-full px-8">
                {/* Title */}
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-slate-900 mb-3">
                        Your course is being created...
                    </h2>
                    <p className="text-slate-500 mb-2">
                        We&apos;re reviewing your document to create the course.
                    </p>
                    <p className="text-sm text-slate-400">
                        You&apos;ll receive an email notification once the course is complete and ready for review.
                    </p>
                </div>

                {/* Progress Steps */}
                <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm mb-8">
                    <div className="space-y-5">
                        {steps.map((step, index) => (
                            <div key={index} className="flex items-center gap-3">
                                {step.status === 'completed' ? (
                                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                                ) : step.status === 'loading' ? (
                                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin flex-shrink-0" />
                                ) : (
                                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                                )}
                                <span className={`text-base ${step.status === 'completed'
                                        ? 'text-slate-700'
                                        : step.status === 'loading'
                                            ? 'text-slate-900 font-medium'
                                            : 'text-slate-400'
                                    }`}>
                                    {step.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Info Message */}
                <div className="text-center text-sm text-slate-500">
                    <p>This process may take 1-2 minutes depending on document size.</p>
                </div>
            </div>
        </div>
    );
}
