"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useState } from "react";

interface Step1CategoryProps {
    value: string;
    onChange: (category: string) => void;
}

export function Step1Category({ value, onChange }: Step1CategoryProps) {
    const [isOpen, setIsOpen] = useState(false);

    const categories = [
        "Health and Safety Practices",
        "Infection Prevention and Control",
        "Cybersecurity and Technology",
        "Prevention of Unsafe Behaviors",
        "Medication Management",
        "Nonviolent Practices",
        "Service Delivery via Information and Communication Technologies (Telehealth)",
        "First Aid, CPR, and Emergency Equipment Use",
        "Suicide Prevention",
        "Orientation-Specific Trainings",
        "Crisis Programs/Contact Centers",
        "Detoxification/Withdrawal Management",
        "Office-Based Opioid Treatment",
        "Court Treatment Programs",
        "Health Home Programs"
    ];

    const handleSelect = (cat: string) => {
        onChange(cat);
        setIsOpen(false);
    };

    return (
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-2xl font-bold text-slate-900 mb-8">What category best fits the course you&apos;re creating?</h2>

            <div className="w-full max-w-md mx-auto text-left relative">
                <div className="relative">
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className={`flex items-center justify-between w-full p-4 border rounded-[12px] cursor-pointer bg-white z-10 relative transition-all ${isOpen || value ? 'border-[#4758E0] ring-1 ring-[#4758E0]' : 'border-gray-200 hover:border-[#4758E0]'
                            }`}
                    >
                        <span className={value ? "text-slate-900 font-medium" : "text-slate-500"}>
                            {value || "Select an option"}
                        </span>
                        <CaretDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                        <div className="absolute top-full left-0 w-full mt-2 bg-white border border-gray-100 rounded-[12px] shadow-xl z-20 max-h-[60vh] overflow-y-auto">
                            <div className="p-2 space-y-1">
                                {categories.map((cat) => (
                                    <div
                                        key={cat}
                                        onClick={() => handleSelect(cat)}
                                        className={`px-4 py-2 text-sm rounded cursor-pointer transition-colors ${value === cat
                                            ? 'bg-[#4758E0]/10 text-[#4758E0] font-medium'
                                            : 'text-slate-700 hover:bg-[#4758E0]/5 hover:text-[#4758E0]'
                                            }`}
                                    >
                                        {cat}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Backdrop to close dropdown */}
                {isOpen && (
                    <div className="fixed inset-0 z-0" onClick={() => setIsOpen(false)}></div>
                )}

                <p className="mt-12 text-slate-500 text-center text-sm">
                    Start by creating your first course. You get asked a couple of questions.
                </p>
            </div>
        </div>
    );
}
