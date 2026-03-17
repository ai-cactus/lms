import React from 'react';
import { WorkerSessionProvider } from '@/components/providers/WorkerSessionProvider';
import { Logo } from '@/components/ui';

export default function OnboardingWorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkerSessionProvider>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header
          style={{ padding: '24px', borderBottom: '1px solid #E5E7EB', backgroundColor: 'white' }}
        >
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <Logo variant="blue" />
          </div>
        </header>
        <main style={{ flex: 1, backgroundColor: '#F9FAFB' }}>{children}</main>
      </div>
    </WorkerSessionProvider>
  );
}
