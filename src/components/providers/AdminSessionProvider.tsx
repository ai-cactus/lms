'use client';

import { FC } from 'react';
import { SessionProvider } from 'next-auth/react';
import InactivityTimer from '@/components/providers/InactivityTimer';
import { WithChildren } from '@/types/react';

export const AdminSessionProvider: FC<WithChildren> = ({ children }) => {
  return (
    <SessionProvider basePath="/api/auth">
      {children}
      <InactivityTimer />
    </SessionProvider>
  );
};
