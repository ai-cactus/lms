'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './CourseWizard.module.css';
import Step1Category from './steps/Step1Category';
import Step2Documents from './steps/Step2Documents';
import Step3Details from './steps/Step3Details';
import Step4Quiz from './steps/Step4Quiz';
import Step5Review from './steps/Step5Review';
import Step6QuizReview from './steps/Step6QuizReview';
import Step7Publish from './steps/Step7Publish';
import Logo from '@/components/ui/Logo';
import { createFullCourse } from '@/app/actions/course';

interface Document {
    id: string;
    name: string;
    type: 'pdf' | 'docx';
    status: 'analyzed';
    selected: boolean;
    file?: File; // Store the actual file object
}

export default function CourseWizard() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false); // Track generation state
    const totalSteps = 7;

    // Form Data
    const [formData, setFormData] = useState({
        category: '',
        title: 'HIPAA Privacy and Security Training',
        description: 'This course provides essential training on the HIPAA Privacy and Security Rules, helping healthcare professionals understand how to safeguard Protected Health Information (PHI).',
        difficulty: 'moderate', // default fallback if needed by DB, or remove if unused
        duration: '60',
        notesCount: '5',
        objectives: [
            'To train staff on HIPAA compliance in behavioral health.',
            'Learn how to handle PHI securely',
            'Understand HIPAA privacy rules'
        ],
        // Step 4 Quiz Data
        quizTitle: 'HIPAA Privacy and Security Quiz',
        quizQuestionCount: '15',
        quizDifficulty: 'moderate',
        quizQuestionType: 'multiple_choice',
        quizDuration: '15',
        quizPassMark: '80%',
        quizAttempts: '2',
        // Step 7 Publish Data
        assignments: [],
        dueDate: '',
        dueTime: ''
    });

    // Documents State
    const [documents, setDocuments] = useState<Document[]>([]);

    const handleToggleSelect = (id: string) => {
        setDocuments(docs => docs.map(doc =>
            doc.id === id ? { ...doc, selected: !doc.selected } : doc
        ));
    };

    const [generatedContent, setGeneratedContent] = useState<any>(null);

    const handleGenerationComplete = (content: any) => {
        setGeneratedContent(content);
        setIsGenerating(false);
    };


    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState<string | null>(null);

    const handleNext = async () => {
        if (currentStep < totalSteps) {
            // If entering Step 5, set generating mode
            if (currentStep === 4) {
                setIsGenerating(true);
            }
            setCurrentStep(currentStep + 1);
        } else {
            // Validate before submit
            if (!formData.title?.trim()) {
                setPublishError('Please enter a course title');
                return;
            }
            if (!generatedContent?.modules || generatedContent.modules.length === 0) {
                setPublishError('No course content generated. Please go back to Step 5.');
                return;
            }

            // Submit
            setIsPublishing(true);
            setPublishError(null);

            try {
                const result = await createFullCourse({
                    title: formData.title,
                    description: formData.description,
                    category: formData.category,
                    difficulty: formData.difficulty,
                    duration: formData.duration,
                    modules: generatedContent?.modules || [],
                    quiz: generatedContent?.quiz || [],
                    assignments: formData.assignments || [],
                    dueDate: formData.dueDate ? new Date(formData.dueDate) : undefined,
                    dueTime: formData.dueTime,
                    // Quiz settings from Step 4
                    quizTitle: formData.quizTitle,
                    quizPassMark: formData.quizPassMark,
                    quizQuestionType: formData.quizQuestionType,
                    quizAttempts: formData.quizAttempts,
                    quizDuration: formData.quizDuration,
                    quizDifficulty: formData.quizDifficulty
                });

                if (result.success) {
                    console.log('Course Created:', result.courseId);
                    console.log('Invite Results:', result.inviteResults);

                    // Log any issues for debugging
                    if (result.inviteResults?.failed?.length > 0) {
                        console.warn('Failed to invite:', result.inviteResults.failed);
                    }
                    if (result.inviteResults?.skipped?.length > 0) {
                        console.warn('Skipped (invalid or in other org):', result.inviteResults.skipped);
                    }

                    router.push('/dashboard/training');
                } else {
                    setPublishError('Failed to create course. Please try again.');
                }
            } catch (error) {
                console.error('Error submitting course:', error);
                setPublishError('An unexpected error occurred. Please try again.');
            } finally {
                setIsPublishing(false);
            }
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        } else {
            router.back();
        }
    };

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const handleUpload = async (files: File[]) => {
        setUploadError(null); // Clear previous errors

        // Enforce single file - take only the first one
        const file = files[0];
        if (!file) return;

        const newDoc: Document = {
            id: `new-${Date.now()}`,
            name: file.name,
            type: file.name.endsWith('.pdf') ? 'pdf' : 'docx',
            status: 'analyzed',
            selected: true,
            file: file
        };

        // Replace existing documents with the new single file
        setDocuments([newDoc]);

        // Start Analysis immediately
        setIsAnalyzing(true);
        setAnalysisProgress(10); // Start progress

        // Simulate progress for UX while waiting
        const progressInterval = setInterval(() => {
            setAnalysisProgress(prev => {
                if (prev >= 90) {
                    clearInterval(progressInterval);
                    return 90;
                }
                return prev + 10;
            });
        }, 500);

        try {
            // Import dynamically to avoid server-side issues if any
            const { analyzeDocument } = await import('@/app/actions/course-ai');

            const formData = new FormData();
            formData.append('file', file);

            const result = await analyzeDocument(formData);

            clearInterval(progressInterval);
            setAnalysisProgress(100);

            if (result.error) {
                console.error("Analysis Error:", result.error);
                setUploadError(result.error);
                setDocuments([]); // Remove the failed file
            } else {
                // Populate Step 3 Data
                setFormData(prev => ({
                    ...prev,
                    title: result.title,
                    description: result.description,
                    objectives: result.objectives,
                    duration: result.duration,
                    quizTitle: result.quizTitle
                }));
            }
        } catch (err: any) {
            console.error("Analysis Failed:", err);
            clearInterval(progressInterval);
            setUploadError(`Analysis failed: ${err.message || "Unknown error"}. Please try a different file.`);
            setDocuments([]); // Reset on error
        } finally {
            setTimeout(() => {
                setIsAnalyzing(false);
                setAnalysisProgress(0);
            }, 500);
        }
    };

    const renderStep = () => {
        switch (currentStep) {
            case 1:
                return (
                    <Step1Category
                        value={formData.category}
                        onChange={(val) => setFormData({ ...formData, category: val })}
                    />
                );
            case 2:
                return (
                    <Step2Documents
                        documents={documents}
                        onToggleSelect={handleToggleSelect}
                        onUpload={handleUpload}
                        isAnalyzing={isAnalyzing}
                        progress={analysisProgress}
                        error={uploadError}
                    />
                );
            case 3:
                return (
                    <Step3Details
                        data={formData}
                        onChange={(field, val) => setFormData({ ...formData, [field]: val })}
                    />
                );
            case 4:
                return (
                    <Step4Quiz
                        data={formData}
                        onChange={(field, val) => setFormData({ ...formData, [field]: val })}
                    />
                );
            case 5:
                return (
                    <Step5Review
                        data={formData}
                        documents={documents}
                        onComplete={handleGenerationComplete}
                    />
                );
            case 6:
                return (
                    <Step6QuizReview
                        data={formData}
                        quiz={generatedContent?.quiz}
                    />
                );
            case 7:
                return (
                    <Step7Publish
                        data={formData}
                        onChange={(field, val) => setFormData(prev => ({ ...prev, [field]: val }))}
                    />
                );
            default:
                return <div>Step {currentStep} Content</div>;
        }
    };

    const isNextDisabled = () => {
        if (currentStep === 1 && !formData.category) return true;
        if (currentStep === 2 && !documents.some(d => d.selected)) return true;
        if (currentStep === 3 && !formData.title) return true;
        if (currentStep === 4 && !formData.quizTitle) return true;
        // Step 7 validation optional? Or mandatory? Assuming optional for now unless specified.
        return false;
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.logoSection}>
                    <Logo variant="blue" size="md" />
                </div>

                <div className={styles.headerContent}>
                    <span className={styles.stepText}>Step {currentStep} of {totalSteps}</span>
                    <button className={styles.exitButton} onClick={() => router.push('/dashboard/courses')}>
                        Exit
                    </button>
                </div>
                {/* Dynamic Progress Bar */}
                <div
                    className={styles.progressBar}
                    style={{ width: `${(currentStep / totalSteps) * 100}%` }}
                />
            </header>

            {/* Main Content */}
            <main className={styles.content}>
                {renderStep()}

                {/* Hide footer during generation phase of Step 5 */}
                {(!isGenerating || currentStep !== 5) && (
                    <div className={`${styles.footer} ${currentStep === 5 ? styles.footerWide : ''}`}>
                        {publishError && (
                            <div className={styles.errorMessage}>{publishError}</div>
                        )}
                        <div className={styles.footerButtons}>
                            <button className={styles.btnBack} onClick={handleBack} disabled={isPublishing}>
                                Back
                            </button>
                            <button
                                className={`${styles.btnNext} ${!isNextDisabled() && !isPublishing ? styles.btnNextEnabled : ''}`}
                                onClick={handleNext}
                                disabled={isNextDisabled() || isPublishing}
                            >
                                {isPublishing ? 'Publishing...' : currentStep === totalSteps ? 'Publish' : 'Next'}
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
