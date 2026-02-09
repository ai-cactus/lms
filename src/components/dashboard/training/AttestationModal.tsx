'use client';

import { useState } from 'react';
import styles from './AttestationModal.module.css';
import { attestCourse } from '@/app/actions/course';
import { useRouter } from 'next/navigation';

interface AttestationModalProps {
    isOpen: boolean;
    onClose: () => void;
    enrollmentId: string;
    courseName: string;
    userName: string;
    userRole: string;
    onSuccess: () => void;
}

export default function AttestationModal({
    isOpen,
    onClose,
    enrollmentId,
    courseName,
    userName,
    userRole,
    onSuccess
}: AttestationModalProps) {
    const [signature, setSignature] = useState('');
    const [confirmed1, setConfirmed1] = useState(false);
    const [confirmed2, setConfirmed2] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    if (!isOpen) return null;

    const handleSubmit = async () => {
        setError('');
        setIsSubmitting(true);

        try {
            if (signature.trim() !== userName) {
                throw new Error('Signature must match your name exactly.');
            }

            await attestCourse(enrollmentId, signature, userRole);
            onSuccess();
        } catch (err: any) {
            setError(err.message || 'Failed to attest. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const isFormValid = signature.trim() === userName && confirmed1 && confirmed2;
    const effectiveDate = new Date().toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Training Attestation of Understanding and Compliance</h2>
                        <div className={styles.subtitle}>You are required to sign this document to confirm you have reviewed this compliance</div>
                    </div>
                    <button className={styles.closeButton} onClick={onClose}>✕</button>
                </div>

                <div className={styles.body}>
                    {error && <div style={{ color: 'red', marginBottom: 12, fontSize: 13 }}>{error}</div>}

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Name</label>
                        <input
                            className={styles.input}
                            value={signature}
                            onChange={(e) => setSignature(e.target.value)}
                            placeholder="Type your full name"
                        />
                        <div style={{ fontSize: 12, color: '#A0AEC0', marginTop: 4 }}>Must match: {userName}</div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Role</label>
                        <input
                            className={styles.input}
                            value={userRole}
                            readOnly
                        />
                    </div>

                    <div className={styles.legalBox}>
                        <div className={styles.checkboxGroup}>
                            <input
                                type="checkbox"
                                className={styles.checkbox}
                                checked={confirmed1}
                                onChange={(e) => setConfirmed1(e.target.checked)}
                            />
                            <div className={styles.checkboxLabel}>
                                I confirm that I personally completed the training titled {courseName} and that I passed the required knowledge check.
                                <br />
                                By signing below, I attest that:
                                <ol style={{ paddingLeft: 20, marginTop: 8 }}>
                                    <li>I have read, understood, and can follow the requirements taught in this training.</li>
                                    <li>I will apply this training to my work and follow our organization's policies and procedures related to this topic.</li>
                                    <li>I understand that if I am unsure about any part of this training, I am responsible for asking my supervisor or the compliance team for clarification before acting.</li>
                                    <li>I understand that failure to follow these requirements may lead to corrective action, up to and including termination, in line with organizational policy.</li>
                                </ol>
                            </div>
                        </div>

                        <div className={styles.checkboxGroup}>
                            <input
                                type="checkbox"
                                className={styles.checkbox}
                                checked={confirmed2}
                                onChange={(e) => setConfirmed2(e.target.checked)}
                            />
                            <div className={styles.checkboxLabel}>
                                My attestation confirms this attestation is true and accurate.
                            </div>
                        </div>
                    </div>

                    <div className={styles.effectiveDate}>
                        <svg className={styles.successBadge} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        Effective date: <strong>{effectiveDate}</strong>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose} disabled={isSubmitting}>Cancel</button>
                    <button
                        className={styles.confirmBtn}
                        onClick={handleSubmit}
                        disabled={!isFormValid || isSubmitting}
                    >
                        {isSubmitting ? 'Confirming...' : 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
    );
}
