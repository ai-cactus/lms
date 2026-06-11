'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
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

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      router.push('/verify-email?error=missing_token');
    }
  }, [token, router]);

  const handleVerify = async () => {
    if (!token) return;

    setIsVerifying(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (data.success) {
        // Unified login page handles both roles now
        router.push(`/login?verified=true`);
      } else {
        router.push(`/verify-email?error=${data.error}`);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  if (!token) return null;

  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <Logo size="md" />
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Mail className="size-8" aria-hidden="true" />
      </div>
      <div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Welcome to Theraptly</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Click the button below to verify your email address and complete your registration.
        </p>
      </div>

      <Button size="lg" className="w-full" onClick={handleVerify} loading={isVerifying}>
        Verify Email Address
      </Button>

      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

export default function VerifyTokenPage() {
  return (
    <AuthShell>
      <Suspense fallback={<StatusFallback />}>
        <VerifyContent />
      </Suspense>
    </AuthShell>
  );
}
