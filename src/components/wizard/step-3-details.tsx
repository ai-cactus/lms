"use client";

import { CourseData } from "@/types/course";
import { CaretDown } from "@phosphor-icons/react";

interface Step3DetailsProps {
    data: CourseData;
    onChange: (data: CourseData) => void;
}

export function Step3Details({ data, onChange }: Step3DetailsProps) {
    const handleChange = (field: keyof CourseData, value: string | string[]) => {
        onChange({ ...data, [field]: value });
    };

    const handleObjectiveChange = (index: number, value: string) => {
        const newObjectives = [...(data.objectives || ["", "", ""])];
        newObjectives[index] = value;
        onChange({ ...data, objectives: newObjectives });
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-slate-900 mb-4">Course Details</h2>
                <p className="text-slate-500 max-w-2xl mx-auto text-base">
                    Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
                </p>
            </div>

            <div className="space-y-8 max-w-4xl mx-auto">
                {/* Title */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Course Title</label>
                    <div className="col-span-9">
                        <input
                            type="text"
                            value={data.title || ""}
                            onChange={(e) => handleChange("title", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-slate-900"
                        />
                    </div>
                </div>

                {/* Description */}
                <div className="grid grid-cols-12 gap-8 items-start">
                    <label className="col-span-3 text-sm font-medium text-slate-500 pt-3">Short Description</label>
                    <div className="col-span-9">
                        <textarea
                            rows={5}
                            value={data.description || ""}
                            onChange={(e) => handleChange("description", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 resize-none"
                        />
                    </div>
                </div>

                {/* Category */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Category</label>
                    <div className="col-span-9">
                        <input
                            type="text"
                            value={data.category || ""}
                            readOnly
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-gray-50 text-slate-500 cursor-not-allowed outline-none"
                        />
                    </div>
                </div>

                {/* Difficulty Level */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Difficulty Level</label>
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

                {/* Estimated Duration */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Estimated Duration</label>
                    <div className="col-span-9 relative">
                        <select
                            value={data.duration || "~60 mins"}
                            onChange={(e) => handleChange("duration", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer"
                        >
                            <option>~30 mins</option>
                            <option>~45 mins</option>
                            <option>~60 mins</option>
                            <option>1-2 hours</option>
                            <option>2+ hours</option>
                        </select>
                        <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                </div>

                {/* Content Type */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Content Type</label>
                    <div className="col-span-9 relative">
                        <select
                            value={data.contentType || "Notes"}
                            onChange={(e) => handleChange("contentType", e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer"
                        >
                            <option>Notes</option>
                            <option>Video</option>
                            <option>Slides</option>
                        </select>
                        <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                </div>


                {/* Deadline to Complete Course */}
                <div className="grid grid-cols-12 gap-8 items-center">
                    <label className="col-span-3 text-sm font-medium text-slate-500">Deadline to Complete Course</label>
                    <div className="col-span-9 relative">
                        <select
                            value="30 days"
                            onChange={() => { }}
                            className="w-full border border-gray-200 rounded-lg px-4 py-3 bg-white appearance-none text-slate-900 cursor-pointer"
                        >
                            <option>30 days</option>
                            <option>60 days</option>
                            <option>90 days</option>
                        </select>
                        <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                    </div>
                </div>

                <div className="border-t border-gray-100 my-8"></div>

                {/* Learning Objectives */}
                <div className="grid grid-cols-12 gap-8 items-start">
                    <div className="col-span-12">
                        <h3 className="text-lg font-bold text-slate-900 mb-6">Learning Objectives</h3>
                    </div>
                    <label className="col-span-3 text-sm font-medium text-slate-500 pt-3">Objectives</label>
                    <div className="col-span-9 space-y-4">
                        {(data.objectives || ["", "", ""]).map((obj: string, idx: number) => (
                            <div key={idx} className="flex items-center border border-gray-200 rounded-lg px-4 py-3 bg-white">
                                <span className="text-slate-500 mr-4 font-medium">{idx + 1}.</span>
                                <input
                                    type="text"
                                    value={obj}
                                    onChange={(e) => handleObjectiveChange(idx, e.target.value)}
                                    className="bg-transparent w-full outline-none text-slate-900"
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="border-t border-gray-100 my-8"></div>

                {/* Compliance Mapping */}
                <div className="grid grid-cols-12 gap-8 items-start">
                    <div className="col-span-12">
                        <h3 className="text-lg font-bold text-slate-900 mb-6">Compliance Mapping</h3>
                    </div>
                    <label className="col-span-3 text-sm font-medium text-slate-500 pt-3">CARF Section</label>
                    <div className="col-span-9">
                        <div className="bg-gray-200 rounded-lg px-4 py-3 text-slate-600 border border-transparent">
                            <input
                                type="text"
                                value={data.complianceMapping || "Standard 1.J.5.a.-b."}
                                onChange={(e) => handleChange("complianceMapping", e.target.value)}
                                className="bg-transparent w-full outline-none text-slate-600 placeholder-slate-500"
                                placeholder="e.g. Standard 1.J.5.a.-b."
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
