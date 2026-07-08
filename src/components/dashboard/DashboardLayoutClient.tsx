'use client';

import React, { useState, useEffect } from 'react';
import { dbRoleToRoleKey, isAdminRole } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import { Logo } from '@/components/ui';
import Header from '@/components/dashboard/Header';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  FileText,
  BookOpen,
  Users,
  ClipboardCheck,
  CreditCard,
  ChevronDown,
  ShieldAlert,
  Settings,
} from 'lucide-react';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  userEmail: string;
  fullName: string;
  role: string | undefined;
}

export default function DashboardLayoutClient({
  children,
  userEmail,
  fullName,
  role,
}: DashboardLayoutClientProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isProfilePage = pathname === '/dashboard/profile';

  // Billing is reserved for roles that actually hold `billing.read` (owner,
  // finance) — supervisor and other admins must not see the nav entry.
  const canAccessBilling = role ? can(dbRoleToRoleKey(role as Role), 'billing.read') : false;
  // Settings is owner-only (facility + team-access management).
  const isOwner = role === 'owner';

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync sidebar state with navigation
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

  if (isProfilePage) {
    return (
      <div className="relative min-h-screen w-full flex flex-col bg-white">
        <header className="flex h-20 w-full items-center justify-between border-b border-[#e2e8f0] px-10">
          <div className="flex items-center">
            <Logo size="md" variant="blue" />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex cursor-pointer items-center gap-3 rounded-full bg-[#f7fafc] py-1.5 pl-1.5 pr-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-[#bfccfa] text-xs font-semibold text-[#2d4ddd]">
                {fullName ? fullName[0] : userEmail[0]}
              </div>
              <span className="hidden text-sm font-semibold text-[#2d3748] lg:block">
                {fullName}
              </span>
              <ChevronDown className="hidden size-4 text-[#cbd5e0] lg:inline" />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 p-0">{children}</main>
      </div>
    );
  }

  const navSectionLabelCls =
    'mb-3 pl-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#a0aec0]';
  const navItemBase =
    'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-[#718096] transition-colors hover:bg-[#f7fafc] hover:text-[#1a202c]';
  const navItemActive = 'bg-[#edf2f7] text-[#1a202c] font-semibold';

  return (
    <div className="relative min-h-screen w-full bg-[#f8f9fa]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed top-0 left-0 z-[100] flex h-screen w-[280px] flex-col border-r border-[#e2e8f0] bg-white p-6',
          'transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          // On lg+ always visible; on mobile slides in/out
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="mb-10 flex items-center justify-between">
          <Logo size="sm" />
        </div>

        <nav className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h4 className={navSectionLabelCls}>MAIN MENU</h4>

            <Link
              href="/dashboard"
              className={`${navItemBase} ${pathname === '/dashboard' ? navItemActive : ''}`}
            >
              <Home className="size-5" />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/dashboard/documents"
              className={`${navItemBase} ${pathname.startsWith('/dashboard/documents') ? navItemActive : ''}`}
            >
              <FileText className="size-5" />
              <span>Documents</span>
            </Link>

            <Link
              href="/dashboard/courses"
              className={`${navItemBase} ${pathname.startsWith('/dashboard/courses') ? navItemActive : ''}`}
            >
              <BookOpen className="size-5" />
              <span>Courses</span>
            </Link>
          </div>

          {/* PERFORMANCE Section — admin only */}
          {isAdminRole(role) && (
            <div className="flex flex-col gap-2">
              <h4 className={navSectionLabelCls}>PERFORMANCE</h4>

              <Link
                href="/dashboard/staff"
                className={`${navItemBase} ${pathname.startsWith('/dashboard/staff') ? navItemActive : ''}`}
              >
                <Users className="size-5" />
                <span>Staff Management</span>
              </Link>

              <Link
                href="/dashboard/audit-reports"
                className={`${navItemBase} ${pathname.startsWith('/dashboard/audit-reports') ? navItemActive : ''}`}
              >
                <ClipboardCheck className="size-5" />
                <span>Audit Reports</span>
              </Link>

              <Link
                href="/dashboard/compliance"
                className={`${navItemBase} ${pathname.startsWith('/dashboard/compliance') ? navItemActive : ''}`}
              >
                <ShieldAlert className="size-5" />
                <span>Compliance</span>
              </Link>
            </div>
          )}

          {/* SETTINGS Section — Settings is owner-only; Billing needs billing access */}
          {(isOwner || canAccessBilling) && (
            <div className="flex flex-col gap-2">
              <h4 className={navSectionLabelCls}>SETTINGS</h4>

              {isOwner && (
                <Link
                  href="/dashboard/settings"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/settings') ? navItemActive : ''}`}
                >
                  <Settings className="size-5" />
                  <span>Settings</span>
                </Link>
              )}

              {canAccessBilling && (
                <Link
                  href="/dashboard/billing"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/billing') ? navItemActive : ''}`}
                >
                  <CreditCard className="size-5" />
                  <span>Billing</span>
                </Link>
              )}
            </div>
          )}
        </nav>
      </aside>

      <main className="flex min-h-screen w-full flex-col lg:ml-[280px] lg:w-[calc(100%-280px)]">
        <Header fullName={fullName} onMenuClick={() => setSidebarOpen(true)} />

        <div className="min-w-0 flex-1 p-4 lg:p-10">{children}</div>
      </main>
    </div>
  );
}
