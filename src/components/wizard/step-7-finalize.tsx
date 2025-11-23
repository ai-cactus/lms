"use client";

import { useState } from "react";
import {
    Calendar,
    Clock,
    ChevronDown,
    X,
    Plus,
    Check
} from "lucide-react";

interface Step7FinalizeProps {
    onPublish: () => void;
    onBack: () => void;
}

type AssignType = "All Personnel" | "Individuals" | "Specific staff roles";

export function Step7Finalize({ onPublish, onBack }: Step7FinalizeProps) {
    const [assignType, setAssignType] = useState<AssignType>("All Personnel");
    const [deadlineEnabled, setDeadlineEnabled] = useState(true);
    const [calendarEnabled, setCalendarEnabled] = useState(true);
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [emailInput, setEmailInput] = useState("");

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
                    Select which staff should take this course, set deadlines, and finalize publishing.
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
                            <option>Individuals</option>
                            <option>Specific staff roles</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" />
                    </div>
                </div>

                {/* Conditional Content based on Assign Type */}
                {assignType === "Individuals" && (
                    <div className="border-b border-gray-100 pb-8">
                        <label className="block text-sm font-bold text-slate-900 mb-1">Enter team member email</label>
                        <p className="text-xs text-slate-500 mb-4">Enter one or more emails to invite to your course.</p>
                        <div className="flex gap-4">
                            <input
                                type="text"
                                placeholder="Emails, comma seperated"
                                value={emailInput}
                                onChange={(e) => setEmailInput(e.target.value)}
                                className="flex-1 border border-gray-200 rounded-lg px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
                                Invite
                            </button>
                        </div>
                    </div>
                )}

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

                {/* Completion Deadline */}
                <div className="border-b border-gray-100 pb-8">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900">Set Completion Deadline</h3>
                        <button
                            onClick={() => setDeadlineEnabled(!deadlineEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${deadlineEnabled ? 'bg-blue-600' : 'bg-gray-200'
                                }`}
                        >
                            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${deadlineEnabled ? 'left-7' : 'left-1'
                                }`} />
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 mb-6">Set a deadline for team member to complete this course</p>

                    {deadlineEnabled && (
                        <div className="space-y-4">
                            <div className="flex gap-8">
                                <div className="flex-1 flex items-center gap-3 border-b border-gray-200 pb-2">
                                    <Calendar className="w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Due date"
                                        className="flex-1 bg-transparent focus:outline-none text-sm"
                                    />
                                </div>
                                <div className="flex-1 flex items-center gap-3 border-b border-gray-200 pb-2">
                                    <Clock className="w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Due time"
                                        className="flex-1 bg-transparent focus:outline-none text-sm"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between py-2">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-5 h-5 text-slate-900" />
                                    <span className="text-sm font-medium text-slate-900">30 minutes before</span>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <button className="text-sm text-slate-400 hover:text-slate-600 pl-8">
                                Add reminder
                            </button>
                        </div>
                    )}
                </div>

                {/* Add to Calendar */}
                <div className="border-b border-gray-100 pb-8">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900">Add to Calendar</h3>
                        <button
                            onClick={() => setCalendarEnabled(!calendarEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${calendarEnabled ? 'bg-blue-600' : 'bg-gray-200'
                                }`}
                        >
                            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${calendarEnabled ? 'left-7' : 'left-1'
                                }`} />
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 max-w-md">
                        Make the most of your Uxcel learning experience with practical design & product-related tips.
                    </p>
                </div>

                {/* Send Email Notifications */}
                <div className="pb-8">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900">Send Email Notifications</h3>
                        <button
                            onClick={() => setEmailEnabled(!emailEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${emailEnabled ? 'bg-blue-600' : 'bg-gray-200'
                                }`}
                        >
                            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${emailEnabled ? 'left-7' : 'left-1'
                                }`} />
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 max-w-md">
                        Who doesn't love discounts? We'll often send special offers that you surely don't want to miss.
                    </p>
                </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between mt-12 pt-8 border-t border-gray-100">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border border-gray-200 rounded-lg text-slate-700 font-medium hover:bg-gray-50 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={onPublish}
                    className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-colors"
                >
                    Publish Course
                </button>
            </div>
        </div>
    );
}
