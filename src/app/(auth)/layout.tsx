import React from 'react';
import styles from './layout.module.css';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionProvider>
      <div className={styles.authLayout}>{children}</div>
    </AdminSessionProvider>
  );
}
