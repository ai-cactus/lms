import React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  isSystemAdminEnabled,
  checkSystemAuth,
  logoutSystemAdmin,
} from '@/app/actions/system-admin';
import SystemLoginClient from '@/components/system/SystemLoginClient';
import { Logo } from '@/components/ui';
import { LogOut } from 'lucide-react';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Environment badge — derived from the deployed APP_URL host so the same build
// shows STAGING on staging-lms.theraptly.com and PRODUCTION on
// training.theraptly.com, with a distinct DEV badge when running locally.
// ---------------------------------------------------------------------------
function getEnvBadge(): { label: string; className: string } {
  const url = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }

  const isLocal =
    process.env.NODE_ENV === 'development' ||
    host === '' ||
    host === 'localhost' ||
    host === '127.0.0.1';

  if (isLocal) {
    return { label: 'Dev', className: 'bg-[#f1f5f9] text-[#475569]' };
  }
  if (host.includes('staging')) {
    return { label: 'Staging', className: 'bg-[#fef3c7] text-[#92400e]' };
  }
  return { label: 'Production', className: 'bg-[#fee2e2] text-[#991b1b]' };
}

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

  const envBadge = getEnvBadge();

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e2e8f0] bg-white px-4 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Logo size="sm" />
          <span className="text-lg font-semibold text-[#0f172a]">System Admin</span>
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.5px] ${envBadge.className}`}
          >
            {envBadge.label}
          </span>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            href="/system"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#334155] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
          >
            Users
          </Link>
          <Link
            href="/system/manual"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#334155] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
          >
            Manual
          </Link>
          <Link
            href="/system/video-courses"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#334155] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
          >
            Video Courses
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <form action={logoutSystemAdmin}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-[13px] font-medium text-[#64748b] transition-all hover:border-[#cbd5e1] hover:bg-[#f1f5f9] hover:text-[#334155]"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Logout
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-[1400px] p-4 md:p-8">{children}</div>
    </div>
  );
}
