"use client";

import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    CheckCircle,
    ArrowLeft,
    X,
    Share2,
    Clock,
    HelpCircle,
    Check
} from "lucide-react";
import { CircularProgress } from "@/components/circular-progress";

export default function QuizPage({ params }: { params: Promise<{ assignmentId: string }> }) {
    const { assignmentId } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const supabase = createClient();

    const [loading, setLoading] = useState(true);
    const [assignment, setAssignment] = useState<any>(null);
    const [currentStep, setCurrentStep] = useState<"quiz" | "results">("quiz");
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, any>>({});
    const [quizSubmitted, setQuizSubmitted] = useState(false);
    const [quizScore, setQuizScore] = useState<number | null>(null);
    const [quizPassed, setQuizPassed] = useState(false);
    const [showReview, setShowReview] = useState(false);
    const [workerName, setWorkerName] = useState("");
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        loadAssignment();
    }, [assignmentId, token]);





    // Timer Logic
    useEffect(() => {
        if (timeLeft === null || currentStep !== "quiz" || quizSubmitted) return;

        if (timeLeft === 0) {
            handleQuizSubmit();
            return;
        }

        const timer = setInterval(() => {
            setTimeLeft((prev) => (prev !== null ? prev - 1 : null));
        }, 1000);

        return () => clearInterval(timer);
    }, [timeLeft, currentStep, quizSubmitted]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const setupQuizFromValidatedAssignment = async (assignmentData: any) => {
        try {
            const course = assignmentData.course;
            
            // Fetch questions separately from quiz_questions table
            const { data: questionsData, error: questionsError } = await supabase
                .from("quiz_questions")
                .select("*")
                .eq("course_id", course.id);

            if (questionsError) {
                console.error("Error fetching questions:", questionsError.message, questionsError);
            }

            const questions = questionsData || [];

            // Determine difficulty from objectives or default to Beginner
            const difficulty = (course.objectives as any)?.difficulty || "Beginner";

            let timePerQuestion = 60; // Default Beginner
            if (difficulty?.toLowerCase() === "moderate") timePerQuestion = 30;
            if (difficulty?.toLowerCase() === "advanced") timePerQuestion = 15;

            const totalTime = questions.length * timePerQuestion;

            // Combine data
            setAssignment({
                ...assignmentData,
                course: {
                    ...course,
                    quiz_questions: questions
                }
            });

            // Check if view=results is requested (for viewing previous results)
            const viewMode = searchParams.get('view');
            if (viewMode === 'results') {
                console.log("View=results requested, fetching previous results...");

                // Fetch latest attempt
                const { data: attempt, error: attemptError } = await supabase
                    .from('quiz_attempts')
                    .select('*')
                    .eq('assignment_id', assignmentId)
                    .order('completed_at', { ascending: false })
                    .limit(1)
                    .single();

                if (attempt) {
                    console.log("Found attempt:", attempt);
                    setQuizScore(attempt.score);
                    setQuizPassed(attempt.passed);
                    setQuizSubmitted(true);

                    // Fetch answers
                    const { data: answers, error: answersError } = await supabase
                        .from('quiz_answers')
                        .select('question_id, selected_option_text')
                        .eq('attempt_id', attempt.id);

                    if (answers) {
                        const answersMap: Record<string, any> = {};
                        answers.forEach((a: any) => {
                            answersMap[a.question_id] = a.selected_option_text;
                        });
                        setQuizAnswers(answersMap);
                    }

                    setCurrentStep("results");
                    setShowReview(true); // Show detailed results
                } else {
                    console.log("No attempt found for view=results");
                    // Start fresh quiz instead
                    setTimeLeft(totalTime);
                }
            } else {
                console.log("Starting fresh quiz with time:", totalTime);
                setTimeLeft(totalTime);
            }

            setLoading(false);
        } catch (error) {
            console.error("Error setting up quiz:", error);
            setLoading(false);
        }
    };

    const loadAssignment = async () => {
        try {
            // If we have a token, validate it first
            if (token) {
                const response = await fetch('/api/course/validate-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ token }),
                });
                
                const validation = await response.json();
                if (!validation.isValid) {
                    router.push("/login");
                    return;
                }
                
                // Verify the token matches this assignment
                if (validation.assignment?.id !== assignmentId) {
                    router.push("/login");
                    return;
                }
                
                // Use assignment data from token validation
                setWorkerName(validation.assignment.worker.full_name);
                
                // Continue with quiz setup using validated assignment
                await setupQuizFromValidatedAssignment(validation.assignment);
                return;
            }

            // Fallback: try to load with regular authentication
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get worker profile for name
            const { data: profile } = await supabase
                .from("users")
                .select("full_name")
                .eq("id", user.id)
                .single();

            if (profile) {
                setWorkerName(profile.full_name);
            }

            // Query to select assignment details
            const selectQuery = `
                id,
                course_id,
                status,
                course:courses(
                    id,
                    title,
                    objectives
                )
            `;

            const { data: assignmentData, error: assignmentError } = await supabase
                .from("course_assignments")
                .select(selectQuery)
                .eq("id", assignmentId)
                .single();

            if (assignmentError || !assignmentData) throw assignmentError || new Error("Assignment not found");

            const course = Array.isArray(assignmentData.course) ? assignmentData.course[0] : assignmentData.course;

            if (!course) throw new Error("Course not found");

            // Fetch questions separately from quiz_questions table
            const { data: questionsData, error: questionsError } = await supabase
                .from("quiz_questions")
                .select("*")
                .eq("course_id", course.id);

            if (questionsError) {
                console.error("Error fetching questions:", questionsError.message, questionsError);
            }

            const questions = questionsData || [];

            // Determine difficulty from objectives or default to Beginner
            const difficulty = (course.objectives as any)?.difficulty || "Beginner";

            let timePerQuestion = 60; // Default Beginner
            if (difficulty?.toLowerCase() === "moderate") timePerQuestion = 30;
            if (difficulty?.toLowerCase() === "advanced") timePerQuestion = 15;

            const totalTime = questions.length * timePerQuestion;

            // Combine data
            setAssignment({
                ...assignmentData,
                course: {
                    ...course,
                    quiz_questions: questions
                }
            });

            // Check if view=results is requested (for viewing previous results)
            const viewMode = searchParams.get('view');
            if (viewMode === 'results') {
                console.log("View=results requested, fetching previous results...");

                // Fetch latest attempt
                const { data: attempt, error: attemptError } = await supabase
                    .from('quiz_attempts')
                    .select('*')
                    .eq('assignment_id', assignmentId)
                    .order('completed_at', { ascending: false })
                    .limit(1)
                    .single();

                if (attempt) {
                    console.log("Found attempt:", attempt);
                    setQuizScore(attempt.score);
                    setQuizPassed(attempt.passed);
                    setQuizSubmitted(true);

                    // Fetch answers
                    const { data: answers, error: answersError } = await supabase
                        .from('quiz_answers')
                        .select('question_id, selected_option_text')
                        .eq('attempt_id', attempt.id);

                    if (answers) {
                        const answersMap: Record<string, any> = {};
                        answers.forEach((a: any) => {
                            answersMap[a.question_id] = a.selected_option_text;
                        });
                        setQuizAnswers(answersMap);
                    }

                    setCurrentStep("results");
                    setShowReview(true); // Show detailed results
                    setLoading(false);
                    return; // Stop here, don't set timer
                } else {
                    console.log("No attempt found for view=results");
                    // Start fresh quiz instead
                    setTimeLeft(totalTime);
                }
            }

            // Only set time left if not already set (to avoid reset on re-renders if any)
            // But here we are loading, so it's fresh.
            // Ideally we should check if there's a saved attempt with time left, but for now we start fresh.
            setTimeLeft(totalTime);
            setLoading(false);
        } catch (error) {
            console.error("Error loading assignment:", error);
            setLoading(false);
        }
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
        setShowReview(true); // Automatically show detailed results

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

                // ALWAYS record completion (attempt), even if failed
                await supabase
                    .from("course_completions")
                    .insert({
                        assignment_id: assignmentId,
                        worker_id: user.id,
                        course_id: assignment.course.id,
                        quiz_score: score,
                        completed_at: new Date().toISOString(),
                        quiz_answers: quizAnswers
                    });

                // Update assignment status based on pass/fail
                const newStatus = passed ? "completed" : "failed";

                const { error: updateError } = await supabase
                    .from("course_assignments")
                    .update({
                        status: newStatus,
                        progress_percentage: passed ? 100 : 100 // 100% done with the attempt, even if failed
                    })
                    .eq("id", assignmentId);

                if (updateError) {
                    console.error("Failed to update assignment status:", updateError);
                } else {
                    console.log(`Assignment status updated to ${newStatus}`);
                }

                // Notify admins
                try {
                    const { notifyAdminsAboutCourseEvent } = await import("@/app/actions/notifications");
                    await notifyAdminsAboutCourseEvent(
                        passed ? "course_passed" : "course_failed",
                        user.id,
                        workerName,
                        assignment.course.id,
                        assignment.course.title,
                        score
                    );
                } catch (notifError) {
                    console.error("Failed to send notification:", notifError);
                }
            }
        } catch (err) {
            console.error("Failed to save quiz attempt:", err);
        }
    };

    // Helper to safely get question text
    const getQuestionText = (text: any) => {
        if (typeof text === 'string') return text;
        if (typeof text === 'object' && text !== null) {
            // Handle rich text or other formats if needed
            return JSON.stringify(text);
        }
        return "Question Text";
    };

    // Helper to clean explanation text by removing module references
    const cleanExplanation = (explanation: string) => {
        return explanation
            .replace(/\b(module|Module)\b/g, '') // Remove standalone "module" words
            .replace(/\s+/g, ' ') // Clean up extra spaces
            .trim();
    };

    // Handle PDF export
    const handleExportPDF = async () => {
        setIsExporting(true);
        try {
            const response = await fetch(`/api/quiz/${assignmentId}/results-pdf`);

            if (!response.ok) {
                throw new Error('Failed to generate PDF');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `quiz-results-${assignment?.course?.title?.replace(/\s+/g, '-').toLowerCase() || 'course'}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting PDF:', error);
            alert('Failed to export quiz results. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading quiz...</div>
            </div>
        );
    }

    if (!assignment) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Assignment not found</div>
            </div>
        );
    }

    const questions = assignment.course.quiz_questions || [];
    const currentQuestion = questions[currentQuestionIndex];

    // Safety check for currentQuestion
    if (currentStep === "quiz" && !currentQuestion) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-slate-600">Loading quiz questions...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex flex-col">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
                {currentStep === "quiz" && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-slate-900">
                                Quiz: {assignment.course.title}
                            </h2>
                            <div className={`flex items-center gap-2 font-medium px-3 py-1.5 rounded-lg ${(timeLeft || 0) < 60 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                                }`}>
                                <Clock className="w-5 h-5" />
                                <span>{timeLeft !== null ? formatTime(timeLeft) : '--:--'}</span>
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
                                            disabled={!quizAnswers[currentQuestion.id]}
                                            className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                        >
                                            Next Question
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleQuizSubmit}
                                            disabled={!quizAnswers[currentQuestion.id]}
                                            className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
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
                                    You&apos;ve completed the course. We hope you&apos;ve learned something new about <span className="font-bold text-slate-900">{assignment.course.title}</span> today.
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
                                    <div className="bg-white p-4 rounded-xl flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                                                <HelpCircle className="w-4 h-4" />
                                            </div>
                                            <span className="font-medium text-slate-700">QUESTIONS ANSWERED</span>
                                        </div>
                                        <span className="font-bold text-slate-900">{questions.length}</span>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl flex items-center justify-between">
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
                                    <div className="bg-white p-4 rounded-xl flex items-center justify-between">
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
                                        onClick={() => {
                                            // Reset quiz state to allow retaking
                                            setCurrentStep("quiz");
                                            setQuizSubmitted(false);
                                            setQuizScore(null);
                                            setQuizPassed(false);
                                            setQuizAnswers({});
                                            setShowReview(false);
                                            setCurrentQuestionIndex(0);
                                            setTimeLeft(assignment?.course?.quiz_questions?.length ? assignment.course.quiz_questions.length * (assignment.course.objectives?.difficulty?.toLowerCase() === "moderate" ? 30 : assignment.course.objectives?.difficulty?.toLowerCase() === "advanced" ? 15 : 60) : null);
                                        }}
                                        className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg shadow-blue-200"
                                    >
                                        RETAKE QUIZ
                                        <ArrowLeft className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => router.push('/worker/dashboard?refresh=true')}
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
                                        <button className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-white">Share</button>
                                        <button
                                            onClick={handleExportPDF}
                                            disabled={isExporting}
                                            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isExporting ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full animate-spin"></div>
                                                    Exporting...
                                                </>
                                            ) : (
                                                'Export PDF'
                                            )}
                                        </button>
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
                                                    <p className="text-sm text-slate-700">
                                                        <span className="font-bold">Explanation:</span> {cleanExplanation(q.explanation || "No explanation available.")}
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
            </main>
        </div>
    );
}
