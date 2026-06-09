'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo, Button } from '@/components/ui';
import AuthHeroSlider from '@/components/auth/AuthHeroSlider';
import styles from '../verify-email/page.module.css';

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
    <div className={styles.formContent}>
      <Logo size="md" />

      <div className={styles.iconWrapper}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#4C6EF5"
          strokeWidth="2"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polyline points="22 6 12 13 2 6" />
        </svg>
      </div>

      <h1 className={styles.title}>Welcome to Theraptly</h1>
      <p className={styles.subtitle}>
        Click the button below to verify your email address and complete your registration.
      </p>

      <Button size="lg" fullWidth onClick={handleVerify} loading={isVerifying}>
        Verify Email Address
      </Button>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

export default function VerifyTokenPage() {
  return (
    <div className={styles.container}>
      <div className={styles.formSection}>
        <Suspense fallback={<p>Loading...</p>}>
          <VerifyContent />
        </Suspense>
      </div>

      {/* Right Side - Hero Slider */}
      <AuthHeroSlider />
    </div>
  );
}
