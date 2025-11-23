"use client";

import { useState, useEffect } from "react";
import { CheckCircle, XCircle, ArrowClockwise, ArrowRight, Clock } from "@phosphor-icons/react";

interface QuizQuestion {
    id: string;
    question_text: string;
    options: string[];
    correct_answer: string;
}

interface EnhancedQuizInterfaceProps {
    questions: QuizQuestion[];
    onPass: (score: number, attempts: number) => void;
    onReturnToLesson: () => void;
}

export default function EnhancedQuizInterface({
    questions,
    onPass,
    onReturnToLesson,
}: EnhancedQuizInterfaceProps) {
    const [quizStarted, setQuizStarted] = useState(false);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const [score, setScore] = useState(0);
    const [attempts, setAttempts] = useState(0);
    const [showResults, setShowResults] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(90); // 1:30 in seconds
    const [showAnswerFeedback, setShowAnswerFeedback] = useState(false);

    // Timer countdown
    useEffect(() => {
        if (!quizStarted || showResults) return;

        const timer = setInterval(() => {
            setTimeRemaining((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    handleSubmit();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [quizStarted, showResults]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const handleAnswerChange = (questionId: string, answer: string) => {
        setAnswers({ ...answers, [questionId]: answer });
        setShowAnswerFeedback(false);
    };

    const handleCheckAnswer = () => {
        setShowAnswerFeedback(true);
    };

    const handleNextQuestion = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
            setShowAnswerFeedback(false);
        } else {
            handleSubmit();
        }
    };

    const calculateScore = () => {
        let correct = 0;
        questions.forEach((q) => {
            if (answers[q.id] === q.correct_answer) {
                correct++;
            }
        });
        return Math.round((correct / questions.length) * 100);
    };

    const handleSubmit = () => {
        const calculatedScore = calculateScore();
        setScore(calculatedScore);
        setAttempts(attempts + 1);
        setSubmitted(true);
        setShowResults(true);

        // If passed, notify parent
        if (calculatedScore >= 80) {
            setTimeout(() => {
                onPass(calculatedScore, attempts + 1);
            }, 2000);
        }
    };

    const handleRetake = () => {
        setAnswers({});
        setSubmitted(false);
        setShowResults(false);
        setQuizStarted(false);
        setCurrentQuestionIndex(0);
        setTimeRemaining(90);
        setShowAnswerFeedback(false);
    };

    const isQuestionCorrect = (questionId: string) => {
        const question = questions.find((q) => q.id === questionId);
        return question && answers[questionId] === question.correct_answer;
    };

    const currentQuestion = questions[currentQuestionIndex];
    const currentAnswerIsCorrect = showAnswerFeedback && isQuestionCorrect(currentQuestion?.id);

    // Quiz Start Screen (Mockup #2)
    if (!quizStarted) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-3xl mx-auto">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">
                    Quiz 1: Basic CARF Principles{" "}
                    <span className="text-slate-500 font-normal">({questions.length} Questions)</span>
                </h2>

                <div className="grid grid-cols-2 gap-6 mb-8">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
                        <p className="text-sm text-slate-600 mb-2">Pass Grade</p>
                        <p className="text-3xl font-bold text-indigo-900">80% or higher</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                        <p className="text-sm text-slate-600 mb-2">Your Grade</p>
                        <p className="text-3xl font-bold text-slate-400">—</p>
                    </div>
                </div>

                <button
                    onClick={() => setQuizStarted(true)}
                    className="w-full px-8 py-4 bg-indigo-600 text-white text-lg font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                >
                    Start Quiz
                </button>
            </div>
        );
    }

    // Results Screen
    if (showResults) {
        const passed = score >= 80;
        const correctCount = questions.filter((q) => isQuestionCorrect(q.id)).length;

        return (
            <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-3xl mx-auto">
                <div
                    className={`text-center mb-8 p-6 rounded-lg ${passed ? "bg-green-50 border-2 border-green-200" : "bg-red-50 border-2 border-red-200"
                        }`}
                >
                    {passed ? (
                        <>
                            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" weight="fill" />
                            <h2 className="text-2xl font-bold text-green-900 mb-2">Congratulations! You Passed!</h2>
                            <p className="text-lg text-green-700 mb-2">
                                You scored <strong>{score}%</strong> ({correctCount} out of {questions.length} correct)
                            </p>
                            <p className="text-sm text-green-600">Proceeding to acknowledgment form...</p>
                        </>
                    ) : (
                        <>
                            <XCircle className="w-16 h-16 mx-auto mb-4 text-red-600" weight="fill" />
                            <h2 className="text-2xl font-bold text-red-900 mb-2">Not Quite There Yet</h2>
                            <p className="text-lg text-red-700 mb-2">
                                You scored <strong>{score}%</strong> ({correctCount} out of {questions.length} correct)
                            </p>
                            <p className="text-sm text-red-600 mb-4">You need 80% to pass. Review the lesson and try again.</p>
                        </>
                    )}
                </div>

                {!passed && (
                    <div className="flex gap-4">
                        <button
                            onClick={onReturnToLesson}
                            className="flex-1 px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                        >
                            Review Lesson
                        </button>
                        <button
                            onClick={handleRetake}
                            className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                        >
                            <ArrowClockwise className="w-5 h-5" />
                            Retake Quiz
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Quiz Question View (Mockup #3)
    const optionLabels = ["A", "B", "C", "D"];

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-4xl mx-auto">
            {/* Question Header with Timer */}
            <div className="border-b border-gray-200 px-8 py-4 flex items-center justify-between bg-slate-50">
                <h2 className="text-xl font-bold text-slate-900">
                    Quiz 1: Basic CARF Principles{" "}
                    <span className="text-slate-500 font-normal">({questions.length} Questions)</span>
                </h2>
                <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
                    <Clock className="w-5 h-5 text-green-600" weight="fill" />
                    <span className="text-lg font-bold text-green-700">{formatTime(timeRemaining)}</span>
                </div>
            </div>

            <div className="p-8">
                {/* Question */}
                <div className="mb-6">
                    <p className="text-lg font-semibold text-slate-900 mb-6">
                        {currentQuestionIndex + 1}. {currentQuestion.question_text}
                    </p>

                    {/* Options */}
                    <div className="space-y-3">
                        {currentQuestion.options.map((option, optIdx) => {
                            const isSelected = answers[currentQuestion.id] === option;
                            const isCorrectOption = option === currentQuestion.correct_answer;
                            const showFeedback = showAnswerFeedback;

                            return (
                                <label
                                    key={optIdx}
                                    className={`flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${showFeedback && isCorrectOption
                                        ? "bg-green-50 border-green-500"
                                        : showFeedback && isSelected && !isCorrectOption
                                            ? "bg-red-50 border-red-500"
                                            : isSelected
                                                ? "bg-indigo-50 border-indigo-500"
                                                : "border-gray-200 hover:bg-slate-50 hover:border-slate-300"
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-sm font-bold ${showFeedback && isCorrectOption
                                                ? "border-green-600 bg-green-600 text-white"
                                                : showFeedback && isSelected && !isCorrectOption
                                                    ? "border-red-600 bg-red-600 text-white"
                                                    : isSelected
                                                        ? "border-indigo-600 bg-indigo-600 text-white"
                                                        : "border-gray-300 text-gray-400"
                                                }`}
                                        >
                                            {optionLabels[optIdx]}
                                        </div>
                                        <input
                                            type="radio"
                                            name={`question-${currentQuestion.id}`}
                                            value={option}
                                            checked={isSelected}
                                            onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                                            className="sr-only"
                                            disabled={showAnswerFeedback}
                                        />
                                    </div>
                                    <span
                                        className={`flex-1 ${showFeedback && isCorrectOption
                                            ? "text-green-900 font-medium"
                                            : showFeedback && isSelected && !isCorrectOption
                                                ? "text-red-900"
                                                : isSelected
                                                    ? "text-indigo-900 font-medium"
                                                    : " text-slate-700"
                                            }`}
                                    >
                                        {option}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
                    {!showAnswerFeedback ? (
                        <button
                            onClick={handleCheckAnswer}
                            disabled={!answers[currentQuestion.id]}
                            className="px-6 py-3 text-indigo-600 font-medium rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-200"
                        >
                            Check Answer
                        </button>
                    ) : null}

                    <button
                        onClick={handleNextQuestion}
                        disabled={!showAnswerFeedback}
                        className="flex-1 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm shadow-indigo-200"
                    >
                        {currentQuestionIndex < questions.length - 1 ? "Next Question" : "Submit Quiz"}
                        <ArrowRight className="w-5 h-5" />
                    </button>
                </div>

                {/* Progress Indicator */}
                <div className="mt-6 text-center text-sm text-slate-500">
                    Question {currentQuestionIndex + 1} of {questions.length}
                </div>
            </div>
        </div>
    );
}
