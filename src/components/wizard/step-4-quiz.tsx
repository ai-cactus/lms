"use client";

import { Plus, CaretDown, CaretUp } from "@phosphor-icons/react";
import { QuizConfig } from "@/types/course";
import { ChevronDown } from "lucide-react";

interface Step4QuizProps {
    data: QuizConfig;
    courseTitle: string;
    onChange: (data: QuizConfig) => void;
}

export function Step4Quiz({ data, courseTitle, onChange }: Step4QuizProps) {
    const handleChange = (field: keyof QuizConfig, value: string | number) => {
        onChange({ ...data, [field]: value });
    };

    // Auto-set defaults if empty
    if (!data.title && courseTitle) {
        setTimeout(() => handleChange("title", `${courseTitle} Quiz`), 0);
    }
    if (!data.questionType) {
        setTimeout(() => handleChange("questionType", "Multiple Choice"), 0);
    }
    if (!data.difficulty) {
        setTimeout(() => handleChange("difficulty", "Moderate"), 0);
    }
    if (!data.estimatedDuration) {
        setTimeout(() => handleChange("estimatedDuration", "~15 mins"), 0);
    }

    const handlePassMarkChange = (increment: boolean) => {
        const current = parseInt((data.passMark || "80%").replace("%", ""));
        let next = increment ? current + 10 : current - 10;
        if (next > 100) next = 100;
        if (next < 50) next = 50;
        handleChange("passMark", `${next}%`);
    };

    const handleNumQuestionsChange = (increment: boolean) => {
        const current = data.numQuestions || 15;
        let next = increment ? current + 1 : current - 1;
        if (next < 1) next = 1;
        handleChange("numQuestions", next);
    };

    const handleAttemptsChange = (increment: boolean) => {
        const current = data.attempts || 2;
        let next = increment ? current + 1 : current - 1;
        if (next < 1) next = 1;
        handleChange("attempts", next);
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-slate-900 mb-4">Course Quiz</h2>
                <p className="text-slate-500 max-w-2xl mx-auto text-base">
                    Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
                </p>
            </div>

            <div className="space-y-6 max-w-4xl mx-auto">
                <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-bold text-slate-900">Course Quiz</h3>
                </div>

                {/* Quiz Title */}
                <div className="grid grid-cols-12 gap-8 items-center border-b border-gray-50 pb-6 last:border-0 last:pb-0">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Quiz Title</label>
                    <div className="col-span-9">
                        <input
                            type="text"
                            value={data.title || ""}
                            onChange={(e) => handleChange("title", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-900"
                            placeholder={`${courseTitle} Quiz`}
                        />
                    </div>
                </div>

                {/* Number of Questions */}
                <div className="grid grid-cols-12 gap-8 items-center border-b border-gray-50 pb-6 last:border-0 last:pb-0">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Number of Questions:</label>
                    <div className="col-span-9 relative">
                        <input
                            type="number"
                            value={data.numQuestions || ""}
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                handleChange("numQuestions", isNaN(val) ? 0 : val);
                            }}
                            placeholder="15"
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none bg-white"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 text-slate-400 cursor-pointer z-10">
                            <button onClick={() => handleNumQuestionsChange(true)} className="hover:text-blue-600 outline-none">
                                <CaretUp size={12} weight="fill" />
                            </button>
                            <button onClick={() => handleNumQuestionsChange(false)} className="hover:text-blue-600 outline-none">
                                <CaretDown size={12} weight="fill" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Difficulty */}
                <div className="grid grid-cols-12 gap-8 items-center border-b border-gray-50 pb-6 last:border-0 last:pb-0">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Difficulty:</label>
                    <div className="col-span-9 relative">
                        <select
                            value={data.difficulty || "Moderate"}
                            onChange={(e) => handleChange("difficulty", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none bg-white cursor-pointer"
                        >
                            <option value="Easy">Easy</option>
                            <option value="Moderate">Moderate</option>
                            <option value="Hard">Hard</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                </div>

                {/* Question Type */}
                <div className="grid grid-cols-12 gap-8 items-center border-b border-gray-50 pb-6 last:border-0 last:pb-0">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Question Type:</label>
                    <div className="col-span-9 relative">
                        <div className="relative">
                            <select
                                value="Multiple Choice"
                                disabled
                                className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-gray-50 text-slate-900 appearance-none cursor-not-allowed"
                            >
                                <option>Multiple Choice</option>
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>
                </div>

                {/* Estimated Duration */}
                <div className="grid grid-cols-12 gap-8 items-center border-b border-gray-50 pb-6 last:border-0 last:pb-0">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Estimated Duration</label>
                    <div className="col-span-9 relative">
                        <select
                            value={data.estimatedDuration || "~15 mins"}
                            onChange={(e) => handleChange("estimatedDuration", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none bg-white cursor-pointer"
                        >
                            <option value="~5 mins">~5 mins</option>
                            <option value="~10 mins">~10 mins</option>
                            <option value="~15 mins">~15 mins</option>
                            <option value="~30 mins">~30 mins</option>
                            <option value="~45 mins">~45 mins</option>
                            <option value="~60 mins">~60 mins</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                </div>

                {/* Pass Mark */}
                <div className="grid grid-cols-12 gap-8 items-center border-b border-gray-50 pb-6 last:border-0 last:pb-0">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Pass Mark:</label>
                    <div className="col-span-9 relative">
                        <input
                            type="text"
                            readOnly
                            value={data.passMark || "80%"}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 bg-white"
                        />
                        {/* No up/down arrows shown in screenshot for Pass Mark, just input. But logic was there. Keeping clean input. */}
                    </div>
                </div>

                {/* Attempts */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Attempts</label>
                    <div className="col-span-9 relative">
                        <input
                            type="number"
                            value={data.attempts || ""}
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                handleChange("attempts", isNaN(val) ? 0 : val);
                            }}
                            placeholder="2"
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none bg-white"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 text-slate-400 cursor-pointer z-10">
                            <button onClick={() => handleAttemptsChange(true)} className="hover:text-blue-600 outline-none">
                                <CaretUp size={12} weight="fill" />
                            </button>
                            <button onClick={() => handleAttemptsChange(false)} className="hover:text-blue-600 outline-none">
                                <CaretDown size={12} weight="fill" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
