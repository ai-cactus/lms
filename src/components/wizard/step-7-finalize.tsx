"use client";

import { useState } from "react";
import {
    ChevronDown,
    Check
} from "lucide-react";

interface Step7FinalizeProps {
    onPublish: (data: {
        assignType: string;
        selectedRoles?: string[];
    }) => void;
    onBack: () => void;
    isPublishing?: boolean;
}

type AssignType = "All Personnel" | "Individuals" | "Specific staff roles";

export function Step7Finalize({ onPublish, onBack, isPublishing = false }: Step7FinalizeProps) {
    const [assignType, setAssignType] = useState<AssignType>("All Personnel");

    // Mock roles based on mockup
    const roles = [
        "Direct Service Personnel",
        "Inpatient/Residential Treatment Staff",
        "Peer Support Specialists",
        "Office-Based Opioid Treatment Program Staff",
        "Call Center/Information Center Staff",
        "Court Treatment Program Staff",
        "Seclusion/Restraint-Involved Staff",
        "Clinical Staff",
        "Crisis Program/Contact Center Staff",
        "Support Staff",
        "Detoxification/Withdrawal Management Staff",
        "Interdisciplinary Team Members",
        "Health Home Program Staff"
    ];

    const [selectedRoles, setSelectedRoles] = useState<string[]>([
        "Direct Service Personnel",
        "Peer Support Specialists",
        "Call Center/Information Center Staff",
        "Inpatient/Residential Treatment Staff",
        "Clinical Staff",
        "Support Staff",
        "Interdisciplinary Team Members"
    ]);

    const toggleRole = (role: string) => {
        if (selectedRoles.includes(role)) {
            setSelectedRoles(selectedRoles.filter(r => r !== role));
        } else {
            setSelectedRoles([...selectedRoles, role]);
        }
    };



    return (
        <div className="max-w-3xl mx-auto py-8">
            <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">Assigning & Publish</h2>
                <p className="text-slate-500">
                    Select which staff should take this course and finalize publishing.
                </p>
            </div>

            <div className="space-y-8">
                {/* Assign To Section */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-8">
                    <label className="text-sm font-medium text-slate-600">Assign To</label>
                    <div className="relative w-[600px]">
                        <select
                            value={assignType}
                            onChange={(e) => setAssignType(e.target.value as AssignType)}
                            className="w-full appearance-none bg-white border border-gray-200 rounded-lg px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option>All Personnel</option>
                            <option>Specific staff roles</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" />
                    </div>
                </div>

                {/* Conditional Content based on Assign Type */}

                {assignType === "Specific staff roles" && (
                    <div className="border-b border-gray-100 pb-8">
                        <label className="block text-sm font-bold text-slate-900 mb-6">Assign to specific staff roles</label>
                        <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                            {roles.map((role) => (
                                <label key={role} className="flex items-center gap-3 cursor-pointer group">
                                    <div
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedRoles.includes(role)
                                            ? 'bg-indigo-600 border-indigo-600'
                                            : 'border-gray-300 group-hover:border-indigo-400'
                                            }`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            toggleRole(role);
                                        }}
                                    >
                                        {selectedRoles.includes(role) && <Check className="w-3.5 h-3.5 text-white" />}
                                    </div>
                                    <span className="text-sm text-slate-600">{role}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}


            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between mt-12 pt-8 border-t border-gray-100">
                <button
                    onClick={onBack}
                    disabled={isPublishing}
                    className="px-8 py-3 border border-gray-200 rounded-lg text-slate-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Back
                </button>
                <button
                    onClick={() => {
                        onPublish({
                            assignType,
                            selectedRoles: assignType === "Specific staff roles" ? selectedRoles : undefined,
                        });
                    }}
                    disabled={isPublishing}
                    className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {isPublishing ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Publishing...
                        </>
                    ) : (
                        "Publish Course"
                    )}
                </button>
            </div>
        </div>
    );
}
