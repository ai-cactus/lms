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
        // Federal & Legal Compliance
        "HIPAA Privacy Rule & Patient Rights",
        "HIPAA Security Rule & Electronic Safeguards",
        "HIPAA Breach Notification Protocols",
        "Fraud, Waste, and Abuse (FWA) Prevention",
        "False Claims Act & Whistleblower Protections",
        "Anti-Kickback Statute and Stark Law",
        "EMTALA (Emergency Medical Treatment and Labor Act)",
        "Corporate Code of Conduct & Ethics",
        "Section 1557 (ACA) Nondiscrimination",
        "Incident Reporting & Root Cause Analysis",

        // SOC 2 & Advanced Cybersecurity
        "Social Engineering & Phishing Prevention",
        "Password Hygiene & Multi-Factor Authentication (MFA)",
        "Clean Desk & Clear Screen Policies",
        "Data Classification & Handling (Public vs. Confidential)",
        "Mobile Device Security & BYOD Policies",
        "Physical Security & Visitor Access Controls",
        "Acceptable Use Policy (AUP) for Technology",
        "Vendor Risk Management & Third-Party Access",
        "Disaster Recovery & Business Continuity Planning",

        // Workplace Culture & HR
        "Sexual Harassment & Discrimination Prevention",
        "Diversity, Equity, and Inclusion (DEI) in Healthcare",
        "Cultural Competency & CLAS Standards",
        "Substance Abuse & Drug-Free Workplace",
        "Social Media Use & Patient Privacy",
        "Workplace Violence & Active Shooter Response",
        "Conflicts of Interest",

        // Specialized Clinical & Safety
        "Trauma-Informed Care Fundamentals",
        "Bloodborne Pathogens & Sharps Safety (OSHA)",
        "Hazard Communication (HazCom/GHS)",
        "Tuberculosis (TB) Prevention & Control",
        "Pain Management & Safe Opioid Prescribing",
        "Rights of Persons Served (Patient Bill of Rights)",
        "Medical Record Documentation Standards",

        // General Healthcare
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
    ].sort();

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
                        className={`flex items-center justify-between w-full p-4 border rounded-lg cursor-pointer bg-white z-10 relative transition-colors ${isOpen || value ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-300 hover:border-indigo-500'
                            }`}
                    >
                        <span className={value ? "text-slate-900 font-medium" : "text-slate-500"}>
                            {value || "Select an option"}
                        </span>
                        <CaretDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                        <div className="absolute top-full left-0 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-xl z-20 max-h-60 overflow-y-auto">
                            <div className="p-2 space-y-1">
                                {categories.map((cat) => (
                                    <div
                                        key={cat}
                                        onClick={() => handleSelect(cat)}
                                        className={`px-4 py-2 text-sm rounded cursor-pointer transition-colors ${value === cat
                                            ? 'bg-indigo-50 text-indigo-700 font-medium'
                                            : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
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
