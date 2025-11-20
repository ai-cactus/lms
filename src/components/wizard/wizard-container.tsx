"use client";

import { useState } from "react";
import { Hexagon } from "@phosphor-icons/react";
import { Step1Category } from "./step-1-category";
import { Step2Upload } from "./step-2-upload";
import { Step3Details } from "./step-3-details";
import { Step4Quiz } from "./step-4-quiz";
import { CourseData, QuizConfig } from "@/types/course";

interface WizardContainerProps {
    onClose: () => void;
    onComplete: (courseData: CourseData, files: File[]) => void;
}

export function WizardContainer({ onClose, onComplete }: WizardContainerProps) {
    const [step, setStep] = useState(1);
    const [courseData, setCourseData] = useState<CourseData>({});
    const [files, setFiles] = useState<File[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const totalSteps = 4;
    const progress = (step / totalSteps) * 100;

    const handleNext = () => {
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
        setIsAnalyzing(true);

        try {
            // 1. Read files
            const fileContents = await Promise.all(
                selectedFiles.map(async (file) => {
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
            setStep(3);
        } catch (error) {
            console.error("Error analyzing files:", error);
            alert("Failed to analyze documents. Please try again.");
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
                <div className="max-w-4xl mx-auto">
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
                </div>
            </div>

            {/* Footer Navigation */}
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
                        {step === totalSteps ? "Generate Course" : "Next"}
                    </button>
                </div>
            </div>
        </div>
    );
}
