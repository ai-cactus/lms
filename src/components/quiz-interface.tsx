"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Question {
    id: string;
    text: string;
    options: string[];
    correctAnswer: number; // Index of correct option
}

interface QuizInterfaceProps {
    questions: Question[];
    onRetake: () => void;
}

export function QuizInterface({ questions, onRetake }: QuizInterfaceProps) {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [selectedOption, setSelectedOption] = useState<number | null>(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [shake, setShake] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);

    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex) / questions.length) * 100;

    const handleOptionSelect = (index: number) => {
        if (isAnswered) return;

        setSelectedOption(index);
        setIsAnswered(true);

        if (index === currentQuestion.correctAnswer) {
            setScore((prev) => prev + 1);
        } else {
            setShake(true);
            setTimeout(() => setShake(false), 500);
        }

        // Auto advance after delay
        setTimeout(() => {
            if (currentQuestionIndex < questions.length - 1) {
                setCurrentQuestionIndex((prev) => prev + 1);
                setSelectedOption(null);
                setIsAnswered(false);
            } else {
                setIsCompleted(true);
            }
        }, 1500);
    };

    if (isCompleted) {
        const percentage = (score / questions.length) * 100;
        const passed = percentage >= 50;

        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white p-12 rounded-3xl border border-gray-200 shadow-xl max-w-md w-full"
                >
                    <div className="mb-6 flex justify-center">
                        {passed ? (
                            <div className="p-4 rounded-full bg-green-50">
                                <CheckCircle2 className="w-16 h-16 text-green-500" />
                            </div>
                        ) : (
                            <div className="p-4 rounded-full bg-red-50">
                                <XCircle className="w-16 h-16 text-red-500" />
                            </div>
                        )}
                    </div>

                    <h2 className="text-3xl font-bold mb-2 text-slate-900">
                        {passed ? "Course Passed!" : "Course Failed"}
                    </h2>
                    <p className="text-slate-500 mb-8">
                        You scored {score} out of {questions.length} ({percentage.toFixed(0)}%)
                    </p>

                    {passed ? (
                        <div className="p-4 rounded-xl bg-green-50 border border-green-200 mb-8">
                            <p className="text-green-700 font-medium">
                                Great job! You&apos;ve mastered the material.
                            </p>
                        </div>
                    ) : (
                        <div className="p-4 rounded-xl bg-red-50 border border-red-200 mb-8">
                            <p className="text-red-700 font-medium">
                                You need 50% to pass. Please review the material and try again.
                            </p>
                        </div>
                    )}

                    <button
                        onClick={onRetake}
                        className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-indigo-200"
                    >
                        <RefreshCw className="w-5 h-5" />
                        {passed ? "Start New Course" : "Retake Course"}
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto w-full">
            {/* Progress Header */}
            <div className="mb-8 flex items-center justify-between text-sm text-slate-500">
                <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
                <span>Score: {score}</span>
            </div>
            <div className="h-1 w-full bg-slate-200 rounded-full mb-12 overflow-hidden">
                <motion.div
                    className="h-full bg-indigo-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5 }}
                />
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={currentQuestion.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{
                        opacity: 1,
                        x: shake ? [0, -10, 10, -10, 10, 0] : 0
                    }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{
                        x: shake ? { duration: 0.4 } : { duration: 0.3 }
                    }}
                    className={cn(
                        "bg-white p-8 rounded-3xl border border-gray-200 shadow-lg",
                        shake && "border-red-500/50"
                    )}
                >
                    <h3 className="text-2xl font-bold mb-8 leading-relaxed text-slate-900">
                        {currentQuestion.text}
                    </h3>

                    <div className="space-y-3">
                        {currentQuestion.options.map((option, index) => (
                            <button
                                key={index}
                                onClick={() => handleOptionSelect(index)}
                                disabled={isAnswered}
                                className={cn(
                                    "w-full p-4 rounded-xl text-left transition-all duration-200 border-2",
                                    isAnswered && index === currentQuestion.correctAnswer
                                        ? "bg-green-50 border-green-500 text-green-700"
                                        : isAnswered && index === selectedOption && index !== currentQuestion.correctAnswer
                                            ? "bg-red-50 border-red-500 text-red-700"
                                            : "bg-white border-transparent hover:bg-slate-100 hover:border-slate-200 text-slate-700",
                                    !isAnswered && "cursor-pointer",
                                    isAnswered && "cursor-default"
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <span>{option}</span>
                                    {isAnswered && index === currentQuestion.correctAnswer && (
                                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                                    )}
                                    {isAnswered && index === selectedOption && index !== currentQuestion.correctAnswer && (
                                        <AlertCircle className="w-5 h-5 text-red-500" />
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
