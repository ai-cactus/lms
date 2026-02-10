'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';
import Image from 'next/image';

export default function WorkerEmptyState() {
    return (
        <div className={styles.emptyStateCard}>
            {/* Left Panel */}
            <div className={styles.leftPanel}>
                <div className={styles.blob} />
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

                <button className={styles.startButton} onClick={() => {
                    const el = document.getElementById('course-search-input');
                    if (el) el.focus();
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
    );
}
