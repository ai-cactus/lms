"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, AlertCircle, Plus, Trash2, ArrowRight, ArrowLeft } from "lucide-react";
import type { Course, CourseObjective, CARFStandard } from "@/types/database";

export default function CourseReviewPage() {
    const [course, setCourse] = useState<Course | null>(null);
    const [objectives, setObjectives] = useState<CourseObjective[]>([]);
    const [lessonNotes, setLessonNotes] = useState("");
    const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
    const [currentStep, setCurrentStep] = useState(1);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const courseId = params.id as string;

    useEffect(() => {
        loadCourse();
    }, [courseId]);

    const loadCourse = async () => {
        try {
            const { data: courseData, error: courseError } = await supabase
                .from("courses")
                .select("*")
                .eq("id", courseId)
                .single();

            if (courseError) throw courseError;

            setCourse(courseData);
            setObjectives(courseData.objectives || []);
            setLessonNotes(courseData.lesson_notes || "");

            // Load quiz questions
            const { data: questionsData, error: questionsError } = await supabase
                .from("quiz_questions")
                .select("*")
                .eq("course_id", courseId);

            if (questionsError) throw questionsError;
            setQuizQuestions(questionsData || []);

            setLoading(false);
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    const handleSaveObjectives = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from("courses")
                .update({ objectives })
                .eq("id", courseId);

            if (error) throw error;
            setCurrentStep(2);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveLessonNotes = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from("courses")
                .update({ lesson_notes: lessonNotes })
                .eq("id", courseId);

            if (error) throw error;
            setCurrentStep(3);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveQuizQuestions = async () => {
        setSaving(true);
        try {
            // Delete existing questions
            await supabase.from("quiz_questions").delete().eq("course_id", courseId);

            // Insert updated questions
            const { error } = await supabase
                .from("quiz_questions")
                .insert(quizQuestions.map(q => ({ ...q, course_id: courseId })));

            if (error) throw error;
            setCurrentStep(4);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handlePublish = async () => {
        setSaving(true);
        try {
            const isRepublish = course?.published_at !== null;

            const { error } = await supabase
                .from("courses")
                .update({ published_at: new Date().toISOString() })
                .eq("id", courseId);

            if (error) throw error;

            // Redirect based on whether this is a republish or initial publish
            if (isRepublish) {
                router.push("/admin/courses?updated=true");
            } else {
                router.push(`/admin/courses/${courseId}/published`);
            }
        } catch (err: any) {
            setError(err.message);
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-slate-600">Loading course...</div>
            </div>
        );
    }

    if (!course) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-red-600">Course not found</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        {course.published_at ? "Edit Course" : "Review Course Draft"}
                    </h1>
                    <p className="text-slate-600">
                        {course.published_at
                            ? "Edit and republish this course. Changes will be reflected in all active assignments."
                            : "Review and edit the AI-generated course content"}
                    </p>
                </div>

                {/* Progress Steps */}
                <div className="mb-8 flex items-center justify-between">
                    {["Objectives", "Lesson Notes", "Quiz Questions", "Configuration", "Publish"].map((step, index) => (
                        <div key={step} className="flex items-center">
                            <div
                                className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold ${index + 1 < currentStep
                                    ? "bg-green-100 text-green-600"
                                    : index + 1 === currentStep
                                        ? "bg-indigo-600 text-white"
                                        : "bg-gray-200 text-gray-500"
                                    }`}
                            >
                                {index + 1 < currentStep ? <CheckCircle className="w-5 h-5" /> : index + 1}
                            </div>
                            <span className={`ml-2 text-sm font-medium ${index + 1 <= currentStep ? "text-slate-900" : "text-slate-500"
                                }`}>
                                {step}
                            </span>
                            {index < 4 && (
                                <div className={`w-16 h-0.5 mx-4 ${index + 1 < currentStep ? "bg-green-600" : "bg-gray-300"
                                    }`} />
                            )}
                        </div>
                    ))}
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                {/* Step Content */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    {currentStep === 1 && (
                        <ObjectivesReview
                            objectives={objectives}
                            setObjectives={setObjectives}
                            onNext={handleSaveObjectives}
                            saving={saving}
                        />
                    )}

                    {currentStep === 2 && (
                        <LessonNotesReview
                            lessonNotes={lessonNotes}
                            setLessonNotes={setLessonNotes}
                            onNext={handleSaveLessonNotes}
                            onBack={() => setCurrentStep(1)}
                            saving={saving}
                        />
                    )}

                    {currentStep === 3 && (
                        <QuizQuestionsReview
                            questions={quizQuestions}
                            setQuestions={setQuizQuestions}
                            objectives={objectives}
                            onNext={handleSaveQuizQuestions}
                            onBack={() => setCurrentStep(2)}
                            saving={saving}
                        />
                    )}

                    {currentStep === 4 && (
                        <CourseConfiguration
                            course={course}
                            setCourse={setCourse}
                            quizQuestions={quizQuestions}
                            onNext={async () => {
                                setSaving(true);
                                try {
                                    const { error } = await supabase
                                        .from("courses")
                                        .update({
                                            course_type: course?.course_type,
                                            policy_version: course?.policy_version,
                                            provider_name: course?.provider_name,
                                            reference_id: course?.reference_id,
                                            deadline_days: course?.deadline_days,
                                            max_attempts: course?.max_attempts,
                                            delivery_format: course?.delivery_format,
                                            quiz_config: course?.quiz_config,
                                        })
                                        .eq("id", courseId);
                                    if (error) throw error;
                                    setCurrentStep(5);
                                } catch (err: any) {
                                    setError(err.message);
                                } finally {
                                    setSaving(false);
                                }
                            }}
                            onBack={() => setCurrentStep(3)}
                            saving={saving}
                        />
                    )}

                    {currentStep === 5 && (
                        <PublishConfirmation
                            course={course}
                            objectives={objectives}
                            questionCount={quizQuestions.length}
                            onPublish={handlePublish}
                            onBack={() => setCurrentStep(4)}
                            saving={saving}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// Course Configuration Component
function CourseConfiguration({ course, setCourse, quizQuestions, onNext, onBack, saving }: any) {
    const updateCourse = (field: string, value: any) => {
        setCourse({ ...course, [field]: value });
    };

    const updateQuizConfig = (field: string, value: any) => {
        setCourse({
            ...course,
            quiz_config: { ...course.quiz_config, [field]: value }
        });
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Course Configuration</h2>
            <p className="text-slate-600 mb-6">
                Configure settings for course delivery, deadlines, and quiz behavior.
            </p>

            <div className="space-y-6 mb-8">
                {/* Course Type */}
                <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold text-slate-900 mb-3">Course Type</h3>
                    <div className="space-y-2">
                        {[
                            { id: "policy", label: "Policy-Derived Course", desc: "Generated from uploaded policy" },
                            { id: "standard", label: "Standard Training", desc: "General compliance or skills training" },
                            { id: "external", label: "External / Imported", desc: "Uploaded SCORM/PDF or external vendor" },
                        ].map((type) => (
                            <label key={type.id} className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                                <input
                                    type="radio"
                                    name="course_type"
                                    checked={course.course_type === type.id}
                                    onChange={() => updateCourse("course_type", type.id)}
                                    className="mt-1"
                                />
                                <div>
                                    <div className="font-medium text-slate-900">{type.label}</div>
                                    <div className="text-sm text-slate-500">{type.desc}</div>
                                </div>
                            </label>
                        ))}
                    </div>
                    <p className="text-sm text-slate-500 mt-3">
                        Course type helps us group trainings correctly for CARF reports and learning analytics.
                    </p>
                </div>

                {/* Conditional Fields Based on Course Type */}
                {course.course_type === 'policy' && (
                    <div className="p-4 border border-gray-200 rounded-lg">
                        <h3 className="font-semibold text-slate-900 mb-3">Policy Information</h3>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Policy Version
                            </label>
                            <input
                                type="text"
                                value={course.policy_version || ""}
                                onChange={(e) => updateCourse("policy_version", e.target.value)}
                                placeholder="e.g., v2.1, 2024-Q1"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                )}

                {course.course_type === 'external' && (
                    <div className="p-4 border border-gray-200 rounded-lg">
                        <h3 className="font-semibold text-slate-900 mb-3">External Course Details</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Provider Name
                                </label>
                                <input
                                    type="text"
                                    value={course.provider_name || ""}
                                    onChange={(e) => updateCourse("provider_name", e.target.value)}
                                    placeholder="e.g., RELIAS, SafetySkills"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Reference ID / Link
                                </label>
                                <input
                                    type="text"
                                    value={course.reference_id || ""}
                                    onChange={(e) => updateCourse("reference_id", e.target.value)}
                                    placeholder="Course ID or URL"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Deadlines & Retakes */}
                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Deadline (Days after assignment)
                        </label>
                        <select
                            value={course.deadline_days && ![7, 14, 30, 60, 90].includes(course.deadline_days) ? 'custom' : course.deadline_days || 14}
                            onChange={(e) => {
                                if (e.target.value === 'custom') {
                                    updateCourse("deadline_days", 45); // Default custom value
                                } else {
                                    updateCourse("deadline_days", parseInt(e.target.value));
                                }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value={7}>7 days</option>
                            <option value={14}>14 days (Default)</option>
                            <option value={30}>30 days</option>
                            <option value={60}>60 days</option>
                            <option value={90}>90 days</option>
                            <option value="custom">Custom</option>
                        </select>
                        {course.deadline_days && ![7, 14, 30, 60, 90].includes(course.deadline_days) && (
                            <div className="mt-2">
                                <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={course.deadline_days}
                                    onChange={(e) => updateCourse("deadline_days", parseInt(e.target.value))}
                                    placeholder="Enter number of days"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">Enter custom number of days (1-365)</p>
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Max Attempts
                        </label>
                        <select
                            value={course.max_attempts || 2}
                            onChange={(e) => updateCourse("max_attempts", parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value={1}>1 Attempt</option>
                            <option value={2}>2 Attempts (Default)</option>
                            <option value={3}>3 Attempts</option>
                            <option value={5}>5 Attempts</option>
                            <option value={999}>Unlimited</option>
                        </select>
                    </div>
                </div>

                {/* Delivery Format */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                        Delivery Format
                    </label>
                    <div className="flex gap-4">
                        <label className={`flex-1 p-4 border rounded-lg cursor-pointer transition-colors ${course.delivery_format === 'pages' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                            <input
                                type="radio"
                                name="delivery_format"
                                value="pages"
                                checked={course.delivery_format === 'pages' || !course.delivery_format}
                                onChange={() => updateCourse("delivery_format", "pages")}
                                className="sr-only"
                            />
                            <div className="font-medium text-slate-900 mb-1">Pages View</div>
                            <div className="text-sm text-slate-500">Continuous scrolling text (Standard)</div>
                        </label>
                        <label className={`flex-1 p-4 border rounded-lg cursor-pointer transition-colors ${course.delivery_format === 'slides' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                            <input
                                type="radio"
                                name="delivery_format"
                                value="slides"
                                checked={course.delivery_format === 'slides'}
                                onChange={() => updateCourse("delivery_format", "slides")}
                                className="sr-only"
                            />
                            <div className="font-medium text-slate-900 mb-1">Slides View</div>
                            <div className="text-sm text-slate-500">Content split into slide-like chunks</div>
                        </label>
                    </div>
                    <p className="text-sm text-slate-500 mt-2">
                        Slides View presents content one screen at a time. Pages View is continuous text.
                    </p>
                </div>

                {/* Quiz Configuration */}
                <div className="p-4 bg-slate-50 rounded-lg">
                    <h3 className="font-semibold text-slate-900 mb-3">Quiz Settings</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Questions per Attempt
                            </label>
                            <input
                                type="number"
                                min={3}
                                max={20}
                                value={course.quiz_config?.questions_per_attempt || 5}
                                onChange={(e) => updateQuizConfig("questions_per_attempt", parseInt(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            {course.quiz_config?.questions_per_attempt > quizQuestions.length && (
                                <p className="text-sm text-red-600 mt-1">
                                    You have {quizQuestions.length} question{quizQuestions.length !== 1 ? 's' : ''} in the bank. Reduce number of questions per attempt or add more questions.
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Feedback Timing
                            </label>
                            <select
                                value={course.quiz_config?.feedback_timing || "end"}
                                onChange={(e) => updateQuizConfig("feedback_timing", e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="end">At end of quiz</option>
                                <option value="immediate">After each question</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Question Order
                            </label>
                            <select
                                value={course.quiz_config?.question_order || "randomized"}
                                onChange={(e) => updateQuizConfig("question_order", e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="randomized">Randomized (Default)</option>
                                <option value="fixed">Fixed Order</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex gap-3">
                <button
                    onClick={onBack}
                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={onNext}
                    disabled={saving}
                    className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? "Saving..." : "Next: Review & Publish"}
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

// Objectives Review Component
function ObjectivesReview({ objectives, setObjectives, onNext, saving }: any) {
    const addObjective = () => {
        setObjectives([
            ...objectives,
            { id: `obj-${Date.now()}`, text: "", carf_matched: false, carf_standard: null },
        ]);
    };

    const updateObjective = (index: number, field: string, value: any) => {
        const updated = [...objectives];
        updated[index] = { ...updated[index], [field]: value };
        setObjectives(updated);
    };

    const removeObjective = (index: number) => {
        setObjectives(objectives.filter((_: any, i: number) => i !== index));
    };

    const hasValidObjectives = objectives.some((obj: any) => obj.text.trim());

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Course Objectives</h2>
            <p className="text-slate-600 mb-6">
                Review AI-suggested objectives mapped to CARF standards. You can edit, add, or remove objectives.
            </p>

            <div className="space-y-4 mb-6">
                {objectives.map((obj: any, index: number) => (
                    <div key={obj.id || index} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-start gap-3">
                            <div className="flex-1">
                                <textarea
                                    value={obj.text}
                                    onChange={(e) => updateObjective(index, "text", e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                                    rows={2}
                                    placeholder="Enter learning objective..."
                                />
                                {obj.carf_standard && (
                                    <div className="mt-2 flex items-center gap-2">
                                        {obj.carf_matched ? (
                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                        ) : (
                                            <AlertCircle className="w-4 h-4 text-yellow-600" />
                                        )}
                                        <span className="text-sm text-slate-600">{obj.carf_standard}</span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => removeObjective(index)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={addObjective}
                className="mb-6 px-4 py-2 text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors flex items-center gap-2"
            >
                <Plus className="w-4 h-4" />
                Add Custom Objective
            </button>

            <button
                onClick={onNext}
                disabled={!hasValidObjectives || saving}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
                {saving ? "Saving..." : "Next: Lesson Notes"}
                <ArrowRight className="w-5 h-5" />
            </button>
        </div>
    );
}

// Lesson Notes Review Component
function LessonNotesReview({ lessonNotes, setLessonNotes, onNext, onBack, saving }: any) {
    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Lesson Notes</h2>
            <p className="text-slate-600 mb-6">
                Edit the training content. This will be displayed to workers during the course.
            </p>

            <textarea
                value={lessonNotes}
                onChange={(e) => setLessonNotes(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none font-mono text-sm"
                rows={20}
                placeholder="Enter lesson content in markdown format..."
            />

            <div className="mt-6 flex gap-3">
                <button
                    onClick={onBack}
                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={onNext}
                    disabled={!lessonNotes.trim() || saving}
                    className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? "Saving..." : "Next: Quiz Questions"}
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

// Quiz Questions Review Component
function QuizQuestionsReview({ questions, setQuestions, objectives, onNext, onBack, saving }: any) {
    const addQuestion = () => {
        setQuestions([
            ...questions,
            {
                id: `q-${Date.now()}`,
                question_text: "",
                question_type: "multiple_choice",
                options: [
                    { id: "opt-0", text: "" },
                    { id: "opt-1", text: "" },
                    { id: "opt-2", text: "" },
                    { id: "opt-3", text: "" },
                ],
                correct_answer: "",
                objective_id: "",
            },
        ]);
    };

    const updateQuestion = (index: number, field: string, value: any) => {
        const updated = [...questions];
        updated[index] = { ...updated[index], [field]: value };
        setQuestions(updated);
    };

    const updateOption = (qIndex: number, optIndex: number, value: string) => {
        const updated = [...questions];
        updated[qIndex].options[optIndex].text = value;
        setQuestions(updated);
    };

    const removeQuestion = (index: number) => {
        if (questions.length > 3) {
            setQuestions(questions.filter((_: any, i: number) => i !== index));
        }
    };

    const hasValidQuestions = questions.length >= 3 && questions.every((q: any) =>
        q.question_text.trim() &&
        q.options.every((opt: any) => opt.text.trim()) &&
        q.correct_answer
    );

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Quiz Questions</h2>
            <p className="text-slate-600 mb-6">
                Edit quiz questions. Minimum 3 questions required. Map each question to a learning objective.
            </p>

            <div className="space-y-6 mb-6">
                {questions.map((q: any, qIndex: number) => (
                    <div key={q.id || qIndex} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-start justify-between mb-3">
                            <span className="font-semibold text-slate-900">Question {qIndex + 1}</span>
                            {questions.length > 3 && (
                                <button
                                    onClick={() => removeQuestion(qIndex)}
                                    className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        <div className="mb-3">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Learning Objective
                            </label>
                            <select
                                value={q.objective_id || ""}
                                onChange={(e) => updateQuestion(qIndex, "objective_id", e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                            >
                                <option value="">Select an objective...</option>
                                {objectives?.map((obj: any) => (
                                    <option key={obj.id} value={obj.id}>
                                        {obj.text.length > 100 ? obj.text.substring(0, 100) + "..." : obj.text}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <input
                            type="text"
                            value={q.question_text}
                            onChange={(e) => updateQuestion(qIndex, "question_text", e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none mb-3"
                            placeholder="Enter question..."
                        />

                        <div className="space-y-2">
                            {q.options.map((opt: any, optIndex: number) => (
                                <div key={opt.id} className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name={`correct-${qIndex}`}
                                        checked={q.correct_answer === opt.text}
                                        onChange={() => updateQuestion(qIndex, "correct_answer", opt.text)}
                                        className="w-4 h-4 text-indigo-600"
                                    />
                                    <input
                                        type="text"
                                        value={opt.text}
                                        onChange={(e) => updateOption(qIndex, optIndex, e.target.value)}
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                        placeholder={`Option ${String.fromCharCode(65 + optIndex)}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={addQuestion}
                className="mb-6 px-4 py-2 text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors flex items-center gap-2"
            >
                <Plus className="w-4 h-4" />
                Add Question
            </button>

            <div className="flex gap-3">
                <button
                    onClick={onBack}
                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={onNext}
                    disabled={!hasValidQuestions || saving}
                    className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? "Saving..." : "Next: Publish"}
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

// Publish Confirmation Component
function PublishConfirmation({ course, objectives, questionCount, onPublish, onBack, saving }: any) {
    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Confirm Course Details</h2>
            <p className="text-slate-600 mb-6">
                Review the final course details before publishing.
            </p>

            <div className="space-y-4 mb-8">
                <div className="p-4 bg-slate-50 rounded-lg">
                    <h3 className="font-semibold text-slate-900 mb-2">Course Title</h3>
                    <p className="text-slate-700">{course.title}</p>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg">
                    <h3 className="font-semibold text-slate-900 mb-2">Learning Objectives</h3>
                    <ul className="list-disc list-inside space-y-1">
                        {objectives.map((obj: any, index: number) => (
                            <li key={index} className="text-slate-700">{obj.text}</li>
                        ))}
                    </ul>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <h3 className="font-semibold text-slate-900 mb-1">Quiz Questions</h3>
                        <p className="text-2xl font-bold text-indigo-600">{questionCount}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <h3 className="font-semibold text-slate-900 mb-1">Pass Mark</h3>
                        <p className="text-2xl font-bold text-indigo-600">{course.pass_mark}%</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <h3 className="font-semibold text-slate-900 mb-1">Attempts Allowed</h3>
                        <p className="text-2xl font-bold text-indigo-600">{course.attempts_allowed}</p>
                    </div>
                </div>
            </div>

            <div className="flex gap-3">
                <button
                    onClick={onBack}
                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={onPublish}
                    disabled={saving}
                    className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? "Publishing..." : "Publish Course"}
                    <CheckCircle className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
