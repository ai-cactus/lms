import React from 'react';
import { notFound } from 'next/navigation';
import {
  isSystemAdminEnabled,
  checkSystemAuth,
  logoutSystemAdmin,
} from '@/app/actions/system-admin';
import SystemLoginClient from '@/components/system/SystemLoginClient';
import { Logo } from '@/components/ui';
import styles from './system.module.css';

export const dynamic = 'force-dynamic';

// Boot the manual-indexer BullMQ worker as a singleton on the Node.js process.
// Must be imported here (Server Component) so it starts as soon as an
// authenticated system-admin page loads. This is a no-op after the first call.
import('@/lib/queue/manual-indexer-worker').then(({ getManualIndexerWorker }) => {
  getManualIndexerWorker();
});

export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  // If env var not set, return 404 — invisible in production
  const enabled = await isSystemAdminEnabled();
  if (!enabled) {
    notFound();
  }

  const authenticated = await checkSystemAuth();

  if (!authenticated) {
    return <SystemLoginClient />;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Logo size="sm" />
          <span className={styles.headerTitle}>System Admin</span>
          <span className={styles.headerBadge}>Staging</span>
        </div>
        <div className={styles.headerRight}>
          <form action={logoutSystemAdmin}>
            <button type="submit" className={styles.logoutButton}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </form>
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
