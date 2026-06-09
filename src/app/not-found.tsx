import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import Logo from '@/components/ui/Logo';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Page Not Found | Theraptly',
  description: 'The page you were looking for could not be found.',
};

export default function NotFound() {
  return (
    <div className={styles.page}>
      {/* ── Navigation ── */}
      <nav className={styles.nav} aria-label="Site navigation">
        <Link href="/" aria-label="Theraptly home">
          <Logo size="sm" variant="blue" />
        </Link>

        <div className={styles.navActions}>
          <Link href="/signup" className={styles.signUpBtn}>
            Sign up
          </Link>
          <Link href="/login" className={styles.loginBtn}>
            Log in
          </Link>
        </div>
      </nav>

      {/* ── Main content ── */}
      <main className={styles.main}>
        <div className={styles.content}>
          {/* Illustration */}
          <div className={styles.illustration} aria-hidden="true">
            <div className={styles.blob} />
            <Image
              src="/images/plug.png"
              alt="Disconnected plug illustration"
              width={260}
              height={220}
              className={styles.plugImage}
              priority
            />
          </div>

          {/* Text */}
          <div className={styles.textContent}>
            <h1 className={styles.heading}>Page Not Found</h1>
            <p className={styles.description}>
              The page you were looking for seems to have gone missing. Request for the link again.
            </p>

            <div className={styles.actions}>
              <Link href="/" className={styles.homeBtn}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Go to Homepage
              </Link>

              <Link href="/dashboard" className={styles.backBtn}>
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
