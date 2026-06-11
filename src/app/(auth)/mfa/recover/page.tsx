'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { AuthShell } from '@/components/auth/AuthShell';

function MfaRecoverForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challenge = searchParams.get('challenge');

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!challenge) {
      router.push('/login');
    }
  }, [challenge, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code) {
      setError('Please enter a recovery code');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid recovery code');
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
  };

  return (
    <AuthShell>
      <Logo size="md" />

      <div className="w-full text-left">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Recovery Code</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Enter one of your recovery codes to regain access. This code can only be used once.
        </p>
      </div>

      {error && (
        <Alert variant="error" className="w-full">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
        <Field label="Recovery Code">
          <Input
            type="text"
            name="recoveryCode"
            placeholder="XXXXX-XXXXX"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (error) setError('');
            }}
            autoComplete="off"
            className="text-center font-mono tracking-widest"
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={loading}
          disabled={!code.trim()}
        >
          Verify Recovery Code
        </Button>
      </form>

      <button
        type="button"
        onClick={() => router.push('/mfa/verify?challenge=' + challenge)}
        className="text-sm font-medium text-primary hover:underline"
      >
        Use email code instead
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

export default function MfaRecoverPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <Logo size="md" />
          <p className="text-sm text-text-secondary">Loading...</p>
        </AuthShell>
      }
    >
      <MfaRecoverForm />
    </Suspense>
  );
}
