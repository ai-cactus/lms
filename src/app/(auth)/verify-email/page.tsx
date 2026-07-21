'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';

export default function VerifyEmailPage() {
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

  let errorMessage: string;
  if (error) {
    errorMessage = 'Something went wrong. Please try again.';
    if (error === 'invalid_or_expired') {
      errorMessage = 'This verification link has expired or is invalid. Please request a new one.';
    } else if (error === 'missing_token') {
      errorMessage = 'Invalid verification link.';
    }
  }

  return (
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
        </div>
        <div className="flex flex-col gap-9">
          <div>
            <h1 className="mb-2 text-2xl font-semibold text-foreground">
              {error ? 'Verification Failed' : 'Check your email'}
            </h1>
            <p className="text-base leading-6 font-text text-text-neutral">
              {error
                ? errorMessage!
                : "We've sent a verification link to your email address. Please click the link to verify your account."}
            </p>
          </div>
          {!error && <p className="text-sm text-text-neutral">The link expires in 24 hours.</p>}
          <Button
            size="lg"
            className="w-full"
            variant="secondary"
            onClick={handleResend}
            loading={isResending}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Email'}
          </Button>
        </div>
        <p className="text-sm text-text-title font-medium leading-5 text-center">
          {resendError && <p className="text-sm text-error">{resendError}</p>}
          {resendSuccess && <p className="text-sm text-success">Verification email sent!</p>}
          <Link href="/signup" className="font-semibold text-primary hover:underline">
            Use a different email
          </Link>
        </p>
      </div>
    </div>
  );
}
