'use client';

import { FC } from 'react';
import { SessionProvider } from 'next-auth/react';
import InactivityTimer from '@/components/providers/InactivityTimer';
import { SessionIdentityGuard } from '@/components/providers/SessionIdentityGuard';
import { PostHogIdentity } from '@/components/providers/PostHogIdentity';
import { WithChildren } from '@/types/react';

interface AdminSessionProviderProps extends WithChildren {
  /** Account the server resolved for this request; enables the per-tab guard. */
  currentUserId?: string;
  currentUserName?: string;
}

export const AdminSessionProvider: FC<AdminSessionProviderProps> = ({
  children,
  currentUserId,
  currentUserName,
}) => {
  return (
    <SessionProvider basePath="/api/auth" refetchOnWindowFocus>
      <SessionIdentityGuard currentUserId={currentUserId} currentUserName={currentUserName}>
        {children}
        {/* Mounted inside the guard so an evicted tab never keeps a live
            inactivity timer against a session it no longer owns. */}
        <InactivityTimer />
        {/* Inside the provider so useSession() resolves against the ADMIN session
            rather than the worker one — the two are separate contexts. Inside the
            guard too, so an evicted tab stops identifying as its old account. */}
        <PostHogIdentity />
      </SessionIdentityGuard>
    </SessionProvider>
  );
};
