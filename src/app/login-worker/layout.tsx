import React from 'react';
import { WorkerSessionProvider } from '@/components/providers/WorkerSessionProvider';

export default function WorkerLoginLayout({ children }: { children: React.ReactNode }) {
    return (
        <WorkerSessionProvider>
            {children}
        </WorkerSessionProvider>
    );
}
