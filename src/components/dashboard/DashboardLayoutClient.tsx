'use client';

import React, { useState, useEffect } from 'react';
import { dbRoleToRoleKey, isAdminRole } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { canAccessModule } from '@/lib/rbac/roles-matrix-config';
import type { Role } from '@/types/next-auth';
import { Logo } from '@/components/ui';
import Header from '@/components/dashboard/Header';
import SidebarModeSwitcher from '@/components/dashboard/SidebarModeSwitcher';
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
  Gauge,
  Settings,
  HelpCircle,
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

  // Sidebar module visibility is driven by the RBAC registry via the Settings →
  // Roles matrix, so nav and matrix can never drift apart.
  const roleKey = role ? dbRoleToRoleKey(role as Role) : undefined;

  const canSeeDashboard = roleKey ? canAccessModule(roleKey, 'Dashboard') : false;
  const canSeeDocuments = roleKey ? canAccessModule(roleKey, 'Documents') : false;
  const canSeeCourses = roleKey ? canAccessModule(roleKey, 'Courses') : false;
  const canSeeStatusTracker = roleKey ? canAccessModule(roleKey, 'Status Tracker') : false;
  const canSeeStaffManagement = roleKey ? canAccessModule(roleKey, 'Staff Management') : false;
  // Audit Reports is intentionally NOT a matrix row (the design's Settings matrix
  // omits it), so gate it directly on the auditor-pack read permission.
  const canSeeAuditReports = can(roleKey, 'auditPack.read');
  const canSeeSettings = roleKey ? canAccessModule(roleKey, 'Settings') : false;
  const canSeeBilling = roleKey ? canAccessModule(roleKey, 'Billing') : false;
  const canSeeHelpCenter = roleKey ? canAccessModule(roleKey, 'Help Center') : false;

  const showPerformanceSection = canSeeStaffManagement || canSeeAuditReports;
  const showSettingsSection = canSeeSettings || canSeeBilling || canSeeHelpCenter;

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
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed top-0 left-0 z-40 flex h-screen w-[280px] flex-col border-r border-[#e2e8f0] bg-white p-6',
          'transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          // On lg+ always visible; on mobile slides in/out
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="mb-10 flex items-center justify-between">
          <Logo size="sm" />
        </div>

        {isAdminRole(role) && (
          <div className="mb-8">
            <SidebarModeSwitcher mode="manage" />
          </div>
        )}

        <nav className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h4 className={navSectionLabelCls}>MAIN MENU</h4>

            {canSeeDashboard && (
              <Link
                href="/dashboard"
                className={`${navItemBase} ${pathname === '/dashboard' ? navItemActive : ''}`}
              >
                <Home className="size-5" />
                <span>Dashboard</span>
              </Link>
            )}

            {canSeeDocuments && (
              <Link
                href="/dashboard/documents"
                className={`${navItemBase} ${pathname.startsWith('/dashboard/documents') ? navItemActive : ''}`}
              >
                <FileText className="size-5" />
                <span>Documents</span>
              </Link>
            )}

            {canSeeCourses && (
              <Link
                href="/dashboard/courses"
                className={`${navItemBase} ${pathname.startsWith('/dashboard/courses') ? navItemActive : ''}`}
              >
                <BookOpen className="size-5" />
                <span>Courses</span>
              </Link>
            )}

            {canSeeStatusTracker && (
              <Link
                href="/dashboard/status-tracker"
                className={`${navItemBase} ${pathname.startsWith('/dashboard/status-tracker') ? navItemActive : ''}`}
              >
                <Gauge className="size-5" />
                <span>Status Tracker</span>
              </Link>
            )}
          </div>

          {showPerformanceSection && (
            <div className="flex flex-col gap-2">
              <h4 className={navSectionLabelCls}>PERFORMANCE</h4>

              {canSeeStaffManagement && (
                <Link
                  href="/dashboard/staff"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/staff') ? navItemActive : ''}`}
                >
                  <Users className="size-5" />
                  <span>Staff Management</span>
                </Link>
              )}

              {canSeeAuditReports && (
                <Link
                  href="/dashboard/audit-reports"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/audit-reports') ? navItemActive : ''}`}
                >
                  <ClipboardCheck className="size-5" />
                  <span>Audit Reports</span>
                </Link>
              )}
            </div>
          )}

          {showSettingsSection && (
            <div className="flex flex-col gap-2">
              <h4 className={navSectionLabelCls}>SETTINGS</h4>

              {canSeeSettings && (
                <Link
                  href="/dashboard/settings"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/settings') ? navItemActive : ''}`}
                >
                  <Settings className="size-5" />
                  <span>Settings</span>
                </Link>
              )}

              {canSeeBilling && (
                <Link
                  href="/dashboard/billing"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/billing') ? navItemActive : ''}`}
                >
                  <CreditCard className="size-5" />
                  <span>Billing</span>
                </Link>
              )}

              {canSeeHelpCenter && (
                <Link
                  href="/dashboard/help"
                  className={`${navItemBase} ${pathname.startsWith('/dashboard/help') ? navItemActive : ''}`}
                >
                  <HelpCircle className="size-5" />
                  <span>Help Center</span>
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
