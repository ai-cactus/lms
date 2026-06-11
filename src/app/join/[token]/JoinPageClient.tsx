'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Info, X, User, Lock } from 'lucide-react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';
import PasswordStrengthIndicator from '@/components/ui/PasswordStrengthIndicator';

interface JoinPageClientProps {
  invite: {
    token: string;
    email: string;
    role: string;
  };
  orgName: string;
}

export default function JoinPageClient({ invite, orgName }: JoinPageClientProps) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showBanner, setShowBanner] = useState(true);

  // Capitalize role for display
  const displayRole = invite.role.charAt(0).toUpperCase() + invite.role.slice(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      setError(pwCheck.errors[0]);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!agreed) {
      setError('You must agree to the Terms of Service');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: invite.token,
          firstName,
          lastName,
          password,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create account');
      }

      router.push('/login?joined=true');
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center bg-background-secondary px-4 py-10">
      <div className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary-light to-primary" />
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <Logo size="md" />

          {showBanner && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="flex-1 text-text-secondary">
                You&apos;ve been invited to join{' '}
                <strong className="font-semibold text-foreground">{orgName}</strong> as a{' '}
                <strong className="font-semibold text-foreground">{displayRole}</strong>.
              </span>
              <button
                type="button"
                onClick={() => setShowBanner(false)}
                aria-label="Dismiss"
                className="text-text-tertiary hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              You&apos;re joining <span className="text-primary">{orgName}</span> as a{' '}
              <span className="text-primary">{displayRole}</span>.
            </h1>
            <h2 className="mt-1 text-sm text-text-secondary">Sign in to continue</h2>
          </div>

          {error && (
            <Alert variant="error" className="w-full">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First Name">
                <Input
                  placeholder="Enter your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  startIcon={<User aria-hidden="true" />}
                  autoComplete="given-name"
                />
              </Field>
              <Field label="Last Name">
                <Input
                  placeholder="Enter your last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  startIcon={<User aria-hidden="true" />}
                  autoComplete="family-name"
                />
              </Field>
            </div>

            <Field label="Work Email">
              <Input value={invite.email} disabled readOnly />
            </Field>

            <Field label="Assigned role">
              <Input value={displayRole} disabled readOnly />
            </Field>

            <Field label="Password">
              <PasswordInput
                placeholder={`Password (at least ${PASSWORD_MIN_LENGTH} characters)`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                startIcon={<Lock aria-hidden="true" />}
                autoComplete="new-password"
              />
            </Field>
            <PasswordStrengthIndicator password={password} />

            <Field label="Confirm Password">
              <PasswordInput
                placeholder={`Password (at least ${PASSWORD_MIN_LENGTH} characters)`}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                startIcon={<Lock aria-hidden="true" />}
                autoComplete="new-password"
              />
            </Field>

            <label className="flex items-start gap-2 text-sm text-text-secondary">
              <Checkbox
                checked={agreed}
                onCheckedChange={(c) => setAgreed(c === true)}
                className="mt-0.5"
              />
              <span>
                Yes, I understand and agree to the{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Theraptly Terms of Service
                </a>
              </span>
            </label>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={isLoading}
              disabled={
                isLoading ||
                !firstName.trim() ||
                !lastName.trim() ||
                !password ||
                !confirmPassword ||
                !agreed
              }
            >
              Create Account
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
