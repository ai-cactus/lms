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
          padding: '24px 0',
        }}
      >
        {/* Icon Layer */}
        <div
          style={{ position: 'relative', width: '120px', height: '120px', marginBottom: '24px' }}
        >
          {/* Document Icon */}
          <svg
            width="100"
            height="100"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="20" y="15" width="60" height="70" rx="4" fill="#F1F5F9" />
            <rect x="20" y="15" width="60" height="70" rx="4" stroke="#E2E8F0" strokeWidth="2" />
            <line
              x1="30"
              y1="30"
              x2="70"
              y2="30"
              stroke="#CBD5E0"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="30"
              y1="40"
              x2="70"
              y2="40"
              stroke="#CBD5E0"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="30"
              y1="50"
              x2="70"
              y2="50"
              stroke="#CBD5E0"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          {/* Magnifying Glass with Badge */}
          <div
            style={{
              position: 'absolute',
              bottom: '0',
              left: '-10px',
              filter: 'drop-shadow(0px 10px 15px rgba(0,0,0,0.1))',
            }}
          >
            <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
              <circle cx="25" cy="25" r="20" fill="white" stroke="#4C6EF5" strokeWidth="4" />
              <path d="M40 40L55 55" stroke="#4C6EF5" strokeWidth="6" strokeLinecap="round" />
              {/* Inner Details */}
              <path d="M18 25H32" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
              <path d="M18 18H28" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
              <path d="M18 32H24" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#1A202C', marginBottom: '12px' }}>
          PHI Detected!
        </h2>

        <p
          style={{
            fontSize: '16px',
            color: '#4A5568',
            maxWidth: '400px',
            lineHeight: '1.5',
            marginBottom: '32px',
          }}
        >
          Personal Health Information (PHI) has been detected in this document. Please upload a
          valid document for analysis.
          {reason && (
            <span
              style={{ display: 'block', marginTop: '8px', fontSize: '14px', color: '#E53E3E' }}
            >
              Reason: {reason}
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
