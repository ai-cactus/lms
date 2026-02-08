import React from 'react';
import styles from '@/app/onboarding/onboarding.module.css';

const steps = [
    { id: 1, label: 'Org details' },
    { id: 2, label: 'Credentialing' },
    { id: 3, label: 'Services' },
    { id: 4, label: 'Invite Team' },
    { id: 5, label: 'Invite Workers' }
];

interface StepperProps {
    currentStep: number;
}

export default function Stepper({ currentStep }: StepperProps) {
    return (
        <div className={styles.stepper}>
            {/* Background Line */}
            <div className={styles.connector}>
                <div
                    style={{
                        height: '100%',
                        background: '#4C6EF5',
                        width: `${(currentStep - 1) / (steps.length - 1) * 100}%`,
                        transition: 'width 0.3s ease'
                    }}
                />
            </div>

            {steps.map((step) => {
                const isActive = step.id === currentStep;
                const isCompleted = step.id < currentStep;

                return (
                    <div
                        key={step.id}
                        className={`${styles.step} ${isActive ? styles.active : ''} ${isCompleted ? styles.completed : ''}`}
                    >
                        <div className={styles.stepCircle}>
                            {isCompleted ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            ) : (
                                step.id
                            )}
                        </div>
                        <span className={styles.stepLabel}>{step.label}</span>
                    </div>
                );
            })}
        </div>
    );
}
