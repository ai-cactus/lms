/**
 * The AI course-generation job queue was ungated: `await auth()` with the result
 * used only as a query filter, and no role check anywhere. Any authenticated
 * session — every worker included — reached it by typing the URL.
 *
 * The verb is `course.create`, not `course.read`. This page exists to show
 * generation state, its only entry point is the pending-generation banner on the
 * Courses list, and only a role that can author a course can ever produce a row
 * here. `course.read` is held by 13 of the 14 roles and would readmit every
 * worker to a page they can never populate — the same reasoning that put the
 * compliance-mapping page on `document.read` rather than `course.read`.
 *
 * Denial is `notFound` per founder ruling Q26
 * (docs/local/RBAC-founder-answers-2026-09-15.md).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { job: { findMany: vi.fn() } },
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock('@/components/jobs/JobStatusBadge', () => ({
  JobStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import QueuePage from './page';

function setSession(role: string) {
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      // Required: evaluatePermission masks the email into its denial warning.
      email: 'gate@test.invalid',
      role,
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
    },
  });
}

function renderPage() {
  return QueuePage({ searchParams: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession('owner');
  prismaMock.job.findMany.mockResolvedValue([]);
});

describe('QueuePage — course.create gate', () => {
  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'renders the queue for %s, which holds course.create',
    async (role) => {
      setSession(role);

      render(await renderPage());

      expect(screen.getByRole('heading', { name: /job queue/i })).toBeInTheDocument();
      expect(mockNotFound).not.toHaveBeenCalled();
    },
  );

  // Q26: the pair is the assertion — dropping the option leaves `notFound`
  // uncalled and `redirect` called, so either half alone can pass wrongly.
  it.each(['finance', 'supervisor', 'front_desk_admin', 'nurse'])(
    '404s %s, which holds no course.create, without reading any job',
    async (role) => {
      setSession(role);

      await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(prismaMock.job.findMany).not.toHaveBeenCalled();
    },
  );

  it('redirects to /login when there is no session — not a 404', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(prismaMock.job.findMany).not.toHaveBeenCalled();
  });

  // The user filter now comes from the guard's verified context rather than an
  // optional-chained session read, which silently became `userId: undefined` —
  // i.e. "every user's jobs" — whenever the session was absent.
  it('scopes the job query to the authenticated caller', async () => {
    render(await renderPage());

    expect(prismaMock.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });
});
