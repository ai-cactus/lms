'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';

/** The success screen owns its own dashboard hand-off (it re-mints the session there). */
const EXEMPT_PATH = '/onboarding/complete';

/**
 * Sends an already-onboarded user out of the onboarding wizard.
 *
 * The proxy routes on the session COOKIE, which can lag reality: a user who
 * finished onboarding in another tab (or closed the tab before the completion
 * screen refreshed their session) still carries an org-less cookie and gets
 * bounced back here. The session endpoint below re-mints that cookie from the
 * live membership, so by the time we navigate the proxy agrees and lets
 * /dashboard through.
 */
export default function OnboardedRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status, update } = useSession();
  const redirected = useRef(false);

  const organizationId = session?.user?.organizationId;

  useEffect(() => {
    if (pathname === EXEMPT_PATH) return;
    if (status !== 'authenticated' || !organizationId || redirected.current) return;
    redirected.current = true;

    update()
      .catch((err) => {
        logger.error({ msg: '[onboarding] Failed to refresh an already-onboarded session', err });
      })
      .finally(() => {
        router.replace('/dashboard');
      });
  }, [pathname, status, organizationId, update, router]);

  return null;
}
