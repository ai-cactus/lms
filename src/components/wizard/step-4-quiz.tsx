"use client";

import { Plus, CaretDown, CaretUp } from "@phosphor-icons/react";
import { QuizConfig } from "@/types/course";

interface Step4QuizProps {
    data: QuizConfig;
    courseTitle: string;
    onChange: (data: QuizConfig) => void;
}

export function Step4Quiz({ data, courseTitle, onChange }: Step4QuizProps) {
    const handleChange = (field: keyof QuizConfig, value: string | number) => {
        onChange({ ...data, [field]: value });
    };

    // Auto-set quiz title if empty
    if (!data.title && courseTitle) {
        // We use setTimeout to avoid render-cycle state updates
        setTimeout(() => handleChange("title", `${courseTitle} Quiz`), 0);
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
                    Configure the quiz settings for your course.
                </p>
            </div>

            <div className="space-y-8 max-w-4xl mx-auto">
                <div className="flex items-center gap-2 mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Quiz Configuration</h3>
                </div>

                {/* Quiz Title */}
                <div className="grid grid-cols-12 gap-8 items-center">
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
                <div className="grid grid-cols-12 gap-8 items-center">
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
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 text-slate-400 cursor-pointer z-10">
                            <div onClick={() => handleNumQuestionsChange(true)} className="hover:text-blue-600">
                                <CaretUp size={12} weight="fill" />
                            </div>
                            <div onClick={() => handleNumQuestionsChange(false)} className="hover:text-blue-600">
                                <CaretDown size={12} weight="fill" />
                            </div>
                        </div>
                    </div>
                </div>





                {/* Pass Mark */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Pass Mark:</label>
                    <div className="col-span-9 relative">
                        <input
                            type="text"
                            readOnly
                            value={data.passMark || "80%"}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 text-slate-400 cursor-pointer z-10">
                            <div onClick={() => handlePassMarkChange(true)} className="hover:text-blue-600">
                                <CaretUp size={12} weight="fill" />
                            </div>
                            <div onClick={() => handlePassMarkChange(false)} className="hover:text-blue-600">
                                <CaretDown size={12} weight="fill" />
                            </div>
                        </div>
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
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 appearance-none"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 text-slate-400 cursor-pointer z-10">
                            <div onClick={() => handleAttemptsChange(true)} className="hover:text-blue-600">
                                <CaretUp size={12} weight="fill" />
                            </div>
                            <div onClick={() => handleAttemptsChange(false)} className="hover:text-blue-600">
                                <CaretDown size={12} weight="fill" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
