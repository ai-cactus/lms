"use client";

import { PlusCircle, Trash, CaretDown, CheckSquare, ListBullets, TextT, RadioButton } from "@phosphor-icons/react";
import { QuizConfig } from "@/types/course";
import { useState } from "react";

interface Step6ReviewQuizProps {
    data: QuizConfig;
    onNext: () => void;
    onBack: () => void;
}

export function Step6ReviewQuiz({ data, onNext, onBack }: Step6ReviewQuizProps) {
    const [questions, setQuestions] = useState([
        {
            id: 1,
            question: "What is the name of this document?",
            type: "single",
            options: ["Option 1", "Option 2", "Option 3", "Option 4"],
            correct: 0
        },
        {
            id: 2,
            question: "What is the name of this document?",
            type: "single",
            options: ["Option 1", "Option 2", "Option 3", "Option 4"],
            correct: 0
        },
        {
            id: 3,
            question: "What does a CARF standard mean?",
            type: "multiple",
            options: ["Option 1"],
            correct: [0]
        },
        {
            id: 4,
            question: "What does a CARF standard mean?",
            type: "dropdown",
            options: ["Option 1"],
            correct: 0
        },
        {
            id: 5,
            question: "What does a CARF standard mean?",
            type: "text",
            options: [],
            correct: null
        }
    ]);

    return (
        <div className="flex flex-col h-full">
            <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Quiz Questions</h2>
                <p className="text-slate-500 max-w-2xl mx-auto">
                    Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-6 pb-12">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Editable quiz questions</h3>
                            <p className="text-sm text-slate-500">Subtext</p>
                        </div>
                        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors shadow-sm">
                            Regenerate Quiz
                        </button>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                            <span className="font-semibold text-slate-700">Section Title</span>
                            <CaretDown className="text-slate-400" />
                        </div>

                        <div className="p-6 space-y-8">
                            {questions.map((q, idx) => (
                                <div key={q.id} className="border-b border-gray-100 pb-8 last:border-0 last:pb-0">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex-1">
                                            <span className="text-sm font-medium text-slate-900 block mb-2">{idx + 1}. {q.question}</span>
                                        </div>
                                        {idx < 2 && (
                                            <button className="px-3 py-1 border border-gray-200 rounded text-sm text-slate-600 hover:bg-gray-50">
                                                Edit
                                            </button>
                                        )}
                                        {idx >= 2 && (
                                            <div className="flex items-center gap-2 px-3 py-1 border border-gray-200 rounded text-sm text-slate-600 bg-white">
                                                {q.type === 'multiple' && <CheckSquare />}
                                                {q.type === 'dropdown' && <CaretDown />}
                                                {q.type === 'text' && <TextT />}
                                                <span>
                                                    {q.type === 'multiple' ? 'Checkboxes' :
                                                        q.type === 'dropdown' ? 'Dropdown' :
                                                            q.type === 'text' ? 'Short answer' : 'Multiple Choice'}
                                                </span>
                                                <CaretDown className="ml-2 text-slate-400" size={12} />
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-3 pl-4">
                                        {q.type === 'text' ? (
                                            <input
                                                type="text"
                                                placeholder="Short answer"
                                                disabled
                                                className="w-full border-b border-gray-200 py-2 text-sm bg-transparent"
                                            />
                                        ) : (
                                            <>
                                                {q.options.map((opt, optIdx) => (
                                                    <div key={optIdx} className="flex items-center gap-3">
                                                        <div className={`w-4 h-4 rounded-full border ${optIdx === 0 && q.type !== 'multiple' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}></div>
                                                        <span className="text-sm text-slate-600">{opt}</span>
                                                        {idx >= 2 && optIdx === 0 && (
                                                            <div className="w-0.5 h-4 bg-blue-500 animate-pulse"></div>
                                                        )}
                                                    </div>
                                                ))}
                                                {idx >= 2 && (
                                                    <div className="flex items-center gap-3 text-slate-400">
                                                        <div className="w-4 h-4 border border-gray-300 rounded"></div>
                                                        <span className="text-sm">Add Option</span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                            <button className="flex items-center gap-2 text-blue-600 font-medium text-sm hover:text-blue-700">
                                <PlusCircle size={18} />
                                Add question
                            </button>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center bg-gray-50">
                            <span className="font-semibold text-slate-700">Section Title</span>
                            <PlusCircle className="text-blue-600" size={20} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
