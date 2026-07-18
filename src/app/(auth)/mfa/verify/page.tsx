'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { OtpInput } from '@/components/ui/otp-input';
import { AuthShell } from '@/components/auth/AuthShell';

const RESEND_COOLDOWN_SECONDS = 60;

function MfaVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challenge = searchParams.get('challenge');

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Seed the cooldown so the initial on-mount send (below) is rate-limited for
  // the user without a setState inside the effect body.
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  const sendCode = useCallback(async () => {
    if (!challenge) return;
    try {
      const res = await fetch('/api/auth/mfa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge }),
      });
      const data = await res.json().catch(() => ({}));
      // Surface rate-limit / send failures (Issue 4) instead of leaving the user
      // waiting for a code that will never arrive.
      if (!res.ok) {
        setError(data?.error || 'Could not send a verification code. Please try again.');
      }
    } catch {
      // Network error only — the user can still enter a code they already have.
    }
  }, [challenge]);

  // Send the OTP once on load. The ref guard makes this idempotent under React
  // StrictMode's dev double-invoke: without it the same factor secret is
  // overwritten by a second send, killing the first email's code (Issue 3).
  const didSendRef = useRef(false);
  useEffect(() => {
    if (!challenge) {
      router.push('/login');
      return;
    }
    if (didSendRef.current) return;
    didSendRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fire-and-forget: sendCode only setStates after an awaited fetch, never synchronously in this effect
    void sendCode();
  }, [challenge, router, sendCode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setError('');
    await sendCode();
    setResending(false);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }, [resendCooldown, resending, sendCode]);

  const submitCode = useCallback(
    async (codeToSubmit: string) => {
      if (!codeToSubmit || codeToSubmit.length !== 6) {
        setError('Please enter a valid 6-digit code');
        return;
      }

      setLoading(true);
      setError('');

      try {
        const res = await fetch('/api/auth/mfa/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge, code: codeToSubmit }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Verification failed');
          setLoading(false);
          return;
        }

        // Use role from API response (not from URL params)
        const redirectUrl = data.role === 'worker' ? '/worker' : '/dashboard';
        router.push(redirectUrl);
      } catch {
        setError('Something went wrong. Please try again.');
        setLoading(false);
      }
    },
    [challenge, router],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCode(code);
  };

  return (
    <AuthShell>
      <Logo size="md" />

      <div className="w-full text-left">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Two-Factor Authentication</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          We&apos;ve sent a 6-digit code to your email. Enter it below to continue.
        </p>
      </div>

      {error && (
        <Alert variant="error" className="w-full">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError('');
          }}
          onComplete={(v) => submitCode(v)}
          ariaLabel="Two-factor authentication code"
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={loading}
          disabled={code.length !== 6}
        >
          Verify
        </Button>
      </form>

      <div className="text-sm text-text-secondary">
        Didn&apos;t get a code?{' '}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={handleResend}
          loading={resending}
          disabled={resendCooldown > 0 || resending}
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
        </Button>
      </div>

      <button
        type="button"
        onClick={() => router.push('/mfa/recover?challenge=' + challenge)}
        className="text-sm font-medium text-primary hover:underline"
      >
        Use a recovery code instead
      </button>

      <button
        type="button"
        onClick={() => router.push('/login')}
        className="text-sm text-text-secondary hover:text-foreground"
      >
        ← Back to login
      </button>
    </AuthShell>
  );
}

export default function MfaVerifyPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <Logo size="md" />
          <p className="text-sm text-text-secondary">Loading...</p>
        </AuthShell>
      }
    >
      <MfaVerifyForm />
    </Suspense>
  );
}
