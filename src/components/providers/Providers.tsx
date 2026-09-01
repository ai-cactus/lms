'use client';

import { FC } from 'react';
import { Toaster } from 'sonner';
import { ModalProvider } from '@/components/ui/legacy/ModalContext';
import { PostHogPageview } from '@/components/providers/PostHogPageview';
import { WithChildren } from '@/types/react';

export const Providers: FC<WithChildren> = ({ children }) => {
  return (
    <ModalProvider>
      {children}
      {/* Root-level so public marketing pages are covered too. Identity is
          mounted separately, inside each session provider — see PostHogIdentity. */}
      <PostHogPageview />
      {/* App-wide toasts. Mounted at the root so toast() works from every area
          (worker, auth, onboarding, system), not just the admin dashboard. */}
      <Toaster richColors position="top-right" />
    </ModalProvider>
  );
};
