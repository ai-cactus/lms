'use client';
import { SessionProvider } from 'next-auth/react';

export function WorkerSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath="/api/auth-worker">{children}</SessionProvider>;
}
