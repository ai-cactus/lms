'use client';

import { Toaster } from 'sonner';
import { ModalProvider } from '@/components/ui/legacy/ModalContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ModalProvider>
      {children}
      {/* App-wide toasts. Mounted at the root so toast() works from every area
          (worker, auth, onboarding, system), not just the admin dashboard. */}
      <Toaster richColors position="top-right" />
    </ModalProvider>
  );
}
