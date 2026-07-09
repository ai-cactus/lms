'use client';

import React, { useState, useEffect } from 'react';
import { Logo } from '@/components/ui';
import WorkerHeader from '@/components/worker/WorkerHeader';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookOpen, Award } from 'lucide-react';

interface WorkerDashboardLayoutProps {
  children: React.ReactNode;
  fullName: string;
}

const navItemBase =
  'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-[#718096] transition-colors hover:bg-[#f7fafc] hover:text-[#1a202c]';
const navItemActive = 'bg-[#edf2f7] text-[#1a202c] font-semibold';

export default function WorkerDashboardLayout({ children, fullName }: WorkerDashboardLayoutProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync sidebar with navigation
    setSidebarOpen(false);
  }, [pathname]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  return (
    <div className="relative min-h-screen w-full bg-[#f8f9fa]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed left-0 top-0 z-40 flex h-screen w-[280px] flex-col border-r border-[#e2e8f0] bg-white p-6',
          'transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="mb-10 flex items-center justify-between">
          <Logo size="sm" />
        </div>

        <nav className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h4 className="mb-3 pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#a0aec0]">
              MAIN MENU
            </h4>

            <Link
              href="/worker"
              className={`${navItemBase} ${pathname === '/worker' ? navItemActive : ''}`}
            >
              <Home className="size-5" />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/worker/trainings"
              className={`${navItemBase} ${pathname.startsWith('/worker/trainings') ? navItemActive : ''}`}
            >
              <BookOpen className="size-5" />
              <span>Trainings</span>
            </Link>

            <Link
              href="/worker/certificates"
              className={`${navItemBase} ${pathname.startsWith('/worker/certificates') ? navItemActive : ''}`}
            >
              <Award className="size-5" />
              <span>Certificates</span>
            </Link>
          </div>
        </nav>
      </aside>

      <main className="flex min-h-screen w-full flex-col lg:ml-[280px] lg:w-[calc(100%-280px)]">
        <WorkerHeader fullName={fullName} onMenuClick={() => setSidebarOpen(true)} />

        <div className="min-w-0 flex-1 p-4 lg:p-10">{children}</div>
      </main>
    </div>
  );
}
