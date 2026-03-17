'use client';

import React, { useState } from 'react';
import { Button, Input, Select, Modal } from '@/components/ui';
import { createInvites } from '@/app/actions/invite';
import { useRouter } from 'next/navigation';

interface InviteStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

export default function InviteStaffModal({
  isOpen,
  onClose,
  organizationId,
}: InviteStaffModalProps) {
  const [emails, setEmails] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [role, setRole] = useState('worker');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ' ', ','].includes(e.key)) {
      e.preventDefault();
      const val = inputValue.trim();
      if (val && isValidEmail(val)) {
        if (!emails.includes(val)) {
          setEmails([...emails, val]);
        }
        setInputValue('');
        setMessage(null);
      }
      // If invalid, do nothing (prevent space/enter)
    } else if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter((email) => email !== emailToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Add current input if valid
    const finalEmails = [...emails];
    const currentVal = inputValue.trim();
    if (currentVal && isValidEmail(currentVal) && !finalEmails.includes(currentVal)) {
      finalEmails.push(currentVal);
    }

    if (finalEmails.length === 0) {
      setMessage({ type: 'error', text: 'Please enter at least one valid email address' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await createInvites(finalEmails, role, organizationId);

      if (result.success) {
        // Analyze results
        const sent = result.results.filter(
          (r) => r.status === 'sent' || r.status === 'resent',
        ).length;
        const existed = result.results.filter((r) => r.status === 'exists').length;
        const errors = result.results.filter((r) => r.status === 'error').length;

        let msgText = '';
        let type: 'success' | 'error' = 'success';

        if (sent > 0) msgText += `Sent ${sent} invite(s). `;
        if (existed > 0) msgText += `${existed} user(s) already exist. `;
        if (errors > 0) {
          msgText += `${errors} failed. `;
          type = 'error'; // Treat as error if any failed? Or maybe warning context?
          // If at least one sent, keep green but warn? Let's use neutral or just success if mixed.
          // If NOTHING sent and only errors/exists, maybe error color?
          if (sent === 0) type = 'error';
        }

        setMessage({ type, text: msgText.trim() });

        if (type === 'success' || sent > 0) {
          setEmails([]);
          setInputValue('');
          // Only close if everything was perfect? Or just give them time to read?
          // Let's rely on the timeout
          setTimeout(() => {
            onClose();
            router.refresh();
          }, 2500); // slightly longer to read
        }
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to send invites' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Invite New Staff" size="md">
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#4A5568',
            }}
          >
            Email Addresses
          </label>
          <div
            style={{
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              padding: '8px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              minHeight: '42px',
              alignItems: 'center',
              background: 'white',
            }}
            onClick={() => document.getElementById('email-chip-input')?.focus()}
          >
            {emails.map((email) => (
              <div
                key={email}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#EBF8FF',
                  color: '#2C5282',
                  borderRadius: '16px',
                  padding: '4px 12px',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                {email}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEmail(email);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    marginLeft: '6px',
                    cursor: 'pointer',
                    color: '#2C5282',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            ))}
            <input
              id="email-chip-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={emails.length === 0 ? 'Enter emails...' : ''}
              style={{
                border: 'none',
                outline: 'none',
                flex: 1,
                fontSize: '14px',
                minWidth: '120px',
                color: '#2D3748',
              }}
            />
          </div>
          <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
            Press Space or Enter to add an email.
          </p>
        </div>

        {message && (
          <div
            style={{
              padding: '10px',
              borderRadius: '6px',
              fontSize: '14px',
              backgroundColor: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
              color: message.type === 'success' ? '#166534' : '#991B1B',
            }}
          >
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={isLoading}
            disabled={emails.length === 0 && !inputValue}
          >
            Send Invites
          </Button>
        </div>
      </form>
    </Modal>
  );
}
