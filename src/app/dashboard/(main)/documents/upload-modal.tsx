'use client';

import { useActionState, useState } from 'react';
import { uploadDocument } from '@/app/actions/documents';
import styles from './modal.module.css';
import { Modal } from '@/components/ui';

export default function UploadModal({ onClose }: { onClose: () => void }) {
    const [state, action, isPending] = useActionState(uploadDocument, null);
    const [file, setFile] = useState<File | null>(null);

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
                        type="file"
                        name="file"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        required
                    />
                    <p>{file ? file.name : "Drag & drop or Click to Select"}</p>
                </div>

                <div className={styles.agreement}>
                    <input type="checkbox" id="phi-agree" required />
                    <label htmlFor="phi-agree">
                        I verify this document contains no Protected Health Information (PHI).
                    </label>
                </div>

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
                        disabled={!file || isPending}
                    >
                        {isPending ? 'Scanning & Uploading...' : 'Upload'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
