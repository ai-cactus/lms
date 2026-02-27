import React from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.logoWrapper}>
            <Logo size="lg" />
          </div>
          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>
            Please select how you would like to sign in to your account.
          </p>
        </div>

        <div className={styles.options}>
          <Link href="/login-worker" className={styles.optionCard}>
            <div className={`${styles.optionIcon} ${styles.workerIcon}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className={styles.optionContent}>
              <div className={styles.optionTitle}>I am a Worker</div>
              <div className={styles.optionDesc}>Access your training and tasks</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>

          <Link href="/login" className={`${styles.optionCard} ${styles.optionCardPrimary}`}>
            <div className={`${styles.optionIcon} ${styles.adminIcon}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
              </svg>
            </div>
            <div className={styles.optionContent}>
              <div className={styles.optionTitle}>I am an Admin/Manager</div>
              <div className={styles.optionDesc}>Manage team and compliance</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>

        <div className={styles.divider}>
          <span>Need an account?</span>
        </div>

        <div className={styles.signupPrompt}>
          Are you setting up your organization?{' '}
          <Link href="/signup" className={styles.signupLink}>
            Sign up here
          </Link>
        </div>
      </div>
    </div>
  );
}
