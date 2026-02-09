'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './DashboardEmptyState.module.css';

interface DashboardEmptyStateProps {
    isOpen: boolean;
    onClose?: () => void;
}

export default function DashboardEmptyState({ isOpen: initialIsOpen, onClose }: DashboardEmptyStateProps) {
    const [isOpen, setIsOpen] = useState(initialIsOpen);

    useEffect(() => {
        setIsOpen(initialIsOpen);
    }, [initialIsOpen]);

    const handleClose = () => {
        setIsOpen(false);
        if (onClose) onClose();
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <button className={styles.closeButton} onClick={handleClose}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                <div className={styles.content}>
                    {/* Left Side - Illustration */}
                    <div className={styles.illustrationSection}>
                        {/* Placeholder Illustration - In alignment with design (Green Theme) */}
                        <div style={{ marginBottom: '32px' }}>
                            <svg width="200" height="180" viewBox="0 0 200 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="40" y="60" width="120" height="100" rx="8" fill="white" stroke="#10B981" strokeWidth="2" />
                                <rect x="55" y="80" width="90" height="8" rx="4" fill="#D1FAE5" />
                                <rect x="55" y="100" width="60" height="8" rx="4" fill="#D1FAE5" />
                                <circle cx="100" cy="50" r="30" fill="#10B981" />
                                <path d="M90 50 L98 58 L114 42" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M20 140 L40 140" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
                                <path d="M160 90 L180 90" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
                                <path d="M150 150 L170 150" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
                                {/* Simple People Representation */}
                                <circle cx="60" cy="140" r="15" fill="#34D399" />
                                <circle cx="140" cy="140" r="15" fill="#34D399" />
                                <rect x="50" y="155" width="20" height="25" rx="5" fill="#34D399" />
                                <rect x="130" y="155" width="20" height="25" rx="5" fill="#34D399" />
                            </svg>
                        </div>

                        <h2 className={styles.illustrationTitle}>
                            Turn Your Healthcare Policies <br />into Interactive Training in <br />Minutes.
                        </h2>
                        <p className={styles.illustrationText}>
                            Operationalize your policies and procedures <br />by training your staff
                        </p>

                        <Link href="/dashboard/courses/create" className={styles.ctaButton} onClick={handleClose}>
                            Create your first course
                        </Link>
                    </div>

                    {/* Right Side - Steps Checklist */}
                    <div className={styles.checklistSection}>
                        <h3 className={styles.checklistTitle}>How to get started</h3>

                        <div className={styles.stepsList}>
                            <div className={styles.stepItem}>
                                <span className={styles.stepNumber}>1.</span>
                                <div className={styles.stepContent}>
                                    <div className={styles.stepTitle}>Select Type of Training</div>
                                    <div className={styles.stepDescription}>
                                        Choose whether the training is based on compliance, safety, HR, or any internal policy area.
                                    </div>
                                </div>
                            </div>

                            <div className={styles.stepItem}>
                                <span className={styles.stepNumber}>2.</span>
                                <div className={styles.stepContent}>
                                    <div className={styles.stepTitle}>Upload Policies</div>
                                    <div className={styles.stepDescription}>
                                        Upload your organization's documents. Theraptly will analyze and prepare a draft training automatically.
                                    </div>
                                </div>
                            </div>

                            <div className={styles.stepItem}>
                                <span className={styles.stepNumber}>3.</span>
                                <div className={styles.stepContent}>
                                    <div className={styles.stepTitle}>Configure Course & Assessment</div>
                                    <div className={styles.stepDescription}>
                                        Define course structure, quiz settings, difficulty level, and deadlines.
                                    </div>
                                </div>
                            </div>

                            <div className={styles.stepItem}>
                                <span className={styles.stepNumber}>4.</span>
                                <div className={styles.stepContent}>
                                    <div className={styles.stepTitle}>Review & Publish Course</div>
                                    <div className={styles.stepDescription}>
                                        Review AI-generated lessons and quizzes, make adjustments, and approve for publishing. Instantly make your training available for your team to access and complete.
                                    </div>
                                </div>
                            </div>

                            <div className={styles.stepItem}>
                                <span className={styles.stepNumber}>5.</span>
                                <div className={styles.stepContent}>
                                    <div className={styles.stepTitle}>Invite Workers to Course</div>
                                    <div className={styles.stepDescription}>
                                        Assign courses to individuals or departments and track progress directly from your dashboard.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
