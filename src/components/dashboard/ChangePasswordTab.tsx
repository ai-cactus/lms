'use client';

import React, { useState } from 'react';
import styles from './ProfileForm.module.css';
import { Button, Input } from '@/components/ui';
import { changePassword } from '@/app/actions/user';

interface ChangePasswordTabProps {
  onSuccess?: () => void;
  userEmail?: string;
  authProvider?: string;
}

export function ChangePasswordTab({ onSuccess, authProvider }: ChangePasswordTabProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (authProvider && authProvider !== 'credentials') {
    return (
      <div className={styles.emptyState}>
        <h3 className={styles.emptyStateTitle}>Password Managed Externally</h3>
        <p className={styles.emptyStateText}>
          Your account is linked using a third-party provider (e.g., Microsoft). You cannot change
          your password here.
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    setMessage(null);

    if (!currentPassword) {
      setMessage({ type: 'error', text: 'Current password is required' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (newPassword.length < 12) {
      setMessage({ type: 'error', text: 'New password must be at least 12 characters long' });
      return;
    }

    // Additional client-side checks based on the UI checklist
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);

    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setMessage({ type: 'error', text: 'Password does not meet complexity requirements' });
      return;
    }

    setIsLoading(true);
    try {
      const res = await changePassword({ currentPassword, newPassword });
      if (res.success) {
        setMessage({ type: 'success', text: 'Password updated successfully.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        if (onSuccess) onSuccess();
      } else {
        setMessage({ type: 'error', text: res.error || 'Failed to update password' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscard = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setMessage(null);
  };

  const EyeIcon = ({
    show,
    onClick,
  }: {
    show: boolean;
    onClick: React.MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="bg-transparent border-none cursor-pointer px-2 text-slate-500"
    >
      {show ? (
        // Eye off icon
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      ) : (
        // Eye icon
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      )}
    </button>
  );

  return (
    <div className="max-w-[600px] w-full px-10 pb-10">
      {message && <div className={`${styles.message} ${styles[message.type]}`}>{message.text}</div>}

      <div className="mb-6">
        <label className={styles.label}>Current Password</label>
        <div className="relative">
          <Input
            type={showCurrent ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCurrentPassword(e.target.value)
            }
            placeholder="•••••••••"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <EyeIcon show={showCurrent} onClick={() => setShowCurrent(!showCurrent)} />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <label className={styles.label}>New Password</label>
        <div className="relative">
          <Input
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
            placeholder="•••••••••"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <EyeIcon show={showNew} onClick={() => setShowNew(!showNew)} />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <label className={styles.label}>Confirm New Password</label>
        <div className="relative">
          <Input
            type={showConfirm ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setConfirmPassword(e.target.value)
            }
            placeholder="•••••••••"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <EyeIcon show={showConfirm} onClick={() => setShowConfirm(!showConfirm)} />
          </div>
        </div>
      </div>

      {/* Password Requirements Checklist */}
      <div className="flex flex-col gap-2 mb-8">
        {[
          { text: 'At least 12 characters', valid: newPassword.length >= 12 },
          { text: 'At least one uppercase letter', valid: /[A-Z]/.test(newPassword) },
          { text: 'At least one lowercase letter', valid: /[a-z]/.test(newPassword) },
          { text: 'At least one number', valid: /\d/.test(newPassword) },
          {
            text: 'At least one special character (!@#$... )',
            valid: /[^A-Za-z0-9]/.test(newPassword),
          },
        ].map((req, i) => (
          <div key={i} className="flex items-center gap-2">
            {req.valid ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#22c55e" stroke="#22c55e">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#cbd5e1" stroke="#cbd5e1">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path>
              </svg>
            )}
            <span className="text-[13px] text-slate-500">{req.text}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={handleDiscard}
          disabled={isLoading}
          className="border-transparent text-indigo-600"
        >
          Discard
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          disabled={isLoading}
          loading={isLoading}
          className="bg-indigo-600 min-w-[140px]"
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
