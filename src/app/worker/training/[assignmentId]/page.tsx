"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, BookOpen, ClipboardCheck, ArrowLeft, X, ChevronRight, ChevronLeft, GraduationCap } from "lucide-react";
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

    // Slides View State
    const [slides, setSlides] = useState<string[]>([]);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isSlideView, setIsSlideView] = useState(false);

    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const assignmentId = params.assignmentId as string;
    const contentRef = useRef<HTMLDivElement>(null);

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
            delivery_format,
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

            // Initialize Slides if applicable
            // Handle course as single object (Supabase returns it as array in types but single object in reality)
            const course = Array.isArray(data.course) ? data.course[0] : data.course;
            if (course?.delivery_format === 'slides' && course?.lesson_notes) {
                // Split by horizontal rule '---'
                const rawSlides = course.lesson_notes.split(/^---$/m).map((s: string) => s.trim()).filter(Boolean);
                if (rawSlides.length > 0) {
                    setSlides(rawSlides);
                    setIsSlideView(true);
                }
            }

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

    const nextSlide = () => {
        if (currentSlide < slides.length - 1) {
            setCurrentSlide(curr => curr + 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const prevSlide = () => {
        if (currentSlide > 0) {
            setCurrentSlide(curr => curr - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Scroll to top when step changes
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [currentStep]);

    const handleQuizSubmit = async () => {
        const questions = assignment.course.quiz_questions;

        // Validate all questions answered
        if (Object.keys(quizAnswers).length < questions.length) {
            alert("Please answer all questions before submitting.");
            return;
        }

        // Calculate score and build answers array
        let correct = 0;
        const answersData = questions.map((q: any) => {
            const isCorrect = quizAnswers[q.id] === q.correct_answer;
            if (isCorrect) correct++;

            return {
                questionId: q.id,
                questionText: q.question_text,
                selectedOption: quizAnswers[q.id],
                correctAnswer: q.correct_answer,
                isCorrect
            };
        });

        const score = Math.round((correct / questions.length) * 100);
        setQuizScore(score);

        const passed = score >= 80;

        // Save quiz attempt to database
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
            }
        } catch (err) {
            console.error("Failed to save quiz attempt:", err);
            // Continue even if logging fails
        }

        if (passed) {
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
                <div className="text-slate-600 animate-pulse">Loading training content...</div>
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
        <div className="min-h-screen bg-slate-50 font-sans">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <div className="max-w-5xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleExit}
                                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-700"
                                title="Exit training"
                            >
                                <X className="w-5 h-5" />
                            </button>
                            <div>
                                <h1 className="text-lg font-bold text-slate-900 leading-tight">{assignment.course.title}</h1>
                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                    <span className="flex items-center gap-1">
                                        <BookOpen className="w-3 h-3" />
                                        {isSlideView ? "Interactive Slides" : "Standard Reading"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Progress Steps */}
                        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                            {/* Step 1: Lesson */}
                            <div
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentStep === "lesson"
                                    ? "bg-white text-indigo-600 shadow-sm"
                                    : lessonViewed
                                        ? "text-green-600"
                                        : "text-slate-500"
                                    }`}
                            >
                                {lessonViewed ? <CheckCircle className="w-4 h-4" /> : <span>1</span>}
                                <span className="hidden sm:inline">Lesson</span>
                            </div>

                            {/* Step 2: Quiz */}
                            <div
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentStep === "quiz"
                                    ? "bg-white text-indigo-600 shadow-sm"
                                    : quizPassed
                                        ? "text-green-600"
                                        : "text-slate-500"
                                    }`}
                            >
                                {quizPassed ? <CheckCircle className="w-4 h-4" /> : <span>2</span>}
                                <span className="hidden sm:inline">Quiz</span>
                            </div>

                            {/* Step 3: Acknowledgment */}
                            <div
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentStep === "acknowledgment"
                                    ? "bg-white text-indigo-600 shadow-sm"
                                    : "text-slate-500"
                                    }`}
                            >
                                <span>3</span>
                                <span className="hidden sm:inline">Finish</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="max-w-4xl mx-auto px-4 py-8">
                {currentStep === "lesson" && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {isSlideView ? (
                            /* SLIDES VIEW */
                            <div className="flex flex-col gap-6">
                                {/* Progress Bar */}
                                <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
                                    <div
                                        className="bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out"
                                        style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
                                    />
                                </div>
                                <div className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                                    Slide {currentSlide + 1} of {slides.length}
                                </div>

                                {/* Slide Card */}
                                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12 min-h-[60vh] flex flex-col justify-center relative overflow-hidden">
                                    {/* Decorative background element */}
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 blur-3xl pointer-events-none" />

                                    <div className="prose prose-lg md:prose-xl max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-700 prose-li:text-slate-700 relative z-10">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                        >
                                            {slides[currentSlide]}
                                        </ReactMarkdown>
                                    </div>
                                </div>

                                {/* Navigation Controls */}
                                <div className="flex items-center justify-between gap-4 sticky bottom-6 z-20">
                                    <button
                                        onClick={prevSlide}
                                        disabled={currentSlide === 0}
                                        className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all
                                            disabled:opacity-0 disabled:pointer-events-none
                                            bg-white text-slate-700 shadow-md hover:shadow-lg hover:bg-gray-50 border border-gray-200"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                        Previous
                                    </button>

                                    {currentSlide === slides.length - 1 ? (
                                        <button
                                            onClick={handleLessonComplete}
                                            className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                                        >
                                            Complete Lesson
                                            <CheckCircle className="w-5 h-5" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={nextSlide}
                                            className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                                        >
                                            Next Slide
                                            <ChevronRight className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* STANDARD READER VIEW */
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 md:p-12 max-w-[65ch] mx-auto">
                                <div className="prose prose-lg prose-slate max-w-none
                                    prose-headings:font-display prose-headings:font-bold prose-headings:tracking-tight
                                    prose-h1:text-4xl prose-h1:mb-8 prose-h1:pb-4 prose-h1:border-b prose-h1:border-slate-100
                                    prose-p:leading-relaxed prose-p:text-slate-600
                                    prose-strong:text-slate-900 prose-strong:font-semibold
                                    prose-blockquote:border-l-4 prose-blockquote:border-indigo-500 prose-blockquote:bg-indigo-50/50 prose-blockquote:py-4 prose-blockquote:px-6 prose-blockquote:rounded-r-lg prose-blockquote:not-italic
                                    prose-code:text-indigo-600 prose-code:bg-indigo-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                                    prose-img:rounded-xl prose-img:shadow-md">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                    >
                                        {assignment.course.lesson_notes}
                                    </ReactMarkdown>
                                </div>

                                <div className="mt-12 pt-8 border-t border-gray-100 flex justify-center">
                                    <button
                                        onClick={handleLessonComplete}
                                        className="px-8 py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center gap-2"
                                    >
                                        <CheckCircle className="w-5 h-5" />
                                        I&apos;ve Completed the Reading
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {currentStep === "quiz" && (
                    <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                            <div className="bg-indigo-600 px-8 py-6 text-white">
                                <h2 className="text-2xl font-bold flex items-center gap-2">
                                    <GraduationCap className="w-8 h-8" />
                                    Knowledge Check
                                </h2>
                                <p className="text-indigo-100 mt-2 opacity-90">
                                    Answer the following questions to demonstrate your understanding. Pass mark is 80%.
                                </p>
                            </div>

                            <div className="p-8">
                                <div className="space-y-8">
                                    {assignment.course.quiz_questions?.map((q: any, idx: number) => (
                                        <div key={q.id} className="p-6 bg-slate-50 rounded-xl border border-slate-200 hover:border-indigo-200 transition-colors">
                                            <p className="font-semibold text-lg text-slate-900 mb-4 flex gap-3">
                                                <span className="flex-shrink-0 w-8 h-8 bg-white border border-slate-200 rounded-full flex items-center justify-center text-sm text-slate-500 shadow-sm">
                                                    {idx + 1}
                                                </span>
                                                {q.question_text}
                                            </p>
                                            <div className="space-y-3 pl-11">
                                                {Array.isArray(q.options) && q.options.map((option: any, optIdx: number) => {
                                                    const optionText = typeof option === 'object' ? option?.text || '' : option;
                                                    const optionValue = typeof option === 'object' ? option?.text || '' : option;
                                                    const isSelected = quizAnswers[q.id] === optionValue;

                                                    return (
                                                        <label
                                                            key={optIdx}
                                                            className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer border transition-all ${isSelected
                                                                ? "bg-indigo-50 border-indigo-500 shadow-sm"
                                                                : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                                                                }`}
                                                        >
                                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${isSelected ? "border-indigo-600 bg-indigo-600" : "border-gray-300 bg-white"
                                                                }`}>
                                                                {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                                                            </div>
                                                            <input
                                                                type="radio"
                                                                name={`question-${q.id}`}
                                                                value={optionValue}
                                                                checked={isSelected}
                                                                onChange={(e) => setQuizAnswers({ ...quizAnswers, [q.id]: e.target.value })}
                                                                className="hidden"
                                                            />
                                                            <span className={`text-base ${isSelected ? "text-indigo-900 font-medium" : "text-slate-700"}`}>
                                                                {optionText}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-10 flex gap-4 pt-6 border-t border-gray-100">
                                    <button
                                        onClick={() => setCurrentStep("lesson")}
                                        className="px-6 py-3 border border-gray-300 text-slate-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                                    >
                                        Back to Lesson
                                    </button>
                                    <button
                                        onClick={handleQuizSubmit}
                                        className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                                    >
                                        Submit Quiz
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {currentStep === "acknowledgment" && (
                    <div className="max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 md:p-10 text-center">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>

                            <h3 className="text-3xl font-bold text-slate-900 mb-2">Congratulations!</h3>
                            <p className="text-lg text-slate-600 mb-8">
                                You passed with a score of <span className="font-bold text-green-600">{quizScore}%</span>
                            </p>

                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-left mb-8">
                                <h4 className="font-semibold text-slate-900 mb-4">Final Step: Acknowledgment</h4>
                                <div className="space-y-6">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <div className="mt-1 relative">
                                            <input
                                                type="checkbox"
                                                checked={acknowledged}
                                                onChange={(e) => setAcknowledged(e.target.checked)}
                                                className="peer sr-only"
                                            />
                                            <div className="w-5 h-5 border-2 border-gray-300 rounded peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-colors" />
                                            <CheckCircle className="w-3.5 h-3.5 text-white absolute top-1 left-1 opacity-0 peer-checked:opacity-100 transition-opacity" />
                                        </div>
                                        <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors leading-relaxed">
                                            I acknowledge that I have completed this training and understand the material covered.
                                            I will apply this knowledge in my work to the best of my ability.
                                        </span>
                                    </label>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-2">
                                            Digital Signature (Type your full name)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g., John Doe"
                                            value={signature}
                                            onChange={(e) => setSignature(e.target.value)}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={() => setCurrentStep("quiz")}
                                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={handleAcknowledgmentComplete}
                                    disabled={submitting}
                                    className="flex-1 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-200"
                                >
                                    {submitting ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Submitting...
                                        </>
                                    ) : (
                                        <>
                                            Complete Training
                                            <CheckCircle className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
