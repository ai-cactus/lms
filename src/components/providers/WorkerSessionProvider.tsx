'use client';
import { SessionProvider } from 'next-auth/react';
import InactivityTimer from '@/components/providers/InactivityTimer';

export function WorkerSessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/auth-worker">
      {children}
      <InactivityTimer keepAlivePath="/api/auth-worker/keep-alive" />
    </SessionProvider>
  );
}
