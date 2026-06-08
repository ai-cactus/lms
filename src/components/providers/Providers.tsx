'use client';

import { ModalProvider } from '@/components/ui/legacy/ModalContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>;
}
