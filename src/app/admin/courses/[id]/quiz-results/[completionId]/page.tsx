"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, CheckCircle, XCircle, Award } from "lucide-react";

interface QuizResult {
    id: string;
    course_id: string;
    worker_id: string;
    quiz_score: number;
    completed_at: string;
    quiz_answers: QuizAnswer[];
}

interface QuizAnswer {
    question_id: string;
    selected_option: number | string;
    is_correct: boolean;
}

interface QuizQuestion {
    id: string;
    question_text: string;
    options: string[];
    correct_answer: number | string;
    explanation?: string;
}

interface Course {
    title: string;
}

interface Worker {
    full_name: string;
    role?: string;
}

export default function QuizResultsPage({ params }: { params: Promise<{ id: string; completionId: string }> }) {
    const { id, completionId } = use(params);
    const router = useRouter();
    const supabase = createClient();

    const [result, setResult] = useState<QuizResult | null>(null);
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [course, setCourse] = useState<Course | null>(null);
    const [worker, setWorker] = useState<Worker | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadQuizResults();
    }, [completionId]);

    const loadQuizResults = async () => {
        try {
            // Fetch completion record
            const { data: completionData, error: completionError } = await supabase
                .from("course_completions")
                .select("*")
                .eq("id", completionId)
                .single();

            if (completionError) throw completionError;
            setResult(completionData);

            // Fetch course info
            const { data: courseData } = await supabase
                .from("courses")
                .select("title")
                .eq("id", id)
                .single();
            setCourse(courseData);

            // Fetch worker info
            const { data: workerData } = await supabase
                .from("users")
                .select("full_name, role")
                .eq("id", completionData.worker_id)
                .single();
            setWorker(workerData);

            // Fetch quiz questions
            const { data: questionsData } = await supabase
                .from("quiz_questions")
                .select("*")
                .eq("course_id", id)
                .order("created_at");

            setQuestions(questionsData || []);
            setLoading(false);
        } catch (error) {
            console.error("Error loading quiz results:", error);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!result || !course) {
        return <div className="p-8 text-center">Quiz result not found</div>;
    }

    const userAnswers = result.quiz_answers || {};
    const totalQuestions = questions.length;

    // Calculate stats correctly
    let correctCount = 0;
    questions.forEach(q => {
        const userAnswer = userAnswers[q.id];
        const correctAnswer = typeof q.correct_answer === 'number'
            ? q.options[q.correct_answer]
            : q.correct_answer;

        // Normalize strings for comparison
        if (String(userAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase()) {
            correctCount++;
        }
    });

    const incorrectCount = totalQuestions - correctCount;
    // Calculate pass status based on score stored in result, or re-calculate
    const passed = result.quiz_score >= 80; // Assuming 80% pass mark (standard in LMS)

    return (
        <div className="min-h-screen bg-white p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <button
                    onClick={() => router.push(`/admin/courses/${id}`)}
                    className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Dashboard</span>
                </button>

                {/* Quiz Results Card */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden mb-8">
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
                        <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium">
                            Quiz Results
                        </span>
                        <h1 className="text-2xl font-bold mt-4">{course.title}</h1>
                        <p className="text-indigo-100 mt-2">
                            Completed by {worker?.full_name || "Unknown"} • {" "}
                            {new Date(result.completed_at).toLocaleDateString("en-US", {
                                month: "long",
                                day: "numeric",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit"
                            })}
                        </p>
                    </div>

                    <div className="p-8">
                        <div className="flex items-center justify-center gap-12 mb-8">
                            {/* Score Circle */}
                            <div className="relative">
                                <svg className="w-40 h-40 transform -rotate-90">
                                    <circle
                                        cx="80"
                                        cy="80"
                                        r="70"
                                        stroke="#e5e7eb"
                                        strokeWidth="12"
                                        fill="none"
                                    />
                                    <circle
                                        cx="80"
                                        cy="80"
                                        r="70"
                                        stroke={passed ? "#10b981" : "#ef4444"}
                                        strokeWidth="12"
                                        fill="none"
                                        strokeDasharray={`${(result.quiz_score / 100) * 440} 440`}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="text-4xl font-bold text-slate-900">{result.quiz_score}%</div>
                                        <div className="text-sm text-slate-500">Score</div>
                                    </div>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                                        <CheckCircle className="w-6 h-6 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-slate-900">{correctCount}</p>
                                        <p className="text-sm text-slate-500">{correctCount === 1 ? "Correct" : "Correct"}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                                        <XCircle className="w-6 h-6 text-red-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-slate-900">{incorrectCount}</p>
                                        <p className="text-sm text-slate-500">{incorrectCount === 1 ? "Incorrect" : "Incorrect"}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className={`w-12 h-12 ${passed ? "bg-green-100" : "bg-red-100"} rounded-lg flex items-center justify-center`}>
                                        <Award className={`w-6 h-6 ${passed ? "text-green-600" : "text-red-600"}`} />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-slate-900">{passed ? "Passed" : "Failed"}</p>
                                        <p className="text-sm text-slate-500">Status</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Answers Section */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6">Answers</h2>
                    <div className="space-y-6">
                        {questions.map((question, idx) => {
                            const userAnswer = userAnswers[question.id];

                            // Determine correct answer text
                            const correctAnswerText = typeof question.correct_answer === 'number'
                                ? question.options[question.correct_answer]
                                : question.correct_answer;

                            const isCorrect = String(userAnswer).trim().toLowerCase() === String(correctAnswerText).trim().toLowerCase();

                            return (
                                <div key={question.id} className="border-b border-gray-200 pb-6 last:border-0 last:pb-0">
                                    <h3 className="font-semibold text-slate-900 mb-4">
                                        {idx + 1}. {question.question_text}
                                    </h3>

                                    <div className="space-y-2">
                                        {question.options.map((option, optIdx) => {
                                            const isUserAnswer = userAnswer === option;
                                            const isCorrectOption = option === correctAnswerText;

                                            let bgColor = "bg-white";
                                            let borderColor = "border-gray-200";
                                            let textColor = "text-slate-700";

                                            if (isCorrectOption) {
                                                bgColor = "bg-green-50";
                                                borderColor = "border-green-500";
                                                textColor = "text-green-900";
                                            } else if (isUserAnswer && !isCorrect) {
                                                bgColor = "bg-red-50";
                                                borderColor = "border-red-500";
                                                textColor = "text-red-900";
                                            }

                                            return (
                                                <div
                                                    key={optIdx}
                                                    className={`p-4 rounded-lg border-2 ${bgColor} ${borderColor}`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium">{String.fromCharCode(65 + optIdx)}.</span>
                                                            <span className={textColor}>{option}</span>
                                                        </div>
                                                        {isCorrectOption && (
                                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                                        )}
                                                        {isUserAnswer && !isCorrect && (
                                                            <XCircle className="w-5 h-5 text-red-600" />
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {question.explanation && (
                                        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                            <p className="text-sm font-semibold text-blue-900 mb-1">Explanation:</p>
                                            <p className="text-sm text-blue-800">{question.explanation}</p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex justify-between items-center">
                    <button
                        onClick={() => router.push(`/admin/courses/${id}`)}
                        className="px-4 py-2 text-slate-600 hover:text-slate-900 font-medium"
                    >
                        ← Back to Course
                    </button>
                    <div className="flex gap-3">
                        <button className="px-4 py-2 bg-white border border-gray-300 text-slate-900 rounded-lg font-medium hover:bg-white transition-colors">
                            Share
                        </button>
                        <button className="px-4 py-2 bg-white border border-gray-300 text-slate-900 rounded-lg font-medium hover:bg-white transition-colors">
                            Export
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
