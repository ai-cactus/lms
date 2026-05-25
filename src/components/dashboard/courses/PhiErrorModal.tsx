import React from 'react';
import { Modal, Button } from '@/components/ui';

interface PhiErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  reason?: string;
}

export default function PhiErrorModal({ isOpen, onClose, onRetry, reason }: PhiErrorModalProps) {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '24px 16px',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#FEE2E2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#DC2626"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
          PHI Detected
        </h2>

        <p
          style={{
            fontSize: '15px',
            color: '#4B5563',
            maxWidth: '360px',
            lineHeight: '1.5',
            marginBottom: '32px',
          }}
        >
          Personal Health Information (PHI) has been detected in this document. Please upload a
          valid document for analysis.
          {reason && (
            <span
              style={{
                display: 'block',
                marginTop: '12px',
                fontSize: '14px',
                color: '#DC2626',
                background: '#FEF2F2',
                padding: '8px 12px',
                borderRadius: '6px',
              }}
            >
              <strong>Reason:</strong> {reason}
            </span>
          )}
        </p>

        <Button
          onClick={onRetry}
          variant="primary"
          style={{
            padding: '12px 32px',
            width: '100%',
            maxWidth: '300px',
          }}
        >
          Upload another document
        </Button>
      </div>
    </Modal>
  );
}
