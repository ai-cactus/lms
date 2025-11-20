"use client";

import { CourseData } from "@/types/course";

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
            <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">Course Details</h2>
            <p className="text-slate-500 mb-8 text-center text-sm">Review the details generated from your documents.</p>

            <div className="space-y-6 max-w-3xl mx-auto">
                {/* Title */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Course Title</label>
                    <input
                        type="text"
                        value={data.title || ""}
                        onChange={(e) => handleChange("title", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                </div>

                {/* Description */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Short Description</label>
                    <textarea
                        rows={3}
                        value={data.description || ""}
                        onChange={(e) => handleChange("description", e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    />
                </div>

                {/* Grid for selects */}
                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                        <select
                            value={data.category || ""}
                            onChange={(e) => handleChange("category", e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white"
                        >
                            <option value="Healthcare Compliance">Healthcare Compliance</option>
                            <option value="Cybersecurity and Technology">Cybersecurity and Technology</option>
                            <option value="HR & Ethics">HR & Ethics</option>
                            <option value="Medical Equipment">Medical Equipment</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Difficulty Level</label>
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
                        <label className="block text-sm font-medium text-slate-700 mb-1">Estimated Duration</label>
                        <select
                            value={data.duration || "< 45 mins"}
                            onChange={(e) => handleChange("duration", e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white"
                        >
                            <option>&lt; 30 mins</option>
                            <option>&lt; 45 mins</option>
                            <option>&lt; 1 hour</option>
                            <option>1-2 hours</option>
                            <option>2+ hours</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Content Type</label>
                        <select
                            value={data.contentType || "Text"}
                            onChange={(e) => handleChange("contentType", e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white"
                        >
                            <option>Text</option>
                            <option>Video</option>
                            <option>Slides</option>
                        </select>
                    </div>
                </div>

                {/* Learning Objectives */}
                <div>
                    <label className="block text-sm font-bold text-slate-900 mb-2 mt-6">Learning Objectives</label>
                    <div className="space-y-2">
                        {(data.objectives || ["", "", ""]).map((obj: string, idx: number) => (
                            <div key={idx} className="flex items-center border border-gray-200 rounded-md px-3 py-2 bg-slate-50">
                                <span className="text-slate-400 mr-3">{idx + 1}.</span>
                                <input
                                    type="text"
                                    value={obj}
                                    onChange={(e) => handleObjectiveChange(idx, e.target.value)}
                                    className="bg-transparent w-full outline-none text-sm text-slate-700"
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Compliance Mapping */}
                <div>
                    <label className="block text-sm font-bold text-slate-900 mb-2">Compliance Mapping</label>
                    <div className="bg-slate-100 rounded-lg p-3 text-sm text-slate-600 border border-slate-200">
                        <input
                            type="text"
                            value={data.complianceMapping || ""}
                            onChange={(e) => handleChange("complianceMapping", e.target.value)}
                            className="bg-transparent w-full outline-none"
                            placeholder="e.g. Standard 1.5.4.a - Privacy of Health Information"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
