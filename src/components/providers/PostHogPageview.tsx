'use client';

import { FC, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { capture } from '@/lib/analytics/client';
import { normalizePath } from '@/lib/analytics/sanitize';
import type { AnalyticsEventProperties } from '@/lib/analytics/events';

type PortalName = AnalyticsEventProperties['$pageview']['portal'];

const AUTH_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/verify',
  '/mfa',
  '/forgot-password',
  '/reset-password',
  '/select-organization',
  '/join',
];

/**
 * Which product surface a path belongs to, so funnels can be scoped to one
 * portal without re-deriving it from the path in every PostHog query.
 */
function portalFor(path: string): PortalName {
  if (path.startsWith('/dashboard')) return 'admin';
  if (path.startsWith('/worker')) return 'worker';
  if (path.startsWith('/onboarding')) return 'onboarding';
  if (path.startsWith('/system')) return 'system';
  if (AUTH_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'auth';
  return 'marketing';
}

/** The referring host, or null when there is no cross-origin referrer. */
function referrerHost(): string | null {
  if (typeof document === 'undefined' || !document.referrer) return null;
  try {
    const host = new URL(document.referrer).host;
    return host === window.location.host ? null : host;
  } catch {
    return null;
  }
}

/**
 * Manual pageview capture.
 *
 * PostHog's automatic pageview is disabled (see instrumentation-client.ts)
 * because it sends `$current_url` verbatim, and this app's routes embed record
 * ids and — at /join/:token — an invite credential. Paths are reduced to route
 * shapes here instead.
 *
 * Deliberately does NOT read useSearchParams(): query strings are dropped
 * wholesale rather than filtered, so there is nothing to read, and avoiding the
 * hook keeps this component out of a Suspense boundary.
 *
 * Mounted at the ROOT so it also covers public marketing pages, which have no
 * session provider above them.
 */
export const PostHogPageview: FC = () => {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    capture('$pageview', {
      path: normalizePath(pathname),
      portal: portalFor(pathname),
      // Host only. A full referrer can carry another site's query parameters,
      // and document.referrer is empty on same-origin navigations anyway.
      referrer_host: referrerHost(),
    });
  }, [pathname]);

  return null;
};
