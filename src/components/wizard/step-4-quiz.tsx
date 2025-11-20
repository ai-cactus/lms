"use client";

import { Plus } from "@phosphor-icons/react";
import { QuizConfig } from "@/types/course";

interface Step4QuizProps {
    data: QuizConfig;
    onChange: (data: QuizConfig) => void;
}

export function Step4Quiz({ data, onChange }: Step4QuizProps) {
    const handleChange = (field: keyof QuizConfig, value: string | number) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">Quiz Configuration</h2>

            <div className="space-y-6 max-w-xl mx-auto">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Quiz Title</label>
                    <input
                        type="text"
                        value={data.title || "Course Quiz"}
                        onChange={(e) => handleChange("title", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-gray-50"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Number of Questions</label>
                    <input
                        type="number"
                        value={data.numQuestions || 15}
                        onChange={(e) => handleChange("numQuestions", parseInt(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Difficulty</label>
                    <select
                        value={data.difficulty || "Moderate"}
                        onChange={(e) => handleChange("difficulty", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white"
                    >
                        <option>Beginner</option>
                        <option>Moderate</option>
                        <option>Advanced</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Question Type</label>
                    <div className="space-y-2">
                        <select className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white">
                            <option>Multiple Choice</option>
                        </select>
                        <button type="button" className="text-indigo-600 text-sm font-medium flex items-center gap-1 mt-1">
                            <Plus size={16} /> Add Question Type
                        </button>
                    </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Pass Mark</label>
                    <input
                        type="text"
                        value={data.passMark || "80%"}
                        onChange={(e) => handleChange("passMark", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Attempts Allowed</label>
                    <input
                        type="number"
                        value={data.attempts || 2}
                        onChange={(e) => handleChange("attempts", parseInt(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                </div>
            </div>
        </div>
    );
}
