import React from 'react';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';

/**
 * Wizard route group layout.
 *
 * The (wizard) routes sit outside (main), so they don't inherit the
 * AdminSessionProvider that (main)/layout.tsx provides. Without this wrapper,
 * any 'use client' component inside the wizard that calls useSession()
 * (e.g. ConfirmPublishModal, InactivityTimer) would throw:
 *   "Cannot destructure property 'data' of useSession() as it is undefined"
 *
 * This layout supplies the missing SessionProvider context.
 */
export default function WizardLayout({ children }: { children: React.ReactNode }) {
  return <AdminSessionProvider>{children}</AdminSessionProvider>;
}
