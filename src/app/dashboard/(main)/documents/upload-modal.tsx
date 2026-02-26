'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { uploadDocument } from '@/app/actions/documents';
import styles from './modal.module.css';
import { Modal } from '@/components/ui';

export default function UploadModal({ onClose }: { onClose: () => void }) {
    const [state, action, isPending] = useActionState(uploadDocument, null);
    const [file, setFile] = useState<File | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (state?.success) {
            // Optional: reset file immediately so user sees it's gone
            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';

            // Close modal after delay
            const timer = setTimeout(() => {
                onClose();
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [state, onClose]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        setValidationError(null);
        setFile(null);

        if (!selected) return;

        // Validate Size (10MB)
        if (selected.size > 10 * 1024 * 1024) {
            setValidationError("File exceeds 10MB limit.");
            e.target.value = ""; // Clear input
            return;
        }

        // Validate Type
        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        // Also check extension as backup
        const validExtension = /\.(pdf|docx|doc)$/i.test(selected.name);

        if (!allowedTypes.includes(selected.type) && !validExtension) {
            setValidationError("Only PDF and DOCX files are allowed.");
            e.target.value = "";
            return;
        }

        setFile(selected);
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title="Upload Document"
            size="md"
        >
            <form action={action} className={styles.form}>
                <div className={styles.dropzone}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        name="file"
                        onChange={handleFileChange}
                        accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                        required
                    />
                    {file ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4C6EF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                            <p style={{ margin: 0 }}>{file.name}</p>
                        </div>
                    ) : (
                        <p>Drag &amp; drop or Click to Select (PDF, DOCX - Max 10MB)</p>
                    )}
                </div>

                <div className={styles.agreement}>
                    <input type="checkbox" id="phi-agree" required />
                    <label htmlFor="phi-agree">
                        I verify this document contains no Protected Health Information (PHI).
                    </label>
                </div>

                {validationError && <div className={styles.error}>{validationError}</div>}
                {state?.error && <div className={styles.error}>{state.error}</div>}

                {state?.phiDetected && (
                    <div className={styles.warning}>
                        <strong>⚠️ PHI Detected</strong>
                        <p>Our scanner found potential PHI in this document. It has been flagged for review.</p>
                    </div>
                )}

                {state?.success && !state.phiDetected && (
                    <div className={styles.success}>Upload Complete!</div>
                )}

                <div className={styles.actions}>
                    <button type="button" onClick={onClose} className={styles.cancelBtn}>Cancel</button>
                    <button
                        type="submit"
                        className={styles.uploadBtn}
                        disabled={!file || isPending || !!validationError}
                    >
                        {isPending ? (
                            <span className={styles.scanningFlex}>
                                <span className={styles.spinner}></span> Scanning for PHI...
                            </span>
                        ) : 'Upload'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
