'use client';

import React, { useState } from 'react';
import { verifySystemPassword } from '@/app/actions/system-admin';
import { useRouter } from 'next/navigation';
import styles from '@/app/system/system.module.css';

export default function SystemLoginClient() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await verifySystemPassword(password);
      if (result.success) {
        router.push('/system');
        router.refresh();
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.loginWrapper}>
      <div className={styles.loginCard}>
        <div className={styles.loginIcon}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className={styles.loginTitle}>System Admin Access</h1>
        <p className={styles.loginSubtitle}>
          Enter the system admin password to manage all users and data across organizations. This
          tool is intended for staging environment use only.
        </p>

        <form onSubmit={handleSubmit} className={styles.loginForm}>
          {error && <div className={styles.loginError}>{error}</div>}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter system admin password"
            className={styles.loginInput}
            autoFocus
            required
          />
          <button type="submit" disabled={loading || !password} className={styles.loginButton}>
            {loading ? 'Verifying...' : 'Access Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
