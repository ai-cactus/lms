"use client";

import { PlusCircle, Trash, X, PencilSimple } from "@phosphor-icons/react";
import { QuizConfig } from "@/types/course";
import { useState, useEffect } from "react";

interface Step6ReviewQuizProps {
    data: QuizConfig;
    onNext: () => void;
    onBack: () => void;
    courseContent?: string;
    courseDifficulty?: string;
    onQuestionsChange: (questions: QuizQuestion[]) => void;
}

interface QuizQuestion {
    id: string;
    questionText: string;
    options: string[];
    correctAnswer: number;
    isCustom?: boolean;
}

export function Step6ReviewQuiz({ data, onNext, onBack, courseContent, courseDifficulty, onQuestionsChange }: Step6ReviewQuizProps) {
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [customQuestions, setCustomQuestions] = useState<QuizQuestion[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null>(null);

    // Form state for adding/editing questions
    const [newQuestion, setNewQuestion] = useState({
        questionText: "",
        options: ["", "", "", ""],
        correctAnswer: 0
    });

    // Update parent whenever questions change
    useEffect(() => {
        const allQuestions = [...questions, ...customQuestions];
        onQuestionsChange(allQuestions);
    }, [questions, customQuestions, onQuestionsChange]);

    const generateQuiz = async () => {
        if (!courseContent) {
            setError("No course content available to generate quiz");
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const response = await fetch("/api/generate-quiz", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    courseContent,
                    numQuestions: data.numQuestions || 15,
                    difficulty: courseDifficulty || data.difficulty || 'Moderate'
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to generate quiz");
            }

            const result = await response.json();
            setQuestions(result.questions || []);
        } catch (err: any) {
            console.error("Quiz generation error:", err);
            setError(err.message || "Failed to generate quiz");
        } finally {
            setIsGenerating(false);
        }
    };

    // Generate quiz on mount if we have course content
    useEffect(() => {
        if (courseContent && questions.length === 0) {
            generateQuiz();
        }
    }, [courseContent]);

    const handleRegenerateQuiz = () => {
        generateQuiz();
    };

    const handleAddQuestion = () => {
        setNewQuestion({
            questionText: "",
            options: ["", "", "", ""],
            correctAnswer: 0
        });
        setEditingQuestion(null);
        setShowAddModal(true);
    };

    const handleEditQuestion = (question: QuizQuestion) => {
        setNewQuestion({
            questionText: question.questionText,
            options: [...question.options],
            correctAnswer: question.correctAnswer
        });
        setEditingQuestion(question);
        setShowAddModal(true);
    };

    const handleDeleteQuestion = (questionId: string) => {
        setCustomQuestions(customQuestions.filter(q => q.id !== questionId));
    };

    const handleSaveQuestion = () => {
        if (!newQuestion.questionText.trim() || newQuestion.options.some(opt => !opt.trim())) {
            alert("Please fill in all fields");
            return;
        }

        if (editingQuestion) {
            // Update existing question
            setCustomQuestions(customQuestions.map(q =>
                q.id === editingQuestion.id
                    ? { ...editingQuestion, ...newQuestion }
                    : q
            ));
        } else {
            // Add new question
            const question: QuizQuestion = {
                id: `custom-${Date.now()}`,
                questionText: newQuestion.questionText,
                options: newQuestion.options,
                correctAnswer: newQuestion.correctAnswer,
                isCustom: true
            };
            setCustomQuestions([...customQuestions, question]);
        }

        setShowAddModal(false);
        setEditingQuestion(null);
    };

    const allQuestions = [...questions, ...customQuestions];

    return (
        <div className="flex flex-col h-full">
            <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Quiz Questions</h2>
                <p className="text-slate-500 max-w-2xl mx-auto">
                    Review AI-generated questions and add your own custom questions.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-6 pb-12">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Quiz Questions</h3>
                            <p className="text-sm text-slate-500">
                                {questions.length} AI-generated • {customQuestions.length} custom
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleAddQuestion}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
                            >
                                <PlusCircle size={18} />
                                Add Question
                            </button>
                            <button
                                onClick={handleRegenerateQuiz}
                                disabled={isGenerating}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isGenerating ? "Generating..." : "Regenerate AI"}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                            {error}
                        </div>
                    )}

                    {isGenerating ? (
                        <div className="bg-white border border-gray-200 rounded-lg p-8">
                            <div className="space-y-4 animate-pulse">
                                <div className="h-6 bg-slate-200 rounded w-3/4"></div>
                                <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                                <div className="h-4 bg-slate-200 rounded w-2/3"></div>
                                <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                            </div>
                            <p className="text-center text-slate-600 mt-8">Generating quiz questions...</p>
                        </div>
                    ) : allQuestions.length > 0 ? (
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="p-6 space-y-8">
                                {allQuestions.map((q, idx) => (
                                    <div key={q.id} className="border-b border-gray-100 pb-8 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-sm font-medium text-slate-900">
                                                        {idx + 1}. {q.questionText}
                                                    </span>
                                                    {q.isCustom && (
                                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                                            Custom
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {q.isCustom && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleEditQuestion(q)}
                                                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                                    >
                                                        <PencilSimple size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteQuestion(q.id)}
                                                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                                                    >
                                                        <Trash size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-3 pl-4">
                                            {q.options.map((opt, optIdx) => (
                                                <div key={optIdx} className="flex items-center gap-3">
                                                    <div className={`w-4 h-4 rounded-full border ${optIdx === q.correctAnswer ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-300'}`}>
                                                        {optIdx === q.correctAnswer && (
                                                            <div className="w-full h-full rounded-full bg-blue-500 scale-50"></div>
                                                        )}
                                                    </div>
                                                    <span className={`text-sm ${optIdx === q.correctAnswer ? 'text-blue-700 font-medium' : 'text-slate-600'}`}>
                                                        {opt}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-slate-500">
                            <p className="mb-4">No quiz questions yet.</p>
                            <button
                                onClick={handleAddQuestion}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors shadow-sm inline-flex items-center gap-2"
                            >
                                <PlusCircle size={18} />
                                Add Your First Question
                            </button>
                        </div>
                    )}

                    <div className="flex justify-between items-center pt-8">
                        <button
                            onClick={onBack}
                            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-gray-50 text-sm font-medium"
                        >
                            Previous Step
                        </button>
                        <button
                            onClick={onNext}
                            disabled={allQuestions.length === 0}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next Step
                        </button>
                    </div>
                </div>
            </div>

            {/* Add/Edit Question Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-slate-900">
                                {editingQuestion ? "Edit Question" : "Add Custom Question"}
                            </h3>
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="p-1 hover:bg-gray-100 rounded"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Question Text */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Question
                                </label>
                                <textarea
                                    value={newQuestion.questionText}
                                    onChange={(e) => setNewQuestion({ ...newQuestion, questionText: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                                    rows={3}
                                    placeholder="Enter your question here..."
                                />
                            </div>

                            {/* Options */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Answer Options
                                </label>
                                <div className="space-y-3">
                                    {newQuestion.options.map((option, idx) => (
                                        <div key={idx} className="flex items-center gap-3">
                                            <button
                                                onClick={() => setNewQuestion({ ...newQuestion, correctAnswer: idx })}
                                                className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${newQuestion.correctAnswer === idx
                                                    ? 'border-green-500 bg-green-50'
                                                    : 'border-gray-300 hover:border-green-300'
                                                    }`}
                                            >
                                                {newQuestion.correctAnswer === idx && (
                                                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                                                )}
                                            </button>
                                            <input
                                                type="text"
                                                value={option}
                                                onChange={(e) => {
                                                    const newOptions = [...newQuestion.options];
                                                    newOptions[idx] = e.target.value;
                                                    setNewQuestion({ ...newQuestion, options: newOptions });
                                                }}
                                                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                                placeholder={`Option ${idx + 1}`}
                                            />
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    Click the circle to select the correct answer
                                </p>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    onClick={() => setShowAddModal(false)}
                                    className="px-4 py-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-gray-50 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveQuestion}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                                >
                                    {editingQuestion ? "Save Changes" : "Add Question"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
