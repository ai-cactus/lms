"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProcessingStep {
    id: string;
    message: string;
    status: "pending" | "processing" | "completed";
}

interface ProcessingFeedProps {
    steps: ProcessingStep[];
}

export function ProcessingFeed({ steps }: ProcessingFeedProps) {
    return (
        <div className="w-full max-w-2xl mx-auto mt-8 space-y-4">
            <AnimatePresence mode="popLayout">
                {steps.map((step) => (
                    <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -20, height: 0 }}
                        animate={{ opacity: 1, x: 0, height: "auto" }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className={cn(
                            "relative overflow-hidden rounded-xl border p-4 transition-colors duration-300",
                            step.status === "processing"
                                ? "bg-indigo-50 border-indigo-200 shadow-sm"
                                : step.status === "completed"
                                    ? "bg-green-50 border-green-200"
                                    : "bg-white border-gray-200"
                        )}
                    >
                        <div className="flex items-center gap-4">
                            <div className="relative flex-shrink-0">
                                {step.status === "processing" && (
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                    >
                                        <Loader2 className="w-5 h-5 text-indigo-600" />
                                    </motion.div>
                                )}
                                {step.status === "completed" && (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                    >
                                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                                    </motion.div>
                                )}
                                {step.status === "pending" && (
                                    <div className="w-5 h-5 rounded-full border-2 border-slate-200" />
                                )}
                            </div>

                            <div className="flex-1">
                                <p className={cn(
                                    "text-sm font-medium transition-colors",
                                    step.status === "processing" ? "text-indigo-900" : "text-slate-500"
                                )}>
                                    {step.message}
                                </p>
                            </div>

                            {step.status === "processing" && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex items-center gap-2"
                                >
                                    <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                                    <span className="text-xs text-indigo-600 font-medium">AI Active</span>
                                </motion.div>
                            )}
                        </div>

                        {/* Progress Bar for active step */}
                        {step.status === "processing" && (
                            <motion.div
                                className="absolute bottom-0 left-0 h-1 bg-indigo-600"
                                initial={{ width: "0%" }}
                                animate={{ width: "100%" }}
                                transition={{ duration: 2, ease: "easeInOut" }}
                            />
                        )}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
