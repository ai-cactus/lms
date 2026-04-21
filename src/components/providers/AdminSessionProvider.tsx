'use client';
import { SessionProvider } from 'next-auth/react';
import InactivityTimer from '@/components/providers/InactivityTimer';

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/auth">
      {children}
      <InactivityTimer keepAlivePath="/api/auth/keep-alive" />
    </SessionProvider>
  );
}
