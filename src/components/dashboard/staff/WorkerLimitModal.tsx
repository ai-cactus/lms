import React from 'react';
import { Modal, Button } from '@/components/ui';

interface WorkerLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  planName: string;
  planLimit: number;
}

export default function WorkerLimitModal({
  isOpen,
  onClose,
  planName,
  planLimit,
}: WorkerLimitModalProps) {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Worker Limit Reached">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 0',
        }}
      >
        <p style={{ fontSize: '15px', color: '#4A5568', lineHeight: '1.6', marginBottom: '24px' }}>
          You have reached the maximum number of workers allowed on your current{' '}
          <strong>{planName}</strong> plan ({planLimit} seats).
        </p>

        <div
          style={{
            backgroundColor: '#F7FAFC',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            marginBottom: '32px',
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#2D3748', marginBottom: '8px' }}>
            Why Upgrade?
          </h3>
          <ul
            style={{
              fontSize: '14px',
              color: '#4A5568',
              paddingLeft: '20px',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <li>Add unlimited workers to your organization</li>
            <li>Access advanced administrative controls</li>
            <li>Unlock premium features and support</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              window.location.href = '/dashboard/billing';
            }}
          >
            Upgrade Plan
          </Button>
        </div>
      </div>
    </Modal>
  );
}
