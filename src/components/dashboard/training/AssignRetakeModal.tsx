'use client';

import React, { useState } from 'react';

import { Button } from '@/components/ui';
import { assignRetake } from '@/app/actions/course';
import { useRouter } from 'next/navigation';

interface AssignRetakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  enrollmentId: string;
  courseName: string;
  userName: string;
}

export default function AssignRetakeModal({
  isOpen,
  onClose,
  enrollmentId,
  courseName,
  userName,
}: AssignRetakeModalProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await assignRetake(enrollmentId, reason);
      if (result.success) {
        router.refresh(); // Refresh the page to show the new retake assignment
        onClose();
      } else {
        setError('Failed to assign retake. Please try again.');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An error occurred while assigning the retake.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          width: '90%',
          maxWidth: '480px',
          borderRadius: '16px',
          padding: '24px',
          position: 'relative',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1A202C', marginBottom: '16px' }}>
          Assign Retake
        </h2>

        <p style={{ fontSize: '14px', color: '#4A5568', marginBottom: '20px', lineHeight: 1.5 }}>
          This action will create a new retake attempt for <strong>{userName}</strong> on the course{' '}
          <strong>{courseName}</strong>. Their previous attempts will be preserved in the system but
          the course will be marked as in-progress again.
        </p>

        {error && (
          <div
            style={{
              padding: '12px',
              backgroundColor: '#FFF5F5',
              color: '#C53030',
              borderRadius: '8px',
              fontSize: '14px',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: '24px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: 500,
              color: '#4A5568',
              marginBottom: '8px',
            }}
          >
            Reason for retake (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Granted a second chance after brief review session"
            style={{
              width: '100%',
              minHeight: '80px',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #E2E8F0',
              fontSize: '14px',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={isSubmitting}>
            Assign Retake
          </Button>
        </div>
      </div>
    </div>
  );
}
