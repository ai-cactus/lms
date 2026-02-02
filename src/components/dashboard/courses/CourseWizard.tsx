'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './CourseWizard.module.css';
import Step1Category from './steps/Step1Category';
import Step2Documents from './steps/Step2Documents';
import Step5Review from './steps/Step5Review';
import Logo from '@/components/ui/Logo';

interface Document {
    id: string;
    name: string;
    type: 'pdf' | 'docx';
    status: 'analyzed';
    selected: boolean;
}

export default function CourseWizard() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false); // Track generation state
    const totalSteps = 7;

    // ... (formData state remains same)

    // ... (documents state remains same)

    // ... (handleToggleSelect remains same)

    const handleNext = () => {
        if (currentStep < totalSteps) {
            // If entering Step 5, set generating mode
            if (currentStep === 4) {
                setIsGenerating(true);
            }
            setCurrentStep(currentStep + 1);
        } else {
            // Submit
            console.log('Wizard Completed', formData);
        }
    };

    // ... (handleBack remains same)

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
                        onReady={() => setIsGenerating(false)}
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
                    <div className={styles.footer}>
                        <button className={styles.btnBack} onClick={handleBack}>
                            Back
                        </button>
                        <button
                            className={`${styles.btnNext} ${!isNextDisabled() ? styles.btnNextEnabled : ''}`}
                            onClick={handleNext}
                            disabled={isNextDisabled()}
                        >
                            Next
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}
