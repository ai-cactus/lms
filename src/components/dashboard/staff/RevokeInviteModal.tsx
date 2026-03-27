'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui';
import { revokeInvite } from '@/app/actions/staff';
import { useRouter } from 'next/navigation';

interface RevokeInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  inviteId: string;
  inviteEmail: string;
}

export default function RevokeInviteModal({
  isOpen,
  onClose,
  inviteId,
  inviteEmail,
}: RevokeInviteModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await revokeInvite(inviteId);
      onClose();
      // Refresh the current page to reflect the removed invite
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite.');
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
          maxWidth: '440px',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1A202C', marginBottom: '12px' }}>
          Revoke Invite
        </h2>
        <p style={{ fontSize: '14px', color: '#4A5568', marginBottom: '20px', lineHeight: 1.5 }}>
          Are you sure you want to revoke the pending invite for <strong>{inviteEmail}</strong>?
          They will no longer be able to use the invite link to join your organization.
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            loading={isSubmitting}
            style={{ backgroundColor: '#E53E3E', borderColor: '#E53E3E' }}
          >
            Revoke
          </Button>
        </div>
      </div>
    </div>
  );
}
