"use client";

import { useState, useEffect } from "react";
import { Hexagon } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { Step1Category } from "./step-1-category";
import { Step2Upload } from "./step-2-upload";
import { Step3Details } from "./step-3-details";
import { Step4Quiz } from "./step-4-quiz";
import { Step5ReviewContent } from "./step-5-review-content";
import { Step6ReviewQuiz } from "./step-6-review-quiz";
import { Step7Finalize } from "./step-7-finalize";
import { CourseData, QuizConfig } from "@/types/course";

interface WizardContainerProps {
    onClose: () => void;
    onComplete: (courseData: CourseData, files: File[]) => void;
    initialPolicyId?: string;
}

export function WizardContainer({ onClose, onComplete, initialPolicyId }: WizardContainerProps) {
    const [step, setStep] = useState(1);
    const [courseData, setCourseData] = useState<CourseData>({});
    const [files, setFiles] = useState<File[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const supabase = createClient();

    const totalSteps = 7;
    const progress = (step / totalSteps) * 100;

    useEffect(() => {
        if (initialPolicyId) {
            loadPolicy(initialPolicyId);
        }
    }, [initialPolicyId]);

    const performAnalysis = async (filesToAnalyze: File[]) => {
        setIsAnalyzing(true);
        try {
            // 1. Read files
            const fileContents = await Promise.all(
                filesToAnalyze.map(async (file) => {
                    return new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            resolve({
                                name: file.name,
                                type: file.type,
                                data: reader.result as string,
                            });
                        };
                        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
                        reader.readAsDataURL(file);
                    });
                })
            );

            // 2. Analyze documents
            const res = await fetch("/api/analyze-documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: fileContents }),
            });

            if (!res.ok) throw new Error("Analysis failed");

            const { metadata } = await res.json();
            setCourseData((prev) => ({ ...prev, ...metadata }));
            return true;
        } catch (error) {
            console.error("Error analyzing files:", error);
            alert("Failed to analyze documents. Please try again.");
            return false;
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleNext = async () => {
        if (step === 2) {
            // On Step 2, analyze the files before proceeding
            const success = await performAnalysis(files);
            if (!success) return;
        }

        if (step < totalSteps) {
            setStep(step + 1);
        } else {
            // Final Step - Complete
            onComplete(courseData, files);
        }
    };

    const handleBack = () => {
        if (step > 1) {
            setStep(step - 1);
        }
    };

    const handleFilesSelected = async (selectedFiles: File[]) => {
        setFiles(selectedFiles);
        // Don't auto-advance or analyze here anymore, let the user click Next
    };

    const loadPolicy = async (policyId: string) => {
        try {
            setIsAnalyzing(true);

            // 1. Fetch policy details
            const { data: policy, error } = await supabase
                .from("policies")
                .select("*")
                .eq("id", policyId)
                .single();

            if (error || !policy) throw new Error("Policy not found");

            // Set default title immediately, but let user choose category
            setCourseData(prev => ({
                ...prev,
                title: policy.title
            }));

            // Start at Step 1 (Category) as requested
            setStep(1);

            // 2. Fetch file content
            const response = await fetch(policy.file_url);
            const blob = await response.blob();
            const file = new File([blob], policy.file_name, { type: blob.type });

            // Update files state so it shows in Step 2
            setFiles([file]);

            // Note: We do NOT trigger analysis here. 
            // The user will click "Next" on Step 2 to trigger it.

        } catch (error) {
            console.error("Error loading policy:", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Validation for Next button
    const canProceed = () => {
        if (step === 1) return !!courseData.category;
        if (step === 2) return files.length > 0 && !isAnalyzing;
        if (step === 3) return !!courseData.title;
        return true;
    };

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Wizard Header */}
            <div className="border-b border-gray-200 px-8 py-4 flex items-center justify-between bg-white">
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 text-indigo-600">
                        <Hexagon size={24} weight="fill" />
                        <span className="text-lg font-bold text-slate-900">Theraptly</span>
                    </div>
                    <div className="h-6 w-px bg-gray-300"></div>
                    <div className="text-sm font-medium text-slate-600">Step {step} of {totalSteps}</div>
                </div>
                <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    Exit
                </button>
            </div>

            {/* Progress Bar */}
            <div className="h-1 w-full bg-gray-100">
                <div
                    className="h-1 bg-indigo-600 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto bg-white py-12 px-6">
                <div className="max-w-6xl mx-auto h-full">
                    {step === 1 && (
                        <Step1Category
                            value={courseData.category || ""}
                            onChange={(cat) => setCourseData({ ...courseData, category: cat })}
                        />
                    )}
                    {step === 2 && (
                        <Step2Upload
                            files={files}
                            onFilesChange={setFiles}
                            onAnalyze={() => handleFilesSelected(files)}
                            isAnalyzing={isAnalyzing}
                        />
                    )}
                    {step === 3 && (
                        <Step3Details
                            data={courseData}
                            onChange={(data) => setCourseData(data)}
                        />
                    )}
                    {step === 4 && (
                        <Step4Quiz
                            data={courseData.quizConfig || {}}
                            onChange={(config: QuizConfig) => setCourseData({ ...courseData, quizConfig: config })}
                        />
                    )}
                    {step === 5 && (
                        <Step5ReviewContent
                            data={courseData}
                            onNext={handleNext}
                            onBack={handleBack}
                        />
                    )}
                    {step === 6 && (
                        <Step6ReviewQuiz
                            data={courseData.quizConfig || {}}
                            onNext={handleNext}
                            onBack={handleBack}
                        />
                    )}
                    {step === 7 && (
                        <Step7Finalize
                            onPublish={() => onComplete(courseData, files)}
                            onBack={handleBack}
                        />
                    )}
                </div>
            </div>

            {/* Footer Navigation - Hide for Step 5, 6, 7 as they have their own nav or specific layout */}
            {step < 5 && (
                <div className="border-t border-gray-200 p-6 bg-white">
                    <div className="max-w-3xl mx-auto flex justify-between">
                        <button
                            onClick={handleBack}
                            disabled={step === 1}
                            className="px-6 py-2 rounded-lg border border-gray-300 text-slate-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Back
                        </button>
                        <button
                            onClick={handleNext}
                            disabled={!canProceed()}
                            className="px-8 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
