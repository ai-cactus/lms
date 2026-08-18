import { useState, useEffect, FC } from 'react';
import { dbRoleToRoleKey, isAdminRole } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { canAccessModule } from '@/lib/rbac/roles-matrix-config';
import type { Role } from '@/types/next-auth';
import { Logo } from '@/components/ui';
import { DefaultDashboardNavBar } from '@/components/dashboard/NavBar';
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
  Gauge,
  Settings,
  HelpCircle,
} from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fullName: string;
  role: string | undefined;
}

const DefaultDashboardLayout: FC<Props> = ({ role, fullName, children }) => {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const navSectionLabelCls =
    'px-3 pb-3 text-xs font-semibold uppercase leading-[1.5] tracking-[0.96px] text-[#a4abb8]';
  const navItemBase =
    'flex items-center gap-3 rounded-[7px] px-4 py-[15px] text-lg font-medium leading-7 text-[#808897] transition-colors hover:bg-[#f9fafb] hover:text-[#0c111d]';
  const navItemActive = 'border border-[#dfe1e6] bg-[#f9fafb] !text-[#0c111d]';
  const navIconCls = 'size-[23px] shrink-0';

  return (
    <div className="relative flex h-full w-full bg-white">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed top-0 left-0 z-40 flex h-screen w-[280px] flex-col border-r border-[#e4e7ec] bg-white',
          'transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          // On lg+ always visible; on mobile slides in/out
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="flex h-[92px] shrink-0 items-center justify-between px-6">
          <Logo size="nav" variant="brand" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 pb-[30px]">
          {isAdminRole(role) && <SidebarModeSwitcher mode="manage" />}

          <nav className="flex flex-col gap-[18px]">
            <div className="flex flex-col">
              <h4 className={navSectionLabelCls}>Main Menu</h4>
              <div className="flex flex-col gap-1">
                {canSeeDashboard && (
                  <Link
                    href="/dashboard"
                    className={`${navItemBase} ${pathname === '/dashboard' ? navItemActive : ''}`}
                  >
                    <Home className={navIconCls} />
                    <span>Dashboard</span>
                  </Link>
                )}

                {canSeeDocuments && (
                  <Link
                    href="/dashboard/documents"
                    className={`${navItemBase} ${pathname.startsWith('/dashboard/documents') ? navItemActive : ''}`}
                  >
                    <FileText className={navIconCls} />
                    <span>Documents</span>
                  </Link>
                )}

                {canSeeCourses && (
                  <Link
                    href="/dashboard/courses"
                    className={`${navItemBase} ${pathname.startsWith('/dashboard/courses') ? navItemActive : ''}`}
                  >
                    <BookOpen className={navIconCls} />
                    <span>Courses</span>
                  </Link>
                )}

                {canSeeStatusTracker && (
                  <Link
                    href="/dashboard/status-tracker"
                    className={`${navItemBase} ${pathname.startsWith('/dashboard/status-tracker') ? navItemActive : ''}`}
                  >
                    <Gauge className={navIconCls} />
                    <span>Status Tracker</span>
                  </Link>
                )}
              </div>
            </div>

            {showPerformanceSection && (
              <div className="flex flex-col">
                <h4 className={navSectionLabelCls}>Performance</h4>
                <div className="flex flex-col gap-1">
                  {canSeeStaffManagement && (
                    <Link
                      href="/dashboard/staff"
                      className={`${navItemBase} ${pathname.startsWith('/dashboard/staff') ? navItemActive : ''}`}
                    >
                      <Users className={navIconCls} />
                      <span>Staff Management</span>
                    </Link>
                  )}

                  {canSeeAuditReports && (
                    <Link
                      href="/dashboard/audit-reports"
                      className={`${navItemBase} ${pathname.startsWith('/dashboard/audit-reports') ? navItemActive : ''}`}
                    >
                      <ClipboardCheck className={navIconCls} />
                      <span>Audit Reports</span>
                    </Link>
                  )}
                </div>
              </div>
            )}

            {showSettingsSection && (
              <div className="flex flex-col">
                <h4 className={`${navSectionLabelCls} pt-2`}>Settings</h4>
                <div className="flex flex-col gap-1">
                  {canSeeSettings && (
                    <Link
                      href="/dashboard/settings"
                      className={`${navItemBase} ${pathname.startsWith('/dashboard/settings') ? navItemActive : ''}`}
                    >
                      <Settings className={navIconCls} />
                      <span>Settings</span>
                    </Link>
                  )}

                  {canSeeBilling && (
                    <Link
                      href="/dashboard/billing"
                      className={`${navItemBase} ${pathname.startsWith('/dashboard/billing') ? navItemActive : ''}`}
                    >
                      <CreditCard className={navIconCls} />
                      <span>Billing</span>
                    </Link>
                  )}

                  {canSeeHelpCenter && (
                    <Link
                      href="/dashboard/help"
                      className={`${navItemBase} ${pathname.startsWith('/dashboard/help') ? navItemActive : ''}`}
                    >
                      <HelpCircle className={navIconCls} />
                      <span>Help Center</span>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </nav>
        </div>
      </aside>

      <main className="flex h-full w-full flex-col lg:ml-[280px] lg:w-[calc(100%-280px)]">
        <DefaultDashboardNavBar
          fullName={fullName}
          onMenuClick={() => setSidebarOpen(true)}
          forProfile
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6 lg:px-[46px] lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
};

export default DefaultDashboardLayout;
