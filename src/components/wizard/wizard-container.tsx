"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Hexagon } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";
import { useNotification } from "@/contexts/notification-context";
import { courseDraftManager, CourseDraft } from "@/lib/course-draft";
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
    initialDraft?: CourseDraft;
    forceNewDraft?: boolean;
}

export function WizardContainer({ onClose, onComplete, initialPolicyIds, initialDraft, forceNewDraft }: WizardContainerProps) {
    const [step, setStep] = useState(1);
    const [courseData, setCourseData] = useState<CourseData>({});
    const [files, setFiles] = useState<File[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGeneratingCourse, setIsGeneratingCourse] = useState(false);
    const [showProgressScreen, setShowProgressScreen] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isDraftLoaded, setIsDraftLoaded] = useState(false);
    const [showDraftRecovery, setShowDraftRecovery] = useState(false);
    const [availableDraft, setAvailableDraft] = useState<CourseDraft | null>(null);
    const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);
    const supabase = createClient();
    const { fetchJson } = useFetchWithRetry();
    const { showNotification } = useNotification();
    const hasUnsavedChanges = useRef(false);

    const totalSteps = 7;
    const progress = (step / totalSteps) * 100;

    useEffect(() => {
        if (initialDraft) {
            // Load provided draft directly
            loadDraftData(initialDraft);
        } else if (initialPolicyIds && initialPolicyIds.length > 0) {
            loadPolicies(initialPolicyIds);
        } else if (forceNewDraft) {
            // Force create a new draft (don't check for existing ones)
            courseDraftManager.createNewDraft();
            setIsDraftLoaded(true);
        } else {
            // Check for existing draft on component mount (for page refresh recovery)
            checkForExistingDraft();
        }
    }, [initialPolicyIds, initialDraft, forceNewDraft]);

    // Auto-save effect
    useEffect(() => {
        if (isDraftLoaded && (step > 1 || Object.keys(courseData).length > 0 || files.length > 0)) {
            hasUnsavedChanges.current = true;
            
            // Start auto-save
            courseDraftManager.startAutoSave(() => ({
                step,
                courseData,
                files
            }), 30000); // Auto-save every 30 seconds

            return () => {
                courseDraftManager.stopAutoSave();
            };
        }
    }, [step, courseData, files, isDraftLoaded]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            courseDraftManager.cleanup();
        };
    }, []);

    // Handle beforeunload (page refresh/close)
    useEffect(() => {
        const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
            if (hasUnsavedChanges.current && (step > 1 || Object.keys(courseData).length > 0 || files.length > 0)) {
                // Save draft before page unload
                await saveDraftNow();
                
                // Show browser confirmation dialog
                event.preventDefault();
                event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return event.returnValue;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [step, courseData, files]);

    // Draft management functions
    const checkForExistingDraft = async () => {
        try {
            const result = await courseDraftManager.loadDraft();
            if (result.success && result.draft) {
                setAvailableDraft(result.draft);
                setShowDraftRecovery(true);
            } else {
                setIsDraftLoaded(true);
            }
        } catch (error) {
            console.error('Error checking for draft:', error);
            setIsDraftLoaded(true);
        }
    };

    const loadDraftData = async (draft: CourseDraft) => {
        try {
            // Restore course data
            setCourseData(draft.course_data);
            setStep(draft.step);
            
            // Restore files
            const restoredFiles = await courseDraftManager.restoreFilesFromDraft(draft.files_data);
            setFiles(restoredFiles);
            
            // Set draft as current
            courseDraftManager.setCurrentDraftId(draft.id);
            setIsDraftLoaded(true);
            setShowDraftRecovery(false);
            setLastSaveTime(new Date(draft.updated_at));
            
            showNotification('success', 'Draft loaded successfully!');
        } catch (error) {
            console.error('Error loading draft:', error);
            showNotification('error', 'Failed to load draft');
            setIsDraftLoaded(true);
        }
    };

    const saveDraftNow = async () => {
        try {
            const result = await courseDraftManager.saveDraft({
                step,
                courseData,
                files
            });
            
            if (result.success) {
                setLastSaveTime(new Date());
                hasUnsavedChanges.current = false;
                return true;
            } else {
                console.error('Failed to save draft:', result.error);
                return false;
            }
        } catch (error) {
            console.error('Error saving draft:', error);
            return false;
        }
    };

    const deleteDraft = async () => {
        try {
            const result = await courseDraftManager.deleteDraft();
            if (result.success) {
                hasUnsavedChanges.current = false;
                setLastSaveTime(null);
            }
        } catch (error) {
            console.error('Error deleting draft:', error);
        }
    };

    const handleClose = async () => {
        if (hasUnsavedChanges.current && (step > 1 || Object.keys(courseData).length > 0 || files.length > 0)) {
            // Save as draft before closing with timeout
            try {
                const savePromise = saveDraftNow();
                const timeoutPromise = new Promise<boolean>((_, reject) => 
                    setTimeout(() => reject(new Error('Save timeout')), 5000)
                );
                
                const saved = await Promise.race([savePromise, timeoutPromise]);
                if (saved) {
                    showNotification('success', 'Progress saved as draft');
                }
            } catch (error) {
                console.warn('Failed to save draft on exit:', error);
                // Continue with exit even if save fails
                showNotification('warning', 'Could not save progress, but exiting anyway');
            }
        }
        onClose();
    };

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
            
            // Show more specific error messages based on the error type
            let errorMessage = error.message || "Failed to analyze documents. Please try again.";
            
            if (error.message?.includes("File validation failed")) {
                errorMessage = error.message; // Show the detailed validation errors
            } else if (error.message?.includes("size too large")) {
                errorMessage = error.message; // Show the size limit message
            } else if (error.message?.includes("API key was reported as leaked")) {
                errorMessage = "🔑 API Key Security Issue: The AI service API key has been flagged for security reasons. Please contact your administrator to update the configuration with a new API key.";
            } else if (error.message?.includes("API key") || error.message?.includes("authentication")) {
                errorMessage = "🔐 Authentication Error: There's an issue with the AI service configuration. Please contact your administrator.";
            } else if (error.message?.includes("403") || error.message?.includes("access denied")) {
                errorMessage = "🚫 Access Denied: The AI service is not properly configured. Please contact your administrator.";
            } else if (error.message?.includes("rate limit") || error.message?.includes("429")) {
                errorMessage = "⏱️ AI service is busy. Please try again in a few minutes.";
            } else if (error.message?.includes("quota")) {
                errorMessage = "📊 AI service quota exceeded. Please try again later or reduce document size.";
            }
            
            showNotification("error", errorMessage);
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
            
            // Show more specific error messages
            let errorMessage = error.message || "Failed to generate course content. Please try again.";
            
            if (error.message?.includes("API key was reported as leaked")) {
                errorMessage = "🔑 API Key Security Issue: The AI service API key has been flagged for security reasons. Please contact your administrator to update the configuration with a new API key.";
            } else if (error.message?.includes("API key") || error.message?.includes("authentication")) {
                errorMessage = "🔐 Authentication Error: There's an issue with the AI service configuration. Please contact your administrator.";
            } else if (error.message?.includes("403") || error.message?.includes("access denied")) {
                errorMessage = "🚫 Access Denied: The AI service is not properly configured. Please contact your administrator.";
            } else if (error.message?.includes("rate limit") || error.message?.includes("429")) {
                errorMessage = "⏱️ AI service is busy. Please try again in a few minutes.";
            } else if (error.message?.includes("quota")) {
                errorMessage = "📊 AI service quota exceeded. Please try again later or reduce document size.";
            } else if (error.message?.includes("timeout")) {
                errorMessage = "⏰ Document processing timed out. Please try with a smaller document.";
            } else if (error.message?.includes("too large")) {
                errorMessage = "📄 Document is too large for processing. Please split into smaller documents.";
            }
            
            showNotification("error", errorMessage);
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
            // Delete draft after successful course creation
            await deleteDraft();
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
                    <div className="flex items-center gap-3">
                        <div className="text-blue-600">
                            <svg width="28" height="28" viewBox="0 0 33 33" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <g clipPath="url(#clip0_11899_3653)">
                                    <path fillRule="evenodd" clipRule="evenodd" d="M11.0669 0.406494C9.24613 0.406494 7.49998 1.11215 6.21251 2.36822L0 8.42917V11.2035C0 13.1635 0.862979 14.9269 2.23847 16.1517C0.862979 17.3766 0 19.14 0 21.1V23.8743L6.21251 29.9353C7.49998 31.1914 9.24613 31.897 11.0669 31.897C13.076 31.897 14.8834 31.0551 16.1389 29.7131C17.3943 31.0551 19.2018 31.897 21.2109 31.897C23.0317 31.897 24.7778 31.1914 26.0653 29.9353L32.2778 23.8743V21.1C32.2778 19.14 31.4148 17.3766 30.0393 16.1517C31.4148 14.9269 32.2778 13.1635 32.2778 11.2035V8.42917L26.0653 2.36822C24.7778 1.11215 23.0317 0.406494 21.2109 0.406494C19.2018 0.406494 17.3943 1.24842 16.1389 2.59037C14.8834 1.24842 13.076 0.406494 11.0669 0.406494ZM20.7859 16.1517C20.7085 16.0829 20.6326 16.0121 20.5582 15.9395L16.1389 11.628L11.7196 15.9395C11.6452 16.0121 11.5692 16.0829 11.4919 16.1517C11.5692 16.2206 11.6452 16.2914 11.7196 16.364L16.1389 20.6755L20.5582 16.364C20.6326 16.2914 20.7085 16.2206 20.7859 16.1517ZM17.9321 23.8743V25.1993C17.9321 26.9659 19.4001 28.3981 21.2109 28.3981C22.0804 28.3981 22.9144 28.0611 23.5293 27.4612L28.6914 22.425V21.1C28.6914 19.3334 27.2234 17.9012 25.4126 17.9012C24.5431 17.9012 23.7091 18.2382 23.0942 18.8381L17.9321 23.8743ZM14.3457 23.8743L9.18359 18.8381C8.5687 18.2382 7.73476 17.9012 6.86518 17.9012C5.05437 17.9012 3.58642 19.3334 3.58642 21.1V22.425L8.74849 27.4612C9.36338 28.0611 10.1974 28.3981 11.0669 28.3981C12.8777 28.3981 14.3457 26.9659 14.3457 25.1993V23.8743ZM14.3457 7.10423V8.42917L9.18359 13.4654C8.5687 14.0653 7.73476 14.4023 6.86518 14.4023C5.05437 14.4023 3.58642 12.9701 3.58642 11.2035V9.87852L8.74849 4.84234C9.36338 4.24245 10.1974 3.90544 11.0669 3.90544C12.8777 3.90544 14.3457 5.33758 14.3457 7.10423ZM23.0942 13.4654L17.9321 8.42917V7.10423C17.9321 5.33758 19.4001 3.90544 21.2109 3.90544C22.0804 3.90544 22.9144 4.24245 23.5293 4.84234L28.6914 9.87852V11.2035C28.6914 12.9701 27.2234 14.4023 25.4126 14.4023C24.5431 14.4023 23.7091 14.0653 23.0942 13.4654Z" fill="currentColor"/>
                                </g>
                                <defs>
                                    <clipPath id="clip0_11899_3653">
                                        <rect width="32.2778" height="32.2778" fill="white"/>
                                    </clipPath>
                                </defs>
                            </svg>
                        </div>
                        <span className="text-lg font-bold tracking-tight text-blue-600">Theraptly</span>
                    </div>
                    <div className="h-6 w-px bg-gray-300"></div>
                    <div className="text-sm font-medium text-slate-600">Step {step} of {totalSteps}</div>
                </div>
                <div className="flex items-center gap-4">
                    {lastSaveTime && (
                        <span className="text-xs text-slate-400">
                            Last saved: {lastSaveTime.toLocaleTimeString()}
                        </span>
                    )}
                    <button onClick={handleClose} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                        Exit
                    </button>
                </div>
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
                            onAnalyze={() => performAnalysis(files)}
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

            {/* Draft Recovery Modal */}
            {showDraftRecovery && availableDraft && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-lg max-w-md w-full p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-slate-900">Resume Course Creation?</h3>
                                <p className="text-sm text-slate-500">
                                    Last saved: {new Date(availableDraft.updated_at).toLocaleString()}
                                </p>
                            </div>
                        </div>
                        
                        <p className="text-slate-600 mb-6">
                            We found a saved draft from your previous session. Would you like to continue where you left off or start fresh?
                        </p>
                        
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowDraftRecovery(false);
                                    setIsDraftLoaded(true);
                                }}
                                className="flex-1 px-4 py-2 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                            >
                                Start Fresh
                            </button>
                            <button
                                onClick={() => loadDraftData(availableDraft)}
                                className="flex-1 px-4 py-2 bg-[#4E61F6] text-white rounded-lg font-medium hover:bg-[#4E61F6]/90 transition-colors"
                            >
                                Resume Draft
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
