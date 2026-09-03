/**
 * The Audit Reports billing gate moved from a modal (which redirected away on
 * close) to an inline empty state, so the page must now render the gate copy
 * and a link to Billing in place of the report UI — while keeping the RBAC
 * redirect for non-admin roles.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect, mockGetStats } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  mockGetStats: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/app/actions/auditor', () => ({ getAuditorOverviewStats: mockGetStats }));
vi.mock('@/components/dashboard/auditor/AuditorPackClient', () => ({
  default: ({
    stats,
    facilityScoped,
  }: {
    stats: { totalCourses: number };
    facilityScoped?: boolean;
  }) => (
    <div data-testid="auditor-pack-client" data-facility-scoped={String(facilityScoped)}>
      courses {stats.totalCourses}
    </div>
  ),
}));

import AuditorPackPage from './page';

function session(role: string) {
  return {
    user: { id: 'user-1', organizationId: 'org-1', role, email: 'admin@acme.com' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(session('admin'));
  prismaMock.user.findUnique.mockResolvedValue({
    firstName: 'Jane',
    hasSeenAuditorWelcome: true,
  });
  prismaMock.user.update.mockResolvedValue({});
  mockGetStats.mockResolvedValue({
    totalCourses: 3,
    totalStaffAssigned: 30,
    completionRate: 79,
  });
});

describe('Audit Reports page — billing gate', () => {
  it('renders the inline gate instead of the report UI when the org has no auditor access', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ hasAuditorAccess: false });

    render(await AuditorPackPage());

    expect(screen.getByText('Billing required for reports')).toBeInTheDocument();
    expect(screen.getByText('Subscribe to a plan to generate Audit Reports.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /select a plan/i })).toHaveAttribute(
      'href',
      '/dashboard/billing',
    );
    expect(screen.queryByTestId('auditor-pack-client')).not.toBeInTheDocument();
  });

  it('does not query stats for a gated org', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ hasAuditorAccess: false });

    render(await AuditorPackPage());

    expect(mockGetStats).not.toHaveBeenCalled();
  });

  it('renders the report UI with server-fetched stats when access is enabled', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ hasAuditorAccess: true });

    render(await AuditorPackPage());

    expect(screen.getByTestId('auditor-pack-client')).toHaveTextContent('courses 3');
    expect(screen.queryByText('Billing required for reports')).not.toBeInTheDocument();
  });

  it('renders no welcome banner — the design has none', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ hasAuditorAccess: true });

    render(await AuditorPackPage());

    expect(screen.queryByText('Welcome to Your Auditor Workspace!')).not.toBeInTheDocument();
    expect(screen.getByTestId('auditor-pack-client')).toBeInTheDocument();
  });

  it('redirects a non-admin role away before any gate check', async () => {
    mockAuth.mockResolvedValue(session('nurse'));

    await expect(AuditorPackPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  // D-01. The `nurse` case above passed under the old `isAdminRole` gate too —
  // nurse was never in ADMIN_ROLES. These are the roles that gate ADMITTED
  // while holding no auditPack permission, so they are the cases that matter.
  it('redirects finance — in ADMIN_ROLES, but holds no auditPack permission at all', async () => {
    mockAuth.mockResolvedValue(session('finance'));

    await expect(AuditorPackPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
    expect(mockGetStats).not.toHaveBeenCalled();
  });

  // Not every ADMIN_ROLES member is over-scoped here. Clinical Director's D-01
  // exposure was the staff roster (`user.read`); it legitimately holds
  // `auditPack.read`, and supervisor holds it as a read verb. Over-tightening
  // this gate would be its own defect.
  it.each(['clinical_director', 'supervisor', 'hr'])(
    'still admits %s — holds auditPack.read',
    async (role) => {
      mockAuth.mockResolvedValue(session(role));
      prismaMock.organization.findUnique.mockResolvedValue({ hasAuditorAccess: true });

      await expect(AuditorPackPage()).resolves.toBeTruthy();
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );
});

/**
 * The page's own figures are facility-narrowed for a facility-bound role, so it
 * must tell the client which reading it is showing. The flag mirrors
 * `resolveDataFacilityIds`'s first branch — see the page for why they are kept
 * in step rather than derived independently.
 */
describe('Audit Reports page — facility-scope flag', () => {
  beforeEach(() => {
    prismaMock.organization.findUnique.mockResolvedValue({ hasAuditorAccess: true });
  });

  it('marks a supervisor’s view as facility-scoped', async () => {
    mockAuth.mockResolvedValue(session('supervisor'));

    render(await AuditorPackPage());

    expect(screen.getByTestId('auditor-pack-client')).toHaveAttribute(
      'data-facility-scoped',
      'true',
    );
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'leaves a %s view org-wide',
    async (role) => {
      mockAuth.mockResolvedValue(session(role));

      render(await AuditorPackPage());

      expect(screen.getByTestId('auditor-pack-client')).toHaveAttribute(
        'data-facility-scoped',
        'false',
      );
    },
  );
});
