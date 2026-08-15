import React from 'react';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';

/**
 * Full-screen viewer route group.
 *
 * Deliberately outside (main): the document viewer owns the whole viewport —
 * no sidebar, no dashboard navbar, no Manage/Learn switcher — so it renders its
 * own minimal chrome instead of inheriting the shell. Route groups don't affect
 * URLs, so /dashboard/documents/[id] is unchanged.
 *
 * The SessionProvider is still required: client components in this tree
 * (the profile menu's signOut, InactivityTimer) call useSession().
 */
export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionProvider>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#f7f8fa]">{children}</div>
    </AdminSessionProvider>
  );
}
