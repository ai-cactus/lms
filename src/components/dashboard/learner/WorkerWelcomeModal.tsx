'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from './WorkerWelcomeModal.module.css';
import { Modal } from '@/components/ui';
import { useModalContext } from '@/components/ui/ModalContext';

interface WorkerWelcomeModalProps {
    courseCount: number;
    firstCourseId?: string;
}

export default function WorkerWelcomeModal({ courseCount, firstCourseId }: WorkerWelcomeModalProps) {
    const { registerModal, unregisterModal, requestOpen, isModalOpen, dismissModal, shouldShowModal } = useModalContext();
    const modalId = 'workerWelcome';

    const [hasMounted, setHasMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setHasMounted(true);
        // Register with lower priority (5) than OrganizationActivation (10)
        registerModal(modalId, 5);

        // Check if we should show it
        if (courseCount > 0 && shouldShowModal(modalId)) {
            // Also check legacy local storage if needed, but ModalContext handles its own keys
            // If we want to migrate legacy key:
            const legacySeen = localStorage.getItem('workerWelcomeSeen');
            if (!legacySeen) {
                requestOpen(modalId);
            } else {
                // Migrate to new system if we want, or just respect legacy by not requesting
            }
        }

        return () => unregisterModal(modalId);
    }, [courseCount, registerModal, unregisterModal, requestOpen, shouldShowModal, modalId]);

    const handleClose = () => {
        // Dismiss forever when closed
        dismissModal(modalId, -1);
        localStorage.setItem('workerWelcomeSeen', 'true'); // Keep legacy key for safety
    };

    const handleStart = () => {
        handleClose();
        if (firstCourseId) {
            router.push(`/learn/${firstCourseId}`);
        }
    };

    const isOpen = isModalOpen(modalId);

    if (!hasMounted || !isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            size="lg"
            className={styles.modalParams}
            showCloseButton={false} // We have a custom close button in design or we can use the default. 
        // The original had a custom close button. Let's use the default one for consistency or keep custom if it needed specific styling.
        // effectively, the design has a close button top right. The new Modal has one too.
        >
            <div className={styles.container}>
                {/* Left Panel */}
                <div className={styles.leftPanel}>
                    <div className={styles.blob} />
                    {/* Illustration */}
                    <div className={styles.illustration}>
                        <Image
                            src="/images/onboarding-welcome.png"
                            alt="Welcome"
                            width={280}
                            height={280}
                            style={{ objectFit: 'contain' }}
                            priority
                        />
                    </div>

                    <h2 className={styles.welcomeTitle}>Your first training<br />course awaits you</h2>

                    <p className={styles.welcomeText}>
                        Join professionals learning with Theraply in a clear, accessible, and supportive way.
                    </p>

                    <button className={styles.startButton} onClick={handleStart}>
                        Start your first course
                    </button>
                </div>

                {/* Right Panel */}
                <div className={styles.rightPanel}>
                    <button className={styles.closeButton} onClick={handleClose}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>

                    <h3 className={styles.stepsTitle}>How to get started</h3>

                    <div className={styles.stepsList}>
                        <div className={styles.stepItem}>
                            <div className={styles.stepNumber}>1.</div>
                            <div className={styles.stepContent}>
                                <div className={styles.stepHeading}>Log In to Your Dashboard</div>
                                <div className={styles.stepDesc}>Access your assigned courses in one place, right from your computer or phone.</div>
                            </div>
                        </div>

                        <div className={styles.stepItem}>
                            <div className={styles.stepNumber}>2.</div>
                            <div className={styles.stepContent}>
                                <div className={styles.stepHeading}>Complete your Courses and take quizzes.</div>
                                <div className={styles.stepDesc}>Training includes courses and quizzes. Access your assigned courses in one place, right from your computer or phone.</div>
                            </div>
                        </div>

                        <div className={styles.stepItem}>
                            <div className={styles.stepNumber}>3.</div>
                            <div className={styles.stepContent}>
                                <div className={styles.stepHeading}>Earn Your Certificate</div>
                                <div className={styles.stepDesc}>Pass your training and instantly get a certificate you can use to prove compliance.</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
