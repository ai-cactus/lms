'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import AuthHeroSlider from '@/components/auth/AuthHeroSlider';
import styles from '../../login/page.module.css';

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
    <div className={styles.container}>
      {/* Left Side - Form */}
      <div className={styles.formSection}>
        <div className={styles.formContent}>
          <Logo size="md" />

          <div className={styles.formHeader}>
            <h1 className={styles.title}>Recovery Code</h1>
            <p className={styles.subtitle}>
              Enter one of your recovery codes to regain access. This code can only be used once.
            </p>
          </div>

          {error && (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                color: '#991B1B',
                padding: '12px',
                borderRadius: '6px',
                marginBottom: '16px',
                border: '1px solid #FCA5A5',
                fontSize: '14px',
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form}>
            <Input
              label="Recovery Code"
              type="text"
              name="recoveryCode"
              placeholder="XXXXX-XXXXX"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                if (error) setError('');
              }}
              error={error}
              autoComplete="off"
            />

            <Button type="submit" size="lg" fullWidth loading={loading}>
              Verify Recovery Code
            </Button>
          </form>

          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => router.push('/mfa/verify?challenge=' + challenge)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563EB',
                cursor: 'pointer',
                fontSize: '14px',
                textDecoration: 'underline',
              }}
            >
              Use email code instead
            </button>
          </div>

          <p className={styles.signupPrompt}>
            <button
              type="button"
              onClick={() => router.push('/login')}
              style={{
                background: 'none',
                border: 'none',
                color: '#6B7280',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Back to login
            </button>
          </p>
        </div>
      </div>

      {/* Right Side - Hero Slider */}
      <AuthHeroSlider />
    </div>
  );
}

export default function MfaRecoverPage() {
  return (
    <Suspense fallback={<div>Loading recovery form...</div>}>
      <MfaRecoverForm />
    </Suspense>
  );
}
