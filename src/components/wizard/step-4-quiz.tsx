"use client";

import { Plus, CaretDown, CaretUp } from "@phosphor-icons/react";
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
            <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-slate-900 mb-4">Course Quiz</h2>
                <p className="text-slate-500 max-w-2xl mx-auto text-base">
                    Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
                </p>
            </div>

            <div className="space-y-8 max-w-4xl mx-auto">
                <div className="flex items-center gap-2 mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Course Quiz</h3>
                </div>

                {/* Quiz Title */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Quiz Title</label>
                    <div className="col-span-9">
                        <input
                            type="text"
                            value={data.title || "HIPAA Privacy and Security Quiz"}
                            onChange={(e) => handleChange("title", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-900"
                        />
                    </div>
                </div>

                {/* Number of Questions */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Number of Questions:</label>
                    <div className="col-span-9 relative">
                        <input
                            type="number"
                            value={data.numQuestions || 15}
                            onChange={(e) => handleChange("numQuestions", parseInt(e.target.value))}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none text-slate-400">
                            <CaretUp size={10} weight="fill" />
                            <CaretDown size={10} weight="fill" />
                        </div>
                    </div>
                </div>

                {/* Difficulty */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Difficulty:</label>
                    <div className="col-span-9 relative">
                        <select
                            value={data.difficulty || "Moderate"}
                            onChange={(e) => handleChange("difficulty", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer"
                        >
                            <option>Beginner</option>
                            <option>Moderate</option>
                            <option>Advanced</option>
                        </select>
                        <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                </div>

                {/* Question Type */}
                <div className="grid grid-cols-12 gap-8 items-start">
                    <label className="col-span-3 text-sm font-medium text-slate-500 pt-3">Question Type:</label>
                    <div className="col-span-9 space-y-4">
                        <div className="relative">
                            <select className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer">
                                <option>Multiple Choice</option>
                            </select>
                            <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                        </div>
                        <div className="relative">
                            <select className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer">
                                <option>Short answer</option>
                            </select>
                            <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                        </div>
                        <button type="button" className="text-blue-600 text-sm font-medium flex items-center gap-2 mt-2 hover:text-blue-700">
                            <Plus size={18} weight="bold" /> Add Question type
                        </button>
                    </div>
                </div>

                <div className="border-t border-gray-100 my-8"></div>

                {/* Estimated Duration */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Estimated Duration</label>
                    <div className="col-span-9 relative">
                        <select
                            value="~15 mins"
                            onChange={() => { }}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer"
                        >
                            <option>~15 mins</option>
                            <option>~30 mins</option>
                            <option>~45 mins</option>
                        </select>
                        <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                </div>

                {/* Pass Mark */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Pass Mark:</label>
                    <div className="col-span-9">
                        <input
                            type="text"
                            value={data.passMark || "80%"}
                            onChange={(e) => handleChange("passMark", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900"
                        />
                    </div>
                </div>

                {/* Attempts */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Attempts</label>
                    <div className="col-span-9 relative">
                        <input
                            type="number"
                            value={data.attempts || 2}
                            onChange={(e) => handleChange("attempts", parseInt(e.target.value))}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none text-slate-400">
                            <CaretUp size={10} weight="fill" />
                            <CaretDown size={10} weight="fill" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
