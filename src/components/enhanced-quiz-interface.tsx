"use client";

import { useState } from "react";
import { CheckCircle, XCircle, RotateCcw, ArrowRight } from "lucide-react";

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
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const [score, setScore] = useState(0);
    const [attempts, setAttempts] = useState(0);
    const [showResults, setShowResults] = useState(false);

    const handleAnswerChange = (questionId: string, answer: string) => {
        setAnswers({ ...answers, [questionId]: answer });
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
            }, 2000); // Give user time to see results
        }
    };

    const handleRetake = () => {
        setAnswers({});
        setSubmitted(false);
        setShowResults(false);
    };

    const isQuestionCorrect = (questionId: string) => {
        const question = questions.find((q) => q.id === questionId);
        return question && answers[questionId] === question.correct_answer;
    };

    const allQuestionsAnswered = questions.every((q) => answers[q.id]);

    if (showResults) {
        const passed = score >= 80;
        const correctCount = questions.filter((q) => isQuestionCorrect(q.id)).length;

        return (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                <div className={`text-center mb-8 p-6 rounded-lg ${passed ? "bg-green-50 border-2 border-green-200" : "bg-red-50 border-2 border-red-200"}`}>
                    {passed ? (
                        <>
                            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
                            <h2 className="text-2xl font-bold text-green-900 mb-2">Congratulations! You Passed!</h2>
                            <p className="text-lg text-green-700 mb-2">
                                You scored <strong>{score}%</strong> ({correctCount} out of {questions.length} correct)
                            </p>
                            <p className="text-sm text-green-600">
                                Proceeding to acknowledgment form...
                            </p>
                        </>
                    ) : (
                        <>
                            <XCircle className="w-16 h-16 mx-auto mb-4 text-red-600" />
                            <h2 className="text-2xl font-bold text-red-900 mb-2">Not Quite There Yet</h2>
                            <p className="text-lg text-red-700 mb-2">
                                You scored <strong>{score}%</strong> ({correctCount} out of {questions.length} correct)
                            </p>
                            <p className="text-sm text-red-600 mb-4">
                                You need 80% to pass. Review the lesson and try again.
                            </p>
                        </>
                    )}
                </div>

                {/* Show review of answers */}
                <div className="space-y-4 mb-6">
                    <h3 className="font-semibold text-slate-900 mb-4">Review Your Answers:</h3>
                    {questions.map((question, idx) => {
                        const isCorrect = isQuestionCorrect(question.id);
                        const userAnswer = answers[question.id];

                        return (
                            <div
                                key={question.id}
                                className={`border-2 rounded-lg p-4 ${isCorrect ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
                            >
                                <div className="flex items-start gap-3 mb-3">
                                    {isCorrect ? (
                                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                    ) : (
                                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                    )}
                                    <p className="font-medium text-slate-900">
                                        {idx + 1}. {question.question_text}
                                    </p>
                                </div>

                                <div className="ml-8 space-y-2">
                                    <p className="text-sm">
                                        <span className="font-medium">Your answer:</span>{" "}
                                        <span className={isCorrect ? "text-green-700" : "text-red-700"}>
                                            {userAnswer}
                                        </span>
                                    </p>
                                    {!isCorrect && (
                                        <p className="text-sm">
                                            <span className="font-medium">Correct answer:</span>{" "}
                                            <span className="text-green-700">{question.correct_answer}</span>
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Action buttons */}
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
                            <RotateCcw className="w-5 h-5" />
                            Retake Quiz
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Knowledge Check</h2>
                <p className="text-slate-600">
                    Answer the following questions to demonstrate your understanding. You need <strong>80%</strong> to pass.
                </p>
                {attempts > 0 && (
                    <p className="text-sm text-slate-500 mt-2">
                        Attempt #{attempts + 1}
                    </p>
                )}
            </div>

            <div className="space-y-6 mb-8">
                {questions.map((question, idx) => (
                    <div key={question.id} className="border border-gray-200 rounded-lg p-4">
                        <p className="font-medium text-slate-900 mb-3">
                            {idx + 1}. {question.question_text}
                        </p>
                        <div className="space-y-2">
                            {question.options.map((option, optIdx) => (
                                <label
                                    key={optIdx}
                                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-slate-50 cursor-pointer transition-colors"
                                >
                                    <input
                                        type="radio"
                                        name={`question-${question.id}`}
                                        value={option}
                                        checked={answers[question.id] === option}
                                        onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                                        className="w-4 h-4 text-indigo-600"
                                    />
                                    <span className="text-slate-700">{option}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex gap-4">
                <button
                    onClick={onReturnToLesson}
                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                    Back to Lesson
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!allQuestionsAnswered}
                    className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                    Submit Quiz
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>

            {!allQuestionsAnswered && (
                <p className="text-sm text-slate-500 text-center mt-4">
                    Please answer all questions before submitting
                </p>
            )}
        </div>
    );
}
