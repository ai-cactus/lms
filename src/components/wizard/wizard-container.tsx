"use client";

import { useState, useEffect, useCallback } from "react";
import { Hexagon } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";
import { useNotification } from "@/contexts/notification-context";
import { Step1Category } from "./step-1-category";
import { Step2Upload } from "./step-2-upload";
import { Step3Details } from "./step-3-details";
import { Step4Quiz } from "./step-4-quiz";
import { Step5ReviewContent } from "./step-5-review-content";
import { Step6ReviewQuiz } from "./step-6-review-quiz";
import { Step7Finalize } from "./step-7-finalize";
import { CourseCreationProgress } from "./course-creation-progress";
import { CourseData, QuizConfig } from "@/types/course";

interface WizardContainerProps {
    onClose: () => void;
    onComplete: (courseData: CourseData, files: File[], publishOptions?: {
        deadline?: { dueDate: string; dueTime: string };
        assignType: string;
        selectedRoles?: string[];
        emails?: string[];
    }) => void;
    initialPolicyIds?: string[];
}

export function WizardContainer({ onClose, onComplete, initialPolicyIds }: WizardContainerProps) {
    const [step, setStep] = useState(1);
    const [courseData, setCourseData] = useState<CourseData>({});
    const [files, setFiles] = useState<File[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGeneratingCourse, setIsGeneratingCourse] = useState(false);
    const [showProgressScreen, setShowProgressScreen] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isPublishing, setIsPublishing] = useState(false); // Added state
    const supabase = createClient();
    const { fetchJson } = useFetchWithRetry();
    const { showNotification } = useNotification();

    const totalSteps = 7;
    const progress = (step / totalSteps) * 100;

    useEffect(() => {
        if (initialPolicyIds && initialPolicyIds.length > 0) {
            loadPolicies(initialPolicyIds);
        }
    }, [initialPolicyIds]);

    const handleQuestionsChange = useCallback((questions: any[]) => {
        setCourseData((prev) => {
            return { ...prev, questions };
        });
    }, []);

    const performAnalysis = async (filesToAnalyze: File[]) => {
        setIsAnalyzing(true);
        setUploadProgress(10); // Started reading
        try {
            // 1. Process files client-side (Extract text)
            // Dynamic import to avoid SSR issues with the client-side processing
            const { processFileClientSide } = await import("@/lib/client-file-processing");

            const fileContents = await Promise.all(
                filesToAnalyze.map(async (file) => {
                    return await processFileClientSide(file);
                })
            );

            setUploadProgress(40); // Files processed, starting upload/analysis

            // Simulate progress for better UX since we can't track fetch upload easily
            const progressInterval = setInterval(() => {
                setUploadProgress(prev => {
                    if (prev >= 90) {
                        clearInterval(progressInterval);
                        return 90;
                    }
                    return prev + 5;
                });
            }, 500);

            // 2. Analyze documents with automatic retry
            // We send the extracted content directly
            const { metadata } = await fetchJson("/api/analyze-documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: fileContents }),
            });

            clearInterval(progressInterval);
            setUploadProgress(100);

            // Preserve the user-selected category from Step 1
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { category, ...restMetadata } = metadata;
            setCourseData((prev) => ({ ...prev, ...restMetadata }));
            return true;
        } catch (error: any) {
            console.error("Error analyzing files:", error);
            showNotification("error", error.message || "Failed to analyze documents. Please try again.");
            setUploadProgress(0);
            return false;
        } finally {
            setIsAnalyzing(false);
        }
    };

    const generateCourseContent = async () => {
        setIsGeneratingCourse(true);
        try {
            // Read files
            const fileContents = await Promise.all(
                files.map(async (file) => {
                    const text = await file.text();
                    return {
                        name: file.name,
                        type: file.type,
                        content: text,
                    };
                })
            );

            // Generate course content with automatic retry
            const { content } = await fetchJson("/api/generate-course", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    files: fileContents,
                    courseMetadata: {
                        title: courseData.title,
                        description: courseData.description,
                        objectives: courseData.objectives,
                        category: courseData.category,
                        difficulty: courseData.difficulty,
                        duration: courseData.duration,
                        complianceMapping: courseData.complianceMapping,
                    },
                }),
            });

            setCourseData((prev) => ({ ...prev, generatedContent: content }));
            return true;
        } catch (error: any) {
            console.error("Error generating course content:", error);
            showNotification("error", error.message || "Failed to generate course content. Please try again.");
            return false;
        } finally {
            setIsGeneratingCourse(false);
        }
    };

    const handleNext = async () => {
        if (step === 2) {
            // Analysis is now done automatically. 
            // If still analyzing, we shouldn't be here because button is disabled.
            // Just proceed.
        }

        if (step === 4) {
            // On Step 4, show progress screen and generate course content
            if (!courseData.generatedContent) {
                setShowProgressScreen(true);
                const success = await generateCourseContent();
                if (!success) {
                    setShowProgressScreen(false);
                    return;
                }
                // Progress screen will auto-close and move to next step
                return;
            }
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
        if (selectedFiles.length > 0) {
            await performAnalysis(selectedFiles);
        } else {
            setUploadProgress(0);
        }
    };

    const loadPolicies = async (policyIds: string[]) => {
        try {
            setIsAnalyzing(true);

            // 1. Fetch policies details
            const { data: policies, error } = await supabase
                .from("policies")
                .select("*")
                .in("id", policyIds);

            if (error || !policies || policies.length === 0) throw new Error("Policies not found");

            // Set default title from the first policy, but let user choose category
            setCourseData(prev => ({
                ...prev,
                title: policies[0].title + (policies.length > 1 ? " (and others)" : "")
            }));

            // Start at Step 1 (Category) as requested
            setStep(1);

            // 2. Fetch file contents
            const loadedFiles = await Promise.all(policies.map(async (policy) => {
                const response = await fetch(policy.file_url);
                const blob = await response.blob();
                return new File([blob], policy.file_name, { type: blob.type });
            }));

            // Update files state so it shows in Step 2
            setFiles(loadedFiles);

            // Note: We do NOT trigger analysis here. 
            // The user will click "Next" on Step 2 to trigger it.

        } catch (error) {
            console.error("Error loading policies:", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Validation for Next button
    const canProceed = () => {
        if (step === 1) return !!courseData.category;
        if (step === 2) return files.length > 0 && !isAnalyzing && uploadProgress === 100;
        if (step === 3) return !!courseData.title;
        return true;
    };

    // Show progress screen during course generation
    if (showProgressScreen) {
        return (
            <CourseCreationProgress
                onComplete={() => {
                    setShowProgressScreen(false);
                    setStep(5); // Move to review content step
                }}
            />
        );
    }

    const handlePublish = async (data: any) => {
        if (isPublishing) return;
        setIsPublishing(true);
        try {
            await onComplete(courseData, files, data);
        } catch (error) {
            console.error("Publishing failed:", error);
            setIsPublishing(false);
        }
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
                            onFilesChange={handleFilesSelected}
                            onAnalyze={() => { }} // No longer needed as manual trigger
                            isAnalyzing={isAnalyzing}
                            uploadProgress={uploadProgress}
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
                            courseTitle={courseData.title || ""}
                            onChange={(config: QuizConfig) => setCourseData({ ...courseData, quizConfig: config })}
                        />
                    )}
                    {step === 5 && (
                        <Step5ReviewContent
                            data={courseData}
                            onNext={handleNext}
                            onBack={handleBack}
                            isGenerating={isGeneratingCourse}
                        />
                    )}
                    {step === 6 && (
                        <Step6ReviewQuiz
                            data={courseData.quizConfig || {}}
                            onNext={handleNext}
                            onBack={handleBack}
                            courseContent={courseData.generatedContent}
                            courseDifficulty={courseData.difficulty}
                            onQuestionsChange={handleQuestionsChange}
                        />
                    )}
                    {step === 7 && (
                        <Step7Finalize
                            onPublish={handlePublish}
                            onBack={handleBack}
                            isPublishing={isPublishing}
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
