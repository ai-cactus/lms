'use client';

import { FC, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { identify, resetIdentity } from '@/lib/analytics/client';

/**
 * Keeps the PostHog identity in step with the NextAuth session.
 *
 * Mounted INSIDE AdminSessionProvider and WorkerSessionProvider rather than at
 * the root, because this app runs two separate session contexts (admin on
 * /api/auth, worker on /api/auth-worker) and useSession() only resolves beneath
 * one of them. Those two providers are the single choke points that cover every
 * authenticated layout.
 *
 * Public marketing pages have no session provider at all and therefore never
 * mount this — which is correct: anonymous visitors stay unidentified, and
 * `person_profiles: 'identified_only'` means no profile is created for them.
 */
export const PostHogIdentity: FC = () => {
  const { data: session, status } = useSession();
  // Identify is idempotent but not free, and re-running it on every session
  // object change (next-auth re-creates it on refresh) would emit a $identify
  // per poll. Track what we last sent instead.
  const lastIdentified = useRef<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      // Only reset if we had actually identified someone, so a logged-out
      // marketing visitor is not reset on every render.
      if (lastIdentified.current !== null) {
        resetIdentity();
        lastIdentified.current = null;
      }
      return;
    }

    const user = session?.user;
    if (!user?.id) return;

    const signature = `${user.id}:${user.role}:${user.organizationId ?? ''}`;
    if (lastIdentified.current === signature) return;

    identify({
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    });
    lastIdentified.current = signature;
  }, [session, status]);

  return null;
};
