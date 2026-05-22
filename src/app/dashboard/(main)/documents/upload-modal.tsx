'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { uploadDocument } from '@/app/actions/documents';
import styles from './modal.module.css';
import { Modal, Button } from '@/components/ui';

export default function UploadModal({ onClose }: { onClose: () => void }) {
  const [state, action, isPending] = useActionState(uploadDocument, null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.success) {
      // Optional: reset file immediately so user sees it's gone
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset local state after successful form action
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
      setValidationError('File exceeds 10MB limit.');
      e.target.value = ''; // Clear input
      return;
    }

    // Validate Type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    // Also check extension as backup
    const validExtension = /\.(pdf|docx|doc)$/i.test(selected.name);

    if (!allowedTypes.includes(selected.type) && !validExtension) {
      setValidationError('Only PDF and DOCX files are allowed.');
      e.target.value = '';
      return;
    }

    setFile(selected);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Upload Document" size="md">
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                justifyContent: 'center',
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4C6EF5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
            I verify this document contains no Personal Health Information (PHI).
          </label>
        </div>

        {validationError && <div className={styles.error}>{validationError}</div>}
        {state?.error && <div className={styles.error}>{state.error}</div>}

        {state?.phiDetected && (
          <div className={styles.phiWarningCard}>
            <div className={styles.phiWarningHeader}>PHI WARNING</div>
            <div className={styles.phiWarningBody}>
              <svg
                className={styles.phiWarningIcon}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
              </svg>
              <p className={styles.phiWarningText}>
                <strong>WARNING:</strong> Protected Health Information (PHI) detected. Ensure all
                uploads comply with HIPAA regulations. Unauthorized disclosure is strictly
                prohibited.
              </p>
            </div>
          </div>
        )}

        {state?.success && !state.phiDetected && (
          <div className={styles.phiSuccessCard}>
            <svg
              className={styles.phiSuccessIcon}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <p className={styles.phiSuccessText}>
              <strong>SUCCESS:</strong> No Protected Health Information (PHI) detected. Uploads are
              not subject to HIPAA restrictions. Authorized sharing is permitted.
            </p>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="ghost" size="md" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            disabled={!file || isPending || !!validationError}
          >
            {isPending ? 'Scanning for PHI…' : 'Upload'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
