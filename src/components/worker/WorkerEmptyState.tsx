'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';
import Image from 'next/image';

export default function WorkerEmptyState() {
    const [isVisible, setIsVisible] = React.useState(true);

    if (!isVisible) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.emptyStateCard}>
                {/* Close Button */}
                <div className={styles.closeButtonContainer}>
                    <button
                        className={styles.closeButton}
                        onClick={() => setIsVisible(false)}
                        aria-label="Close"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {/* Left Panel */}
                <div className={styles.leftPanel}>
                    <div className={styles.blob} />
                    <div className={styles.illustration}>
                        <Image
                            src="/images/worker-empty-illustration-v2.png"
                            alt="Welcome"
                            width={280}
                            height={280}
                            style={{ objectFit: 'contain' }}
                            priority
                        />
                    </div>

                    <h2 className={styles.welcomeTitle}>Your first training<br />course awaits you</h2>

                    <p className={styles.welcomeText}>
                        Join professionals learning with Theraptly in a clear, accessible, and supportive way.
                    </p>

                    <button className={styles.startButton} onClick={() => {
                        setIsVisible(false); // Close modal on start
                        // Ideally we focus somewhere relevant or navigate
                    }}>
                        Start your first course
                    </button>
                </div>

                {/* Right Panel */}
                <div className={styles.rightPanel}>
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
        </div>
    );
}
