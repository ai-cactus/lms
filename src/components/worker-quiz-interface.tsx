"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, AlertCircle, ArrowRight, ArrowLeft, Clock, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export interface QuizQuestion {
    id: string;
    question_text: string;
    options: string[];
    correct_answer: string;
}

export interface QuizAnswer {
    questionId: string;
    questionText: string;
    selectedOption: string;
    correctAnswer: string;
    isCorrect: boolean;
}

interface WorkerQuizInterfaceProps {
    questions: QuizQuestion[];
    onComplete: (score: number, answers: QuizAnswer[]) => void;
    onExit: () => void;
    initialTimeSeconds?: number; // Optional timer duration in seconds
}

export function WorkerQuizInterface({
    questions,
    onComplete,
    onExit,
    initialTimeSeconds = 90 // Default 1:30
}: WorkerQuizInterfaceProps) {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [checkedAnswers, setCheckedAnswers] = useState<Record<string, boolean>>({}); // Track which questions have been checked
    const [timeLeft, setTimeLeft] = useState(initialTimeSeconds);
    const [isTimerRunning, setIsTimerRunning] = useState(true);

    const currentQuestion = questions[currentQuestionIndex];
    const isLastQuestion = currentQuestionIndex === questions.length - 1;
    const isChecked = checkedAnswers[currentQuestion.id];
    const selectedOption = answers[currentQuestion.id];
    const isCorrect = selectedOption === currentQuestion.correct_answer;

    // Timer effect
    useEffect(() => {
        if (!isTimerRunning || timeLeft <= 0) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    setIsTimerRunning(false);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [isTimerRunning, timeLeft]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleOptionSelect = (option: string) => {
        if (isChecked) return; // Prevent changing answer after checking
        setAnswers(prev => ({
            ...prev,
            [currentQuestion.id]: option
        }));
    };

    const handleCheckAnswer = () => {
        if (!selectedOption) return;
        setCheckedAnswers(prev => ({
            ...prev,
            [currentQuestion.id]: true
        }));
    };

    const handleNext = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
            // Calculate final score and submit
            const results: QuizAnswer[] = questions.map(q => ({
                questionId: q.id,
                questionText: q.question_text,
                selectedOption: answers[q.id],
                correctAnswer: q.correct_answer,
                isCorrect: answers[q.id] === q.correct_answer
            }));

            const correctCount = results.filter(r => r.isCorrect).length;
            const score = Math.round((correctCount / questions.length) * 100);

            onComplete(score, results);
        }
    };

    const handlePrevious = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(prev => prev - 1);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            {/* Quiz Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">
                        Quiz 1: Basic CARF Principles <span className="text-slate-500 text-lg font-normal ml-2">({questions.length} Questions)</span>
                    </h2>
                </div>
                <div className="flex items-center gap-2 text-green-600 font-medium bg-green-50 px-4 py-2 rounded-lg">
                    <Clock className="w-5 h-5" />
                    <span className="text-lg tabular-nums">{formatTime(timeLeft)}</span>
                </div>
            </div>

            {/* Question Card */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-8 md:p-10">
                    <h3 className="text-xl font-bold text-slate-900 mb-8 leading-relaxed">
                        {currentQuestionIndex + 1}. {currentQuestion.question_text}
                    </h3>

                    <div className="space-y-4">
                        {currentQuestion.options.map((option, idx) => {
                            const isSelected = selectedOption === option;
                            const isCorrectAnswer = option === currentQuestion.correct_answer;
                            const optionLabel = String.fromCharCode(65 + idx); // A, B, C, D...

                            let buttonStyle = "border-slate-200 hover:border-indigo-300 hover:bg-white";
                            let icon = null;

                            if (isSelected && !isChecked) {
                                buttonStyle = "border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600";
                            } else if (isChecked) {
                                if (isCorrectAnswer) {
                                    buttonStyle = "border-green-500 bg-green-50 text-green-900 ring-1 ring-green-500";
                                    icon = <CheckCircle2 className="w-5 h-5 text-green-600" />;
                                } else if (isSelected && !isCorrectAnswer) {
                                    buttonStyle = "border-red-300 bg-red-50 text-red-900";
                                    icon = <XCircle className="w-5 h-5 text-red-500" />;
                                } else {
                                    buttonStyle = "border-slate-100 opacity-50";
                                }
                            }

                            return (
                                <button
                                    key={idx}
                                    onClick={() => handleOptionSelect(option)}
                                    disabled={isChecked}
                                    className={cn(
                                        "w-full p-4 rounded-xl border-2 text-left transition-all duration-200 flex items-center justify-between group",
                                        buttonStyle
                                    )}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className={cn(
                                            "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors",
                                            isSelected && !isChecked ? "bg-indigo-600 text-white" :
                                                isChecked && isCorrectAnswer ? "bg-green-600 text-white" :
                                                    isChecked && isSelected && !isCorrectAnswer ? "bg-red-500 text-white" :
                                                        "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                                        )}>
                                            {optionLabel}
                                        </span>
                                        <span className="font-medium">{option}</span>
                                    </div>
                                    {icon}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Feedback Banner */}
                <AnimatePresence>
                    {isChecked && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className={cn(
                                "border-t px-8 py-6",
                                isCorrect ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"
                            )}
                        >
                            <div className="flex items-start gap-4">
                                <div className={cn(
                                    "p-2 rounded-full",
                                    isCorrect ? "bg-green-100" : "bg-red-100"
                                )}>
                                    {isCorrect ? (
                                        <CheckCircle className="w-6 h-6 text-green-600" />
                                    ) : (
                                        <XCircle className="w-6 h-6 text-red-600" />
                                    )}
                                </div>
                                <div>
                                    <h4 className={cn(
                                        "text-lg font-bold mb-1",
                                        isCorrect ? "text-green-800" : "text-red-800"
                                    )}>
                                        {isCorrect ? "Correct answer !!!" : "Incorrect answer"}
                                    </h4>
                                    <p className={cn(
                                        "text-sm",
                                        isCorrect ? "text-green-700" : "text-red-700"
                                    )}>
                                        {isCorrect
                                            ? `You selected the correct option: ${selectedOption}`
                                            : `The correct answer is: ${currentQuestion.correct_answer}`
                                        }
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Footer Navigation */}
                <div className="p-8 border-t border-slate-100 flex items-center justify-between bg-white/50">
                    <div>
                        {currentQuestionIndex > 0 && (
                            <button
                                onClick={handlePrevious}
                                className="px-6 py-3 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-colors border border-slate-200 bg-white"
                            >
                                Previous Question
                            </button>
                        )}
                    </div>

                    <div className="flex gap-4">
                        {!isChecked ? (
                            <button
                                onClick={handleCheckAnswer}
                                disabled={!selectedOption}
                                className="px-8 py-3 bg-white border-2 border-indigo-600 text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Check Answer
                            </button>
                        ) : (
                            <button
                                onClick={handleNext}
                                className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center gap-2"
                            >
                                {isLastQuestion ? "Complete Quiz" : "Next Question"}
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
