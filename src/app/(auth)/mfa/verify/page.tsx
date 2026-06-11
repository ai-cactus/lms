'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { OtpInput } from '@/components/ui/otp-input';
import { AuthShell } from '@/components/auth/AuthShell';

function MfaVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challenge = searchParams.get('challenge');

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!challenge) {
      router.push('/login');
      return;
    }

    // Send the OTP when the page loads (error is non-critical — page still usable)
    fetch('/api/auth/mfa/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge }),
    }).catch(() => {
      // Silently ignore — user can still enter a code if they already have one
    });
  }, [challenge, router]);

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
