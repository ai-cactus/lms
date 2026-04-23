'use client';

import { useState } from 'react';
import styles from './AttestationModal.module.css';
import { attestCourse } from '@/app/actions/course';

import { Modal, Button } from '@/components/ui';

interface AttestationModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollmentId: string;
  courseName: string;
  userEmail: string;
  onSuccess: () => void;
}

export default function AttestationModal({
  isOpen,
  onClose,
  enrollmentId,
  courseName,
  userEmail,
  onSuccess,
}: AttestationModalProps) {
  const [signature, setSignature] = useState('');
  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    setIsSubmitting(true);

    try {
      await attestCourse(enrollmentId, signature, '');
      onSuccess();
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || 'Failed to attest. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = signature.trim() !== '' && confirmed1 && confirmed2;
  const effectiveDate = new Date().toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" showCloseButton={true}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Training Attestation of Understanding and Compliance</h2>
          <div className={styles.subtitle}>
            You are required to sign this document to confirm you have reviewed this compliance
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {error && <div style={{ color: 'red', marginBottom: 12, fontSize: 13 }}>{error}</div>}

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
          {userEmail && (
            <div style={{ fontSize: 12, color: '#A0AEC0', marginTop: 4 }}>{userEmail}</div>
          )}
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
              I hereby certify that I have successfully completed the training module referenced
              above, including all associated learning materials and the required knowledge
              assessment.
              <br />
              By submitting this electronic signature, I solemnly attest to the following:
              <ol style={{ paddingLeft: 20, marginTop: 8 }}>
                <li>
                  1. Competency: I have read and fully comprehended the training content. I
                  acknowledge my responsibility to perform my duties in strict accordance with these
                  requirements.
                </li>
                <li>
                  2. Application & Policy: I will integrate these principles into my daily practice
                  and consistently adhere to all related organizational policies, procedures, and
                  applicable state/federal regulatory standards.
                </li>
                <li>
                  3. Proactive Clarification: If I encounter a situation where I am uncertain of the
                  correct protocol, I agree to seek immediate guidance from my supervisor or the
                  Compliance Department before proceeding.
                </li>
                <li>
                  4. Professional Accountability: I understand that maintaining this competency is a
                  condition of my employment/engagement. I acknowledge that failure to comply with
                  these standards may result in disciplinary action, up to and including termination
                  of my contract or employment.
                </li>
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
              I confirm that I have read the above statements and that this attestation is true,
              accurate, and provided of my own free will.
            </div>
          </div>
        </div>

        <div className={styles.effectiveDate}>
          <svg
            className={styles.successBadge}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          Effective date: <strong>{effectiveDate}</strong>
        </div>
      </div>

      <div className={styles.footer}>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!isFormValid || isSubmitting}
          loading={isSubmitting}
          style={{ flex: 1 }}
        >
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
