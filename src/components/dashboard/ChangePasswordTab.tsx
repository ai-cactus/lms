'use client';

import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Field, Alert } from '@/components/ui';
import { changePassword } from '@/app/actions/user';
import { actionButtonClass, fieldClass } from './profile-tab-styles';

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
      <div className="flex flex-col items-center justify-center py-16 text-center">
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
    <div className="flex w-full flex-col gap-[27.639px]">
      {message && <Alert variant={message.type}>{message.text}</Alert>}

      <Field className={fieldClass} label="Current Password">
        <PasswordInput
          value={currentPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
          placeholder="•••••••••"
        />
      </Field>

      <Field className={fieldClass} label="New Password">
        <PasswordInput
          value={newPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
          placeholder="•••••••••"
        />
      </Field>

      <Field className={fieldClass} label="Confirm New Password">
        <PasswordInput
          value={confirmPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
          placeholder="•••••••••"
        />
      </Field>

      <div className="flex flex-col gap-[10px]">
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
          <div key={i} className="flex items-center gap-[10px]">
            <span
              aria-hidden="true"
              className={`flex size-[18px] shrink-0 items-center justify-center rounded-[4px] ${
                req.valid ? 'bg-success text-white' : 'border-[1.5px] border-[#e5e7ea]'
              }`}
            >
              {req.valid && <Check className="size-[13px]" strokeWidth={3} />}
            </span>
            <span className="text-[15.28px] leading-[20.372px] text-foreground">{req.text}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="ghost"
          onClick={handleDiscard}
          disabled={isLoading}
          className={`${actionButtonClass} text-primary hover:bg-primary/5`}
        >
          Discard
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isLoading}
          loading={isLoading}
          className={actionButtonClass}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
