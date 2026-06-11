'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { OtpInput } from '@/components/ui/otp-input';
import { AuthShell } from '@/components/auth/AuthShell';
import { verifyMfaChallenge, sendCurrentSessionMfaCode } from '@/app/actions/verify-mfa';

function Verify2FAContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setResendCooldown(60);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const sendOtp = useCallback(async () => {
    setIsSending(true);
    setError('');
    try {
      await sendCurrentSessionMfaCode();
      startCooldown();
    } finally {
      setIsSending(false);
    }
  }, [startCooldown]);

  // Send the initial OTP when the page first loads
  useEffect(() => {
    sendOtp();
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(
    async (codeStr?: string) => {
      const submitCode = codeStr ?? (useRecovery ? recoveryCode.trim() : code);
      if (!submitCode || (!useRecovery && submitCode.length !== 6)) {
        setError('Please enter a complete 6-digit code');
        return;
      }

      setIsLoading(true);
      setError('');

      try {
        const result = await verifyMfaChallenge(submitCode);
        if (result.success) {
          // Force a full page navigation to ensure the JWT is refreshed
          const safeCallback = callbackUrl.startsWith('/') ? callbackUrl : '/dashboard';
          window.location.assign(safeCallback);
        } else {
          setError(result.error || 'Invalid code. Please try again.');
          setIsLoading(false);
          // Clear the code fields for retry
          if (!useRecovery) setCode('');
        }
      } catch {
        setError('An unexpected error occurred. Please try again.');
        setIsLoading(false);
      }
    },
    [useRecovery, recoveryCode, code, callbackUrl],
  );

  return (
    <AuthShell>
      <Logo size="md" />

      <div className="w-full text-left">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Verify it&apos;s you</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          {useRecovery
            ? 'Enter one of your saved recovery codes to access your account.'
            : "We've sent a 6-digit code to your email address. Enter it below to continue."}
        </p>
      </div>

      {error && (
        <Alert variant="error" className="w-full">
          {error}
        </Alert>
      )}

      {!useRecovery ? (
        <div className="flex w-full flex-col gap-5">
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setError('');
            }}
            onComplete={(v) => handleSubmit(v)}
            disabled={isLoading}
            autoFocus
            ariaLabel="Two-factor authentication code"
          />

          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => handleSubmit()}
            loading={isLoading}
            disabled={isLoading || code.length !== 6}
          >
            Verify
          </Button>

          <div className="text-center">
            {resendCooldown > 0 ? (
              <span className="text-sm text-text-tertiary">Resend code in {resendCooldown}s</span>
            ) : (
              <button
                type="button"
                onClick={sendOtp}
                disabled={isSending}
                className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending ? 'Sending...' : "Didn't receive a code? Resend"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-4">
          <Field label="Recovery code">
            <Input
              type="text"
              value={recoveryCode}
              onChange={(e) => {
                setRecoveryCode(e.target.value);
                setError('');
              }}
              placeholder="e.g. XXXXX-XXXXX"
              disabled={isLoading}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="text-center font-mono tracking-widest"
            />
          </Field>

          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => handleSubmit()}
            loading={isLoading}
            disabled={isLoading || !recoveryCode.trim()}
          >
            Use Recovery Code
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setUseRecovery(!useRecovery);
          setError('');
          setCode('');
          setRecoveryCode('');
        }}
        className="text-sm font-medium text-primary hover:underline"
        disabled={isLoading}
      >
        {useRecovery ? '← Use email code instead' : "Can't access your email? Use a recovery code"}
      </button>

      <button
        type="button"
        onClick={() => {
          // Full-page navigation (not client-side) so the browser processes
          // the Set-Cookie headers that clear the session cookies.
          window.location.href = '/api/auth/signout-all';
        }}
        className="text-xs text-text-tertiary hover:text-text-secondary"
      >
        Sign out and log in with a different account
      </button>
    </AuthShell>
  );
}

export default function Verify2FAPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <Logo size="md" />
          <p className="text-sm text-text-secondary">Loading...</p>
        </AuthShell>
      }
    >
      <Verify2FAContent />
    </Suspense>
  );
}
