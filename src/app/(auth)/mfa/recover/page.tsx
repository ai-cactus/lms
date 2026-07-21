'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

export default function MfaRecoverPage() {
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
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
          <div className="w-full text-left flex flex-col gap-1">
            <h1 className="text-headline-3 font-semibold font-headline leading-8 text-text-bold">
              Recovery Code
            </h1>
            <p className="text-base leading-6 font-text text-text-neutral">
              Enter one of your recovery codes to regain access. This code can only be used once.
            </p>
          </div>
        </div>
        {error && (
          <Alert variant="error" className="w-full">
            {error}
          </Alert>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-8">
          <div className="flex flex-col gap-5">
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
          </div>
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
        <div className="flex flex-col items-start gap-5">
          <button
            type="button"
            onClick={() => router.push('/mfa/verify?challenge=' + challenge)}
            className="text-sm font-medium text-primary hover:underline cursor-pointer"
          >
            Use email code instead
          </button>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="text-sm text-text-secondary hover:text-foreground cursor-pointer"
          >
            ← Back to login
          </button>
        </div>
      </div>
    </div>
  );
}
