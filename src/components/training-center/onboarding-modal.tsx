"use client";

import { Lightbulb, X } from "@phosphor-icons/react";
import Link from "next/link";

interface OnboardingModalProps {
    onClose?: () => void;
}

export function OnboardingModal({ onClose }: OnboardingModalProps) {
    return (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden max-w-5xl w-full mx-4">
            <div className="flex flex-col lg:flex-row">
                {/* Left Side - Illustration */}
                <div className="lg:w-5/12 bg-emerald-50 p-12 flex flex-col justify-center items-center relative overflow-hidden">
                    <div className="relative z-10 text-center">
                        <div className="mb-8 relative">
                            {/* Abstract Illustration Representation */}
                            <div className="w-64 h-64 mx-auto relative">
                                <div className="absolute inset-0 bg-emerald-200 rounded-full opacity-20 blur-3xl"></div>
                                <div className="relative z-10 bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-emerald-100">
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                                            <Lightbulb weight="fill" className="text-3xl" />
                                        </div>
                                        <div className="h-2 w-32 bg-slate-100 rounded-full"></div>
                                        <div className="h-2 w-24 bg-slate-100 rounded-full"></div>
                                        <div className="flex gap-2 mt-2">
                                            <div className="w-8 h-12 bg-slate-800 rounded-md"></div>
                                            <div className="w-8 h-12 bg-emerald-500 rounded-md"></div>
                                            <div className="w-8 h-12 bg-slate-800 rounded-md"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <h2 className="text-3xl font-bold text-emerald-800 mb-4">
                            Turn Your Healthcare Policies into Interactive Training in Minutes.
                        </h2>
                        <p className="text-emerald-700/80 text-lg mb-8">
                            Operationalize your policies and procedures by training your staff
                        </p>

                        <Link
                            href="/admin/courses/create"
                            className="inline-flex items-center justify-center px-8 py-4 text-base font-bold text-white transition-all duration-200 bg-emerald-600 border border-transparent rounded-full hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-600 shadow-lg shadow-emerald-600/20"
                        >
                            Create your first course
                        </Link>
                    </div>

                    {/* Decorative elements */}
                    <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
                        <div className="absolute top-10 left-10 w-20 h-20 bg-emerald-300 rounded-full blur-2xl"></div>
                        <div className="absolute bottom-10 right-10 w-32 h-32 bg-teal-300 rounded-full blur-3xl"></div>
                    </div>
                </div>

                {/* Right Side - Steps */}
                <div className="lg:w-7/12 p-12 lg:p-16 bg-white relative">
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            aria-label="Close"
                        >
                            <X size={24} />
                        </button>
                    )}

                    <div className="max-w-xl">
                        <h1 className="text-3xl font-bold text-slate-900 mb-10">How to get started</h1>

                        <div className="space-y-10">
                            {/* Step 1 */}
                            <div className="relative pl-8 border-l-2 border-emerald-100 pb-2">
                                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">1. Select Type of Training</h3>
                                <p className="text-slate-500 leading-relaxed">
                                    Choose whether the training is based on compliance, safety, HR, or any internal policy area.
                                </p>
                            </div>

                            {/* Step 2 */}
                            <div className="relative pl-8 border-l-2 border-emerald-100 pb-2">
                                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">2. Upload Policies</h3>
                                <p className="text-slate-500 leading-relaxed">
                                    Upload your organization's documents. Theraptly will analyze and prepare a draft training automatically.
                                </p>
                            </div>

                            {/* Step 3 */}
                            <div className="relative pl-8 border-l-2 border-emerald-100 pb-2">
                                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">3. Configure Course & Assessment</h3>
                                <p className="text-slate-500 leading-relaxed">
                                    Define course structure, quiz settings, difficulty level, and deadlines.
                                </p>
                            </div>

                            {/* Step 4 */}
                            <div className="relative pl-8 border-l-2 border-emerald-100 pb-2">
                                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">4. Review & Publish Course</h3>
                                <p className="text-slate-500 leading-relaxed">
                                    Review AI-generated lessons and quizzes, make adjustments, and approve for publishing. Instantly make your training available for your team to access and complete.
                                </p>
                            </div>

                            {/* Step 5 */}
                            <div className="relative pl-8">
                                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">5. Invite Workers to Course</h3>
                                <p className="text-slate-500 leading-relaxed">
                                    Assign courses to individuals or departments and track progress directly from your dashboard.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
