import React from 'react';
import { Logo } from '@/components/ui';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionProvider>
      <div className="flex min-h-screen flex-col bg-background-secondary">
        <header className="flex h-[60px] items-center justify-center border-b border-border bg-background px-5 md:px-10">
          <Logo variant="blue" />
        </header>
        <main className="flex flex-1 flex-col items-center px-4 py-6 md:px-5 md:py-10">
          {children}
        </main>
      </div>
    </AdminSessionProvider>
  );
}
