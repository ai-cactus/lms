'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import styles from '../../login/page.module.css';

import { Suspense } from 'react';

function MfaVerifyForm() {
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

    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-digit code');
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
        setError(data.error || 'Verification failed');
        setLoading(false);
        return;
      }

      // MFA verified — redirect to the appropriate dashboard
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
            <h1 className={styles.title}>Two-Factor Authentication</h1>
            <p className={styles.subtitle}>
              Enter the 6-digit code from your authenticator app to continue.
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
              label="Authentication Code"
              type="text"
              name="code"
              placeholder="000000"
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(val);
                if (error) setError('');
              }}
              error={error}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
            />

            <Button type="submit" size="lg" fullWidth loading={loading}>
              Verify
            </Button>
          </form>

          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => router.push('/mfa/recover?userId=' + userId + '&role=' + role)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563EB',
                cursor: 'pointer',
                fontSize: '14px',
                textDecoration: 'underline',
              }}
            >
              Use a recovery code instead
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
              ← Back to login
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
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>
              Secure Verification
            </h2>
            <p style={{ fontSize: '14px', opacity: 0.8 }}>
              Your account is protected with two-factor authentication.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MfaVerifyPage() {
  return (
    <Suspense fallback={<div>Loading verification form...</div>}>
      <MfaVerifyForm />
    </Suspense>
  );
}
