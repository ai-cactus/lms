'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, User } from 'lucide-react';
import { Logo, HCaptcha } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/AuthShell';
import { signupWithRole } from '@/app/actions/auth';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface PendingSignup {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export default function RoleSelectionClient() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<'admin' | 'worker'>('admin');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingSignup, setPendingSignup] = useState<PendingSignup | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string>();

  useEffect(() => {
    // Get pending signup data from sessionStorage
    const stored = sessionStorage.getItem('pendingSignup');
    if (stored) {
      try {
        setPendingSignup(JSON.parse(stored));
      } catch {
        router.push('/signup');
      }
    } else {
      // No pending signup, redirect back
      router.push('/signup');
    }
  }, [router]);

  const handleContinue = async () => {
    if (!pendingSignup) return;
    setIsLoading(true);
    setError('');

    try {
      const result = await signupWithRole({
        email: pendingSignup.email,
        password: pendingSignup.password,
        firstName: pendingSignup.firstName,
        lastName: pendingSignup.lastName,
        role: selectedRole,
        captchaToken,
      });

      if (result.success) {
        // Clear pending signup data
        sessionStorage.removeItem('pendingSignup');
        // Store email and role for verification routing
        localStorage.setItem('pendingVerificationEmail', pendingSignup.email);
        localStorage.setItem('pendingVerificationRole', selectedRole);
        // Redirect to verify email page
        router.push('/verify-email');
      } else {
        setError(result.error || 'Failed to create account');
      }
    } catch (err) {
      logger.error({ msg: 'Signup error:', err: err });
      setError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!pendingSignup) {
    return (
      <AuthShell>
        <Logo size="md" />
        <p className="text-sm text-text-secondary">Loading...</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Logo size="md" />

      <div className="w-full text-left">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Tell us about your role</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Choose the option that best describes how you wish to use Theraptly.
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-3">
        {(
          [
            { value: 'admin', label: 'Health Service Provider (Admin)', icon: Building2 },
            { value: 'worker', label: 'Worker', icon: User },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSelectedRole(value)}
            aria-pressed={selectedRole === value}
            className={cn(
              'flex w-full items-center justify-between rounded-xl border-2 p-4 text-left transition-colors',
              selectedRole === value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40',
            )}
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="font-medium text-foreground">{label}</span>
            </span>
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border-2',
                selectedRole === value ? 'border-primary' : 'border-border',
              )}
            >
              {selectedRole === value && <span className="size-2.5 rounded-full bg-primary" />}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <HCaptcha onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(undefined)} />

      <Button
        size="lg"
        className="w-full"
        onClick={handleContinue}
        loading={isLoading}
        disabled={isLoading}
      >
        Continue
      </Button>

      <button
        type="button"
        onClick={() => router.back()}
        className="text-sm text-text-secondary hover:text-foreground"
      >
        ← Back to signup
      </button>
    </AuthShell>
  );
}
