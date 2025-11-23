"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    CheckCircle,
    BookOpen,
    ArrowLeft,
    X,
    ChevronRight,
    ChevronLeft,
    Share2,
    Menu,
    Clock,
    HelpCircle,
    AlertCircle,
    Check,
    XCircle
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { QuizTimer } from "@/components/quiz-timer";
import { CircularProgress } from "@/components/circular-progress";

export default function TrainingPage() {
    const [currentStep, setCurrentStep] = useState<"lesson" | "quiz" | "results">("lesson");
    const [assignment, setAssignment] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [workerName, setWorkerName] = useState("");

    // Quiz State
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [quizScore, setQuizScore] = useState<number | null>(null);
    const [quizPassed, setQuizPassed] = useState(false);
    const [quizSubmitted, setQuizSubmitted] = useState(false);
    const [showReview, setShowReview] = useState(false);

    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const assignmentId = params.assignmentId as string;

    useEffect(() => {
        loadAssignment();
    }, [assignmentId]);

    const loadAssignment = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get worker name
            const { data: workerData } = await supabase
                .from("users")
                .select("full_name")
                .eq("id", user.id)
                .single();

            if (workerData) setWorkerName(workerData.full_name);

            const { data, error } = await supabase
                .from("course_assignments")
                .select(`
          id,
          course_id,
          status,
          course:courses(
            id,
            title,
            lesson_notes,
            delivery_format,
            quiz_questions(
              id,
              question_text,
              options,
              correct_answer,
              question_type
            )
          )
        `)
                .eq("id", assignmentId)
                .eq("worker_id", user.id)
                .single();

            if (error) throw error;

            setAssignment(data);

            // Update status to in_progress if still not_started
            if (data.status === "not_started") {
                await supabase
                    .from("course_assignments")
                    .update({
                        status: "in_progress"
                    })
                    .eq("id", assignmentId);
            }

            setLoading(false);
        } catch (error) {
            console.error("Error loading assignment:", error);
            setLoading(false);
        }
    };

    // Helper function to safely get question text
    const getQuestionText = (questionText: any): string => {
        if (typeof questionText === 'string') return questionText;
        if (questionText && typeof questionText === 'object' && 'text' in questionText) {
            return questionText.text;
        }
        return '';
    };

    const handleQuizSubmit = async () => {
        const questions = assignment.course.quiz_questions;

        // Calculate score
        let correct = 0;
        const answersData = questions.map((q: any) => {
            // Case insensitive comparison for text answers
            const isCorrect = q.question_type === 'short_answer'
                ? (quizAnswers[q.id] || "").toLowerCase().trim() === (q.correct_answer || "").toLowerCase().trim()
                : quizAnswers[q.id] === q.correct_answer;

            if (isCorrect) correct++;

            return {
                questionId: q.id,
                questionText: getQuestionText(q.question_text),
                selectedOption: quizAnswers[q.id],
                correctAnswer: q.correct_answer,
                isCorrect
            };
        });

        const score = Math.round((correct / questions.length) * 100);
        const passed = score >= 80;

        setQuizScore(score);
        setQuizPassed(passed);
        setQuizSubmitted(true);
        setCurrentStep("results");

        // Save quiz attempt
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { saveQuizAttempt } = await import("@/app/actions/quiz");
                await saveQuizAttempt({
                    workerId: user.id,
                    courseId: assignment.course.id,
                    assignmentId: assignmentId,
                    score,
                    passed,
                    answers: answersData
                });

                // If passed, mark as completed
                if (passed) {
                    await supabase
                        .from("course_completions")
                        .insert({
                            assignment_id: assignmentId,
                            worker_id: user.id,
                            course_id: assignment.course.id,
                            quiz_score: score,
                            attempt_number: 1,
                            acknowledgment_date: new Date().toISOString(),
                        });

                    await supabase
                        .from("course_assignments")
                        .update({ status: "completed" })
                        .eq("id", assignmentId);
                }
            }
        } catch (err) {
            console.error("Failed to save quiz attempt:", err);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading training content...</div>
            </div>
        );
    }

    if (!assignment) return null;

    const questions = assignment.course.quiz_questions || [];
    const currentQuestion = questions[currentQuestionIndex];

    return (
        <div className="min-h-screen bg-slate-50 font-sans">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                                    T
                                </div>
                                <span className="text-xl font-bold text-indigo-900">Theraptly</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-100 rounded-full">
                                <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-medium">
                                    {workerName.charAt(0)}
                                </div>
                                <span className="text-sm font-medium text-slate-700 pr-2">{workerName}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Sub-header / Breadcrumb */}
            <div className="bg-indigo-50/50 border-b border-indigo-100">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <span className="hover:text-indigo-600 cursor-pointer" onClick={() => router.push('/worker/dashboard')}>Trainings</span>
                            <span>/</span>
                            <span className="font-medium text-slate-900">{assignment.course.title}</span>
                        </div>

                        {currentStep === "lesson" && (
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <CircularProgress percentage={80} size={32} strokeWidth={4} showText={false} />
                                    <div className="text-xs">
                                        <p className="font-bold text-slate-900">Your Progress</p>
                                        <p className="text-slate-500">16 of 20 Completed</p>
                                    </div>
                                </div>
                                <button className="p-2 hover:bg-white rounded-lg text-indigo-600 transition-colors border border-transparent hover:border-indigo-100 hover:shadow-sm">
                                    <Share2 className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="flex gap-8">
                    {/* Main Content Area */}
                    <div className="flex-1">
                        {currentStep === "lesson" && (
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 min-h-[600px]">
                                <div className="prose prose-lg max-w-none prose-headings:text-slate-900 prose-p:text-slate-600">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                    >
                                        {assignment.course.lesson_notes}
                                    </ReactMarkdown>
                                </div>

                                <div className="mt-12 flex justify-end">
                                    <button
                                        onClick={() => setCurrentStep("quiz")}
                                        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-200"
                                    >
                                        Take Quiz
                                        <ChevronRight className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {currentStep === "quiz" && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-2xl font-bold text-slate-900">
                                        Quiz: {assignment.course.title}
                                    </h2>
                                    <div className="flex items-center gap-2 text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-lg">
                                        <Clock className="w-5 h-5" />
                                        <span>1:30</span>
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 min-h-[400px]">
                                    <div className="mb-8">
                                        <p className="font-medium text-slate-900 text-lg mb-6">
                                            {currentQuestionIndex + 1}. {getQuestionText(currentQuestion.question_text)}
                                        </p>

                                        {currentQuestion.question_type === 'short_answer' ? (
                                            <textarea
                                                value={quizAnswers[currentQuestion.id] || ''}
                                                onChange={(e) => setQuizAnswers({ ...quizAnswers, [currentQuestion.id]: e.target.value })}
                                                placeholder="Short answer"
                                                className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-h-[120px] text-slate-700"
                                            />
                                        ) : (
                                            <div className="space-y-3">
                                                {currentQuestion.options?.map((option: string, idx: number) => (
                                                    <label
                                                        key={idx}
                                                        className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${quizAnswers[currentQuestion.id] === option
                                                            ? "border-indigo-600 bg-indigo-50"
                                                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                                                            }`}
                                                    >
                                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${quizAnswers[currentQuestion.id] === option
                                                            ? "border-indigo-600"
                                                            : "border-gray-300"
                                                            }`}>
                                                            {quizAnswers[currentQuestion.id] === option && (
                                                                <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />
                                                            )}
                                                        </div>
                                                        <input
                                                            type="radio"
                                                            name={`question-${currentQuestion.id}`}
                                                            value={option}
                                                            checked={quizAnswers[currentQuestion.id] === option}
                                                            onChange={(e) => setQuizAnswers({ ...quizAnswers, [currentQuestion.id]: e.target.value })}
                                                            className="hidden"
                                                        />
                                                        <span className="text-slate-700 font-medium">{option}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between pt-8 border-t border-gray-100">
                                        <button
                                            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                                            disabled={currentQuestionIndex === 0}
                                            className="px-6 py-2.5 border border-gray-200 text-slate-600 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            Previous Question
                                        </button>

                                        <div className="flex gap-4">
                                            {/* Only show Check Answer if needed, for now we just navigate */}
                                            {currentQuestionIndex < questions.length - 1 ? (
                                                <button
                                                    onClick={() => setCurrentQuestionIndex(currentQuestionIndex + 1)}
                                                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                                                >
                                                    Next Question
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleQuizSubmit}
                                                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                                                >
                                                    Submit Quiz
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {currentStep === "results" && (
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center min-h-[600px] flex flex-col items-center justify-center">
                                {!showReview ? (
                                    <>
                                        <h2 className="text-3xl font-bold text-slate-900 mb-4">Congratulations!</h2>
                                        <p className="text-slate-600 mb-8 max-w-md">
                                            You've completed the course. We hope you've learned something new about <span className="font-bold text-slate-900">{assignment.course.title}</span> today.
                                        </p>

                                        <p className="text-slate-500 mb-4">Your Quiz Score is:</p>
                                        <div className="mb-8">
                                            <CircularProgress
                                                percentage={quizScore || 0}
                                                size={160}
                                                strokeWidth={12}
                                                color={quizPassed ? "text-green-500" : "text-red-500"}
                                            />
                                        </div>

                                        <p className={`text-lg font-bold mb-8 ${quizPassed ? "text-green-600" : "text-red-600"}`}>
                                            {quizPassed ? "You passed the course." : "You did not pass the course."}
                                        </p>

                                        <div className="grid grid-cols-1 gap-4 w-full max-w-sm mb-8">
                                            <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                                                        <HelpCircle className="w-4 h-4" />
                                                    </div>
                                                    <span className="font-medium text-slate-700">QUESTIONS ANSWERED</span>
                                                </div>
                                                <span className="font-bold text-slate-900">{questions.length}</span>
                                            </div>
                                            <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                                                        <Check className="w-4 h-4" />
                                                    </div>
                                                    <span className="font-medium text-slate-700">CORRECT ANSWERS</span>
                                                </div>
                                                <span className="font-bold text-slate-900">
                                                    {Math.round((quizScore || 0) / 100 * questions.length)}
                                                </span>
                                            </div>
                                            <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                                                        <X className="w-4 h-4" />
                                                    </div>
                                                    <span className="font-medium text-slate-700">WRONG ANSWERS</span>
                                                </div>
                                                <span className="font-bold text-slate-900">
                                                    {questions.length - Math.round((quizScore || 0) / 100 * questions.length)}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex gap-4">
                                            <button
                                                onClick={() => setShowReview(true)}
                                                className="px-6 py-3 border border-gray-200 text-slate-700 rounded-xl font-bold hover:bg-gray-50 transition-colors flex items-center gap-2"
                                            >
                                                View Result
                                                <Share2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => router.push('/worker/dashboard')}
                                                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-200"
                                            >
                                                FINISH
                                                <CheckCircle className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="w-full text-left">
                                        <div className="flex items-center justify-between mb-8">
                                            <button
                                                onClick={() => setShowReview(false)}
                                                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium"
                                            >
                                                <ArrowLeft className="w-4 h-4" />
                                                Back to Dashboard
                                            </button>
                                            <div className="flex gap-2">
                                                <button className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">Share</button>
                                                <button className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">Export</button>
                                            </div>
                                        </div>

                                        <div className="mb-8">
                                            <h2 className="text-2xl font-bold text-slate-900 mb-1">{assignment.course.title}</h2>
                                            <p className="text-slate-500 text-sm">Completed by {workerName} • {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
                                        </div>

                                        <div className="bg-white rounded-xl border border-gray-200 p-8 mb-8 flex items-center justify-center gap-12">
                                            <CircularProgress
                                                percentage={quizScore || 0}
                                                size={120}
                                                strokeWidth={10}
                                                color={quizPassed ? "text-green-500" : "text-red-500"}
                                            />
                                            <div className="flex gap-8">
                                                <div className="text-center">
                                                    <div className="flex items-center gap-1 text-green-600 font-bold text-xl mb-1">
                                                        <Check className="w-5 h-5" />
                                                        {Math.round((quizScore || 0) / 100 * questions.length)} <span className="text-slate-400 text-sm font-normal">/{questions.length}</span>
                                                    </div>
                                                    <p className="text-xs font-bold text-slate-400 tracking-wider">CORRECT</p>
                                                </div>
                                                <div className="text-center">
                                                    <div className="flex items-center gap-1 text-red-600 font-bold text-xl mb-1">
                                                        <X className="w-5 h-5" />
                                                        {questions.length - Math.round((quizScore || 0) / 100 * questions.length)} <span className="text-slate-400 text-sm font-normal">/{questions.length}</span>
                                                    </div>
                                                    <p className="text-xs font-bold text-slate-400 tracking-wider">INCORRECT</p>
                                                </div>
                                                <div className="text-center">
                                                    <div className={`font-bold text-xl mb-1 px-2 py-0.5 rounded ${quizPassed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                                        {quizPassed ? "Passed" : "Failed"}
                                                    </div>
                                                    <p className="text-xs font-bold text-slate-400 tracking-wider">STATUS</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-8">
                                            <h3 className="font-bold text-lg text-slate-900">Answers</h3>
                                            {questions.map((q: any, idx: number) => {
                                                const isCorrect = q.question_type === 'short_answer'
                                                    ? (quizAnswers[q.id] || "").toLowerCase().trim() === (q.correct_answer || "").toLowerCase().trim()
                                                    : quizAnswers[q.id] === q.correct_answer;

                                                return (
                                                    <div key={q.id} className="border-b border-gray-100 pb-8 last:border-0">
                                                        <p className="font-bold text-slate-900 mb-4 flex gap-2">
                                                            <span>{idx + 1}.</span>
                                                            {getQuestionText(q.question_text)}
                                                        </p>

                                                        <div className="space-y-3 mb-4">
                                                            {q.options?.map((option: string, optIdx: number) => (
                                                                <div
                                                                    key={optIdx}
                                                                    className={`p-4 rounded-lg border ${q.correct_answer === option
                                                                        ? "bg-green-50 border-green-200"
                                                                        : quizAnswers[q.id] === option
                                                                            ? "bg-red-50 border-red-200"
                                                                            : "bg-white border-gray-100"
                                                                        }`}
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-slate-700">{option}</span>
                                                                        {q.correct_answer === option && <Check className="w-5 h-5 text-green-600" />}
                                                                        {quizAnswers[q.id] === option && q.correct_answer !== option && <X className="w-5 h-5 text-red-600" />}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div className={`p-4 rounded-lg ${isCorrect ? "bg-green-100" : "bg-green-100"}`}>
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <div className="bg-green-600 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                                                                    <Check className="w-3 h-3" />
                                                                    Correct Answer: {q.correct_answer}
                                                                </div>
                                                            </div>
                                                            <p className="text-sm text-green-800">
                                                                <span className="font-bold">Explanation:</span> A policy manual defines the organization's guiding standards, principles, and regulatory obligations — ensuring consistent and compliant behavior across all departments.
                                                            </p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sidebar - Table of Content */}
                    {currentStep === "lesson" && (
                        <div className="w-80 hidden lg:block">
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sticky top-24">
                                <h3 className="font-bold text-slate-900 mb-4">Table of Content</h3>
                                <div className="space-y-1 relative">
                                    {/* Dotted line */}
                                    <div className="absolute left-0 top-2 bottom-2 w-px border-l border-dashed border-gray-200 ml-3.5" />

                                    {[
                                        "Benefits of remote worksop",
                                        "Challenges for remote workshops",
                                        "What goes into a successful remote work...",
                                        "Best practices for a remote workshop",
                                        "Common remote workshop mistakes",
                                        "Quiz 1: Basic CARF Principles",
                                        "Tools needed for remote workshops"
                                    ].map((item, idx) => (
                                        <div key={idx} className="relative pl-8 py-2">
                                            {idx === 5 ? (
                                                <>
                                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-indigo-600 ring-4 ring-indigo-50 ml-2.5 z-10" />
                                                    <span className="text-indigo-600 font-medium text-sm block cursor-pointer hover:underline">
                                                        {item}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="text-slate-500 text-sm block cursor-pointer hover:text-slate-900 transition-colors">
                                                    {item}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
