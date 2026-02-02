'use client';

import React from 'react';
import styles from './ShareCourseModal.module.css';
import { enrollUsers } from '@/app/actions/enrollment';

interface ShareCourseModalProps {
    isOpen: boolean;
    onClose: () => void;
    courseId: string;
}

export default function ShareCourseModal({ isOpen, onClose, courseId }: ShareCourseModalProps) {
    const [emails, setEmails] = React.useState<string[]>([]);
    const [inputValue, setInputValue] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);
    const [result, setResult] = React.useState<{ success: string[]; alreadyEnrolled: string[]; notFound: string[] } | null>(null);

    if (!isOpen) return null;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
            e.preventDefault();
            const email = inputValue.trim();
            if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                if (!emails.includes(email)) {
                    setEmails([...emails, email]);
                }
                setInputValue('');
            }
        } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
            setEmails(emails.slice(0, -1));
        }
    };

    const removeEmail = (index: number) => {
        setEmails(emails.filter((_, i) => i !== index));
    };

    const handleShare = async () => {
        if (emails.length === 0) return;

        setIsLoading(true);
        setResult(null);

        try {
            const res = await enrollUsers(courseId, emails);
            setResult(res);

            // Clear successfully enrolled emails
            if (res.success.length > 0) {
                const remainingEmails = emails.filter(e => !res.success.includes(e));
                setEmails(remainingEmails);
            }

            // Auto-close if all successful
            if (res.success.length === emails.length) {
                setTimeout(() => {
                    onClose();
                    setEmails([]);
                    setResult(null);
                }, 1500);
            }
        } catch (error) {
            console.error('Failed to enroll users:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Share this course</h2>
                    <p className={styles.subtitle}>Enter one or more emails to invite to your course.</p>
                </div>

                <div className={styles.inputGroup}>
                    <div className={styles.inputWrapper} onClick={() => document.getElementById('email-input')?.focus()}>
                        <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>

                        {emails.map((email, index) => (
                            <span key={index} className={styles.chip}>
                                {email}
                                <button className={styles.removeChip} onClick={() => removeEmail(index)}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </span>
                        ))}

                        <input
                            id="email-input"
                            className={styles.input}
                            placeholder={emails.length === 0 ? "Emails, comma separated" : ""}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading}
                        />
                    </div>
                    <button
                        className={`${styles.shareButton} ${emails.length > 0 ? styles.shareButtonActive : ''}`}
                        onClick={handleShare}
                        disabled={emails.length === 0 || isLoading}
                    >
                        {isLoading ? 'Sharing...' : 'Share'}
                    </button>
                </div>

                {/* Result feedback */}
                {result && (
                    <div className={styles.resultSection}>
                        {result.success.length > 0 && (
                            <div className={styles.resultSuccess}>
                                ✓ Enrolled: {result.success.join(', ')}
                            </div>
                        )}
                        {result.alreadyEnrolled.length > 0 && (
                            <div className={styles.resultWarning}>
                                Already enrolled: {result.alreadyEnrolled.join(', ')}
                            </div>
                        )}
                        {result.notFound.length > 0 && (
                            <div className={styles.resultError}>
                                User not found: {result.notFound.join(', ')}
                            </div>
                        )}
                    </div>
                )}

                <div className={styles.section}>
                    <div className={styles.toggleRow}>
                        <div className={styles.labelGroup}>
                            <span className={styles.labelTitle}>Set Completion Deadline</span>
                            <span className={styles.labelDesc}>Set a deadline for team member to complete this course</span>
                        </div>
                        <label className={styles.switch}>
                            <input type="checkbox" />
                            <span className={styles.slider}></span>
                        </label>
                    </div>

                    <div className={styles.toggleRow}>
                        <div className={styles.labelGroup}>
                            <span className={styles.labelTitle}>Add to Calendar</span>
                            <span className={styles.labelDesc}>Make the most of your learning experience with practical design & product-related tips.</span>
                        </div>
                        <label className={styles.switch}>
                            <input type="checkbox" defaultChecked />
                            <span className={styles.slider}></span>
                        </label>
                    </div>

                    <div className={styles.toggleRow}>
                        <div className={styles.labelGroup}>
                            <span className={styles.labelTitle}>Send Email Notifications</span>
                            <span className={styles.labelDesc}>Who doesn't love discounts? We'll often send special offers that you surely don't want to miss.</span>
                        </div>
                        <label className={styles.switch}>
                            <input type="checkbox" />
                            <span className={styles.slider}></span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}
