import React from 'react';
import { WorkerSessionProvider } from '@/components/providers/WorkerSessionProvider';
import { Logo } from '@/components/ui';

export default function OnboardingWorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkerSessionProvider>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-background p-6">
          <div className="mx-auto max-w-[1200px]">
            <Logo variant="blue" />
          </div>
        </header>
        <main className="flex-1 bg-background-secondary">{children}</main>
      </div>
    </WorkerSessionProvider>
  );
}
