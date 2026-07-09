'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, CheckCircle2, XCircle } from 'lucide-react';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/AuthShell';

function StatusFallback() {
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <Logo size="md" />
      <p className="text-sm text-text-secondary">Loading...</p>
    </div>
  );
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const success = searchParams.get('success');
  const error = searchParams.get('error');
  const email = searchParams.get('email');

  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (success === 'true' && email) {
      router.push(`/login?verified=true`);
    }
  }, [success, email, router]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResend = async () => {
    const storedEmail = localStorage.getItem('pendingVerificationEmail');
    if (!storedEmail) {
      setResendError('Please sign up again to receive a new verification email.');
      return;
    }

    setIsResending(true);
    setResendError('');

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: storedEmail }),
      });

      const data = await response.json();

      if (data.success) {
        setResendSuccess(true);
        setResendCooldown(60);
      } else {
        setResendError(data.error || 'Failed to resend email');
      }
    } catch {
      setResendError('Failed to resend verification email');
    } finally {
      setIsResending(false);
    }
  };

  // Error states
  if (error) {
    let errorMessage = 'Something went wrong. Please try again.';
    if (error === 'invalid_or_expired') {
      errorMessage = 'This verification link has expired or is invalid. Please request a new one.';
    } else if (error === 'missing_token') {
      errorMessage = 'Invalid verification link.';
    }

    return (
      <div className="flex w-full flex-col items-center gap-6 text-center">
        <Logo size="md" />
        <div className="flex size-16 items-center justify-center rounded-full bg-error/15 text-error">
          <XCircle className="size-8" aria-hidden="true" />
        </div>
        <div>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Verification Failed</h1>
          <p className="text-sm leading-relaxed text-text-secondary">{errorMessage}</p>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={handleResend}
          loading={isResending}
          disabled={resendCooldown > 0}
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Email'}
        </Button>

        {resendError && <p className="text-sm text-error">{resendError}</p>}
        {resendSuccess && <p className="text-sm text-success">Verification email sent!</p>}

        <Link href="/signup" className="text-sm font-semibold text-primary hover:underline">
          Back to Sign Up
        </Link>
      </div>
    );
  }

  // Success state
  if (success === 'true') {
    return (
      <div className="flex w-full flex-col items-center gap-6 text-center">
        <Logo size="md" />
        <div className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </div>
        <div>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Email Verified!</h1>
          <p className="text-sm leading-relaxed text-text-secondary">Redirecting you to login...</p>
        </div>
      </div>
    );
  }

  // Default state - check your email
  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <Logo size="md" />
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Mail className="size-8" aria-hidden="true" />
      </div>
      <div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Check your email</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          We&apos;ve sent a verification link to your email address. Please click the link to verify
          your account.
        </p>
      </div>

      <p className="text-xs text-text-secondary">The link expires in 24 hours.</p>

      <Button
        size="lg"
        className="w-full"
        variant="secondary"
        onClick={handleResend}
        loading={isResending}
        disabled={resendCooldown > 0}
      >
        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Email'}
      </Button>

      {resendError && <p className="text-sm text-error">{resendError}</p>}
      {resendSuccess && <p className="text-sm text-success">Verification email sent!</p>}

      <Link href="/signup" className="text-sm font-semibold text-primary hover:underline">
        Use a different email
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={<StatusFallback />}>
        <VerifyEmailContent />
      </Suspense>
    </AuthShell>
  );
}
