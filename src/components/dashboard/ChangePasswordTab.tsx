'use client';

import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Field, Alert } from '@/components/ui';
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

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (authProvider && authProvider !== 'credentials') {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <h3 className="mb-2 text-xl font-semibold text-foreground">Password Managed Externally</h3>
        <p className="max-w-[400px] text-sm leading-relaxed text-text-secondary">
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

  return (
    <div className="w-full max-w-[600px] px-10 pb-10">
      {message && (
        <Alert variant={message.type} className="mb-6">
          {message.text}
        </Alert>
      )}

      <div className="mb-6">
        <Field label="Current Password">
          <PasswordInput
            value={currentPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCurrentPassword(e.target.value)
            }
            placeholder="•••••••••"
          />
        </Field>
      </div>

      <div className="mb-6">
        <Field label="New Password">
          <PasswordInput
            value={newPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
            placeholder="•••••••••"
          />
        </Field>
      </div>

      <div className="mb-6">
        <Field label="Confirm New Password">
          <PasswordInput
            value={confirmPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setConfirmPassword(e.target.value)
            }
            placeholder="•••••••••"
          />
        </Field>
      </div>

      <div className="mb-8 flex flex-col gap-2">
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
            <CheckCircle2
              className={`size-4 shrink-0 ${req.valid ? 'text-success' : 'text-text-tertiary'}`}
              aria-hidden="true"
            />
            <span className="text-[13px] text-text-secondary">{req.text}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="ghost"
          onClick={handleDiscard}
          disabled={isLoading}
          className="text-primary"
        >
          Discard
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isLoading}
          loading={isLoading}
          className="min-w-[140px]"
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
