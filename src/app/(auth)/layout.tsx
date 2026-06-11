import React from 'react';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AdminSessionProvider>{children}</AdminSessionProvider>;
}
