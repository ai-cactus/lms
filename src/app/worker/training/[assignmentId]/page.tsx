"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, BookOpen, ClipboardCheck, ArrowLeft, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function TrainingPage() {
    const [currentStep, setCurrentStep] = useState<"lesson" | "quiz" | "acknowledgment">("lesson");
    const [assignment, setAssignment] = useState<any>(null);
    const [lessonViewed, setLessonViewed] = useState(false);
    const [quizPassed, setQuizPassed] = useState(false);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [quizScore, setQuizScore] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [signature, setSignature] = useState("");
    const [acknowledged, setAcknowledged] = useState(false);
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
            quiz_questions(
              id,
              question_text,
              options,
              correct_answer
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

    const handleExit = () => {
        if (confirm("Are you sure you want to exit? Your progress will be saved.")) {
            router.push("/worker/dashboard");
        }
    };

    const handleLessonComplete = () => {
        setLessonViewed(true);
        setCurrentStep("quiz");
    };

    // Scroll to top when step changes
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [currentStep]);

    const handleQuizSubmit = () => {
        const questions = assignment.course.quiz_questions;

        // Validate all questions answered
        if (Object.keys(quizAnswers).length < questions.length) {
            alert("Please answer all questions before submitting.");
            return;
        }

        // Calculate score
        let correct = 0;
        questions.forEach((q: any) => {
            if (quizAnswers[q.id] === q.correct_answer) {
                correct++;
            }
        });

        const score = Math.round((correct / questions.length) * 100);
        setQuizScore(score);

        if (score >= 80) {
            setQuizPassed(true);
            setCurrentStep("acknowledgment");
        } else {
            alert(`You scored ${score}%. You need 80% to pass. Please review the lesson and try again.`);
        }
    };

    const handleAcknowledgmentComplete = async () => {
        if (!signature.trim()) {
            alert("Please provide your digital signature.");
            return;
        }

        if (!acknowledged) {
            alert("Please acknowledge that you have completed the training.");
            return;
        }

        setSubmitting(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            // Create completion record
            const { error: completionError } = await supabase
                .from("course_completions")
                .insert({
                    assignment_id: assignmentId,
                    worker_id: user.id,
                    course_id: assignment.course.id,
                    quiz_score: quizScore,
                    attempt_number: 1,
                    acknowledgment_signature: signature,
                    acknowledgment_date: new Date().toISOString(),
                });

            if (completionError) throw completionError;

            // Update assignment status
            const { error: assignmentError } = await supabase
                .from("course_assignments")
                .update({ status: "completed" })
                .eq("id", assignmentId);

            if (assignmentError) throw assignmentError;

            router.push("/worker/dashboard");
        } catch (error: any) {
            console.error("Error saving completion:", error);
            alert(`Failed to save completion: ${error.message || error.details || "Unknown error"}`);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading training...</div>
            </div>
        );
    }

    if (!assignment) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-slate-600 mb-4">Training not found</p>
                    <button
                        onClick={() => router.push("/worker/dashboard")}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleExit}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Exit training"
                            >
                                <X className="w-5 h-5 text-slate-600" />
                            </button>
                            <div>
                                <h1 className="text-xl font-bold text-slate-900">{assignment.course.title}</h1>
                                <p className="text-sm text-slate-600">Complete all steps to finish this training</p>
                            </div>
                        </div>
                    </div>

                    {/* Progress Steps */}
                    <div className="flex items-center gap-4">
                        {/* Step 1: Lesson */}
                        <div className="flex items-center gap-2">
                            <div
                                className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm ${currentStep === "lesson"
                                    ? "bg-indigo-600 text-white"
                                    : lessonViewed
                                        ? "bg-green-600 text-white"
                                        : "bg-gray-200 text-gray-500"
                                    }`}
                            >
                                {lessonViewed ? <CheckCircle className="w-5 h-5" /> : "1"}
                            </div>
                            <span className="text-sm font-medium text-slate-700">Lesson</span>
                        </div>

                        <div className="flex-1 h-0.5 bg-gray-300" />

                        {/* Step 2: Quiz */}
                        <div className="flex items-center gap-2">
                            <div
                                className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm ${currentStep === "quiz"
                                    ? "bg-indigo-600 text-white"
                                    : quizPassed
                                        ? "bg-green-600 text-white"
                                        : "bg-gray-200 text-gray-500"
                                    }`}
                            >
                                {quizPassed ? <CheckCircle className="w-5 h-5" /> : "2"}
                            </div>
                            <span className="text-sm font-medium text-slate-700">Quiz</span>
                        </div>

                        <div className="flex-1 h-0.5 bg-gray-300" />

                        {/* Step 3: Acknowledgment */}
                        <div className="flex items-center gap-2">
                            <div
                                className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm ${currentStep === "acknowledgment"
                                    ? "bg-indigo-600 text-white"
                                    : "bg-gray-200 text-gray-500"
                                    }`}
                            >
                                3
                            </div>
                            <span className="text-sm font-medium text-slate-700">Acknowledgment</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-6xl mx-auto px-4 py-8">
                {currentStep === "lesson" && (
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                        <div className="prose prose-slate prose-lg max-w-none mb-8
                            prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900
                            prose-h1:!text-4xl prose-h1:!mb-8 prose-h1:!mt-0 prose-h1:pb-4 prose-h1:border-b prose-h1:border-slate-200
                            prose-h2:!text-2xl prose-h2:!mt-12 prose-h2:!mb-6
                            prose-h3:!text-xl prose-h3:!mt-8 prose-h3:!mb-4
                            prose-p:text-slate-600 prose-p:leading-relaxed prose-p:mb-6
                            prose-strong:text-slate-900 prose-strong:font-semibold
                            prose-code:text-indigo-600 prose-code:bg-indigo-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                            prose-pre:bg-slate-900 prose-pre:text-slate-50 prose-pre:rounded-xl prose-pre:p-6
                            prose-ul:my-6 prose-ul:space-y-2
                            prose-ol:my-6 prose-ol:space-y-2
                            prose-li:text-slate-600
                            prose-blockquote:border-l-indigo-500 prose-blockquote:bg-indigo-50 prose-blockquote:py-4 prose-blockquote:text-slate-700
                            prose-table:border-collapse prose-table:w-full
                            prose-th:bg-slate-50 prose-th:border prose-th:border-slate-200 prose-th:p-3 prose-th:text-slate-900
                            prose-td:border prose-td:border-slate-200 prose-td:p-3 prose-td:text-slate-600
                            prose-img:rounded-xl prose-img:shadow-lg">
                            <ReactMarkdown
                                remarkPlugins={[remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                            >
                                {assignment.course.lesson_notes}
                            </ReactMarkdown>
                        </div>

                        {/* Scroll indicator - simplified for now */}
                        <div className="border-t border-gray-200 pt-6">
                            <p className="text-sm text-slate-600 mb-4">
                                Please review all the lesson content above before proceeding to the quiz.
                            </p>
                            <button
                                onClick={handleLessonComplete}
                                className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                            >
                                I&apos;ve Reviewed the Lesson - Continue to Quiz
                            </button>
                        </div>
                    </div>
                )}

                {currentStep === "quiz" && (
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                        <h2 className="text-2xl font-bold text-slate-900 mb-6">Knowledge Check</h2>
                        <p className="text-slate-600 mb-8">
                            Answer the following questions to demonstrate your understanding. You need 80% to pass.
                        </p>

                        {/* Quiz component will go here - simplified for now */}
                        <div className="space-y-6">
                            {assignment.course.quiz_questions?.map((q: any, idx: number) => (
                                <div key={q.id} className="border border-gray-200 rounded-lg p-4">
                                    <p className="font-medium text-slate-900 mb-3">
                                        {idx + 1}. {q.question_text}
                                    </p>
                                    <div className="space-y-2">
                                        {Array.isArray(q.options) && q.options.map((option: any, optIdx: number) => {
                                            const optionText = typeof option === 'object' ? option?.text || '' : option;
                                            const optionValue = typeof option === 'object' ? option?.text || '' : option;

                                            return (
                                                <label key={optIdx} className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name={`question-${q.id}`}
                                                        value={optionValue}
                                                        checked={quizAnswers[q.id] === optionValue}
                                                        onChange={(e) => setQuizAnswers({ ...quizAnswers, [q.id]: e.target.value })}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-slate-700">{optionText}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-8 flex gap-4">
                            <button
                                onClick={() => setCurrentStep("lesson")}
                                className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                            >
                                Back to Lesson
                            </button>
                            <button
                                onClick={handleQuizSubmit}
                                className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                            >
                                Submit Quiz
                            </button>
                        </div>
                    </div>
                )}

                {currentStep === "acknowledgment" && (
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-8 flex items-start gap-3">
                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <h3 className="text-lg font-semibold text-green-900">Congratulations! You passed!</h3>
                                <p className="text-green-700">
                                    You scored {quizScore}%. Please complete the final step below to finish this training.
                                </p>
                            </div>
                        </div>

                        <h2 className="text-2xl font-bold text-slate-900 mb-6">Training Acknowledgment</h2>
                        <p className="text-slate-600 mb-8">
                            Please acknowledge that you have completed this training and understand the material.
                        </p>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Your Name
                                </label>
                                <input
                                    type="text"
                                    readOnly
                                    value="Worker Name"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
                                />
                            </div>

                            <div>
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={acknowledged}
                                        onChange={(e) => setAcknowledged(e.target.checked)}
                                        className="mt-1 w-5 h-5"
                                    />
                                    <span className="text-sm text-slate-700">
                                        I acknowledge that I have completed this training and understand the material covered.
                                        I will apply this knowledge in my work.
                                    </span>
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Digital Signature (Type your full name)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Type your full name"
                                    value={signature}
                                    onChange={(e) => setSignature(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                />
                            </div>
                        </div>

                        <div className="mt-8 flex gap-4">
                            <button
                                onClick={() => setCurrentStep("quiz")}
                                className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                            >
                                Back to Quiz
                            </button>
                            <button
                                onClick={handleAcknowledgmentComplete}
                                disabled={submitting}
                                className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-5 h-5" />
                                        Submit Training
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
