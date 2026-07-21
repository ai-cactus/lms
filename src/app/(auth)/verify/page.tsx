'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';

export default function VerifyTokenPage() {
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
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
        </div>
        <div className="flex flex-col gap-9">
          <div>
            <h1 className="mb-2 text-2xl font-semibold text-foreground">Welcome to Theraptly</h1>
            <p className="text-base leading-6 font-text text-text-neutral">
              Click the button below to verify your email address and complete your registration.
            </p>
          </div>
          <Button size="lg" className="w-full" onClick={handleVerify} loading={isVerifying}>
            Verify Email Address
          </Button>
        </div>
        {error && <p className="text-sm text-error font-medium leading-5 text-center">{error}</p>}
      </div>
    </div>
  );
}
