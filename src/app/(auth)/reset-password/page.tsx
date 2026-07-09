'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { AuthShell } from '@/components/auth/AuthShell';
import { resetPasswordWithToken, forceResetPassword } from '@/app/actions/auth';
import { validatePassword } from '@/lib/password-policy';
import PasswordStrengthIndicator from '@/components/ui/PasswordStrengthIndicator';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const isForced = searchParams.get('force') === 'true';

  const [currentPassword, setCurrentPassword] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!newPassword) {
      newErrors.newPassword = 'Password is required';
    } else {
      const pwCheck = validatePassword(newPassword);
      if (!pwCheck.valid) {
        newErrors.newPassword = pwCheck.errors[0];
      }
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setLoading(true);
    setError('');

    if (!token && !isForced) {
      setError('Invalid or missing token.');
      setLoading(false);
      return;
    }

    if (isForced && !currentPassword) {
      setError('Please enter your current password.');
      setLoading(false);
      return;
    }

    try {
      let result;
      if (isForced) {
        result = await forceResetPassword(currentPassword, newPassword);
      } else {
        result = await resetPasswordWithToken(token!, newPassword);
      }

      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || 'Failed to reset password');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token && !isForced) {
    return (
      <AuthShell>
        <Logo size="md" />
        <div className="w-full text-left">
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Invalid Link</h1>
          <p className="text-sm leading-relaxed text-text-secondary">
            This password reset link is invalid or has expired.
          </p>
        </div>
        <div className="flex w-full justify-center">
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Logo size="md" />

      {!success ? (
        <>
          <div className="w-full text-left">
            <h1 className="mb-2 text-2xl font-semibold text-foreground">
              {isForced ? 'Password Update Required' : 'Set New Password'}
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              {isForced
                ? 'Your organization’s security policy requires you to update your password to a stronger one before continuing.'
                : 'Please enter your new password below.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
            {isForced && (
              <Field label="Current Password" error={error}>
                <PasswordInput
                  name="currentPassword"
                  placeholder="Enter your current password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (error) setError('');
                  }}
                  startIcon={<Lock aria-hidden="true" />}
                  autoComplete="current-password"
                />
              </Field>
            )}
            <Field label="New Password" error={errors.newPassword}>
              <PasswordInput
                name="newPassword"
                placeholder="Enter new password (min. 12 characters)"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (errors.newPassword) setErrors((prev) => ({ ...prev, newPassword: '' }));
                }}
                startIcon={<Lock aria-hidden="true" />}
                autoComplete="new-password"
              />
            </Field>
            <PasswordStrengthIndicator password={newPassword} />
            <Field
              label="Confirm Password"
              error={errors.confirmPassword || (isForced ? undefined : error)}
            >
              <PasswordInput
                name="confirmPassword"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errors.confirmPassword)
                    setErrors((prev) => ({ ...prev, confirmPassword: '' }));
                }}
                startIcon={<Lock aria-hidden="true" />}
                autoComplete="new-password"
              />
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={loading}
              disabled={!newPassword || !confirmPassword || (isForced && !currentPassword)}
            >
              Reset Password
            </Button>
          </form>
        </>
      ) : (
        <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-background-secondary p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Password Reset Complete</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Your password has been successfully updated.
          </p>
          <div className="flex w-full justify-center">
            <Link href="/login" className="text-sm font-semibold text-primary hover:underline">
              Log In Now
            </Link>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
