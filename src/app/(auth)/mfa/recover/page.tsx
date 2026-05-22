'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import styles from '../../login/page.module.css';

import { Suspense } from 'react';

function MfaRecoverForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId');
  const role = searchParams.get('role');

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      router.push('/login');
    }
  }, [userId, router]);

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
        body: JSON.stringify({ userId, code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid recovery code');
        setLoading(false);
        return;
      }

      const redirectUrl = role === 'worker' ? '/worker' : '/dashboard';
      router.push(redirectUrl);
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
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
              onClick={() => router.push('/mfa/verify?userId=' + userId + '&role=' + role)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563EB',
                cursor: 'pointer',
                fontSize: '14px',
                textDecoration: 'underline',
              }}
            >
              Use authenticator code instead
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

      <div className={styles.heroSection}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#1E3A5F',
          }}
        >
          <div style={{ textAlign: 'center', padding: '40px', color: '#fff' }}>
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: '0 auto 24px' }}
            >
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>
              Account Recovery
            </h2>
            <p style={{ fontSize: '14px', opacity: 0.8 }}>
              Use a recovery code if you&apos;ve lost access to your authenticator app.
            </p>
          </div>
        </div>
      </div>
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
