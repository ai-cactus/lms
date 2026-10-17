/**
 * The /system users table: a slower, earlier search response must never
 * overwrite the results of a later one.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAllUsers } = vi.hoisted(() => ({ mockGetAllUsers: vi.fn() }));
vi.mock('@/app/actions/system-admin', () => ({
  getAllUsers: mockGetAllUsers,
  getUserDeletePreview: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import SystemUsersClient from './SystemUsersClient';
import type { SystemUserRow } from '@/app/actions/system-admin';

function userRow(id: string, email: string): SystemUserRow {
  return {
    id,
    email,
    role: 'owner',
    authProvider: 'credentials',
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    organizationId: 'org-1',
    organizationName: 'Acme Health',
    profile: null,
    _count: { courses: 0, enrollments: 0, documents: 0, notifications: 0 },
  };
}

const ALPHA = userRow('u1', 'alpha@acme.test');
const BRAVO = userRow('u2', 'bravo@acme.test');

const page = (users: SystemUserRow[]) => ({ users, total: users.length, page: 1, totalPages: 1 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderClient() {
  return render(
    <SystemUsersClient
      initialUsers={[ALPHA]}
      initialTotal={1}
      initialPage={1}
      initialTotalPages={1}
      organizations={[{ id: 'org-1', name: 'Acme Health', deletedAt: null }]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllUsers.mockReset();
});

describe('SystemUsersClient — out-of-order responses', () => {
  it('keeps the newest search results when an earlier, slower response arrives last', async () => {
    const stale = deferred<ReturnType<typeof page>>();
    const fresh = deferred<ReturnType<typeof page>>();
    mockGetAllUsers
      .mockResolvedValueOnce(page([ALPHA]))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const user = userEvent.setup();
    renderClient();
    await waitFor(() => expect(mockGetAllUsers).toHaveBeenCalledTimes(1));

    await user.type(screen.getByPlaceholderText('Search by email or name...'), 'br');
    await waitFor(() => expect(mockGetAllUsers).toHaveBeenCalledTimes(3));
    expect(mockGetAllUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'br' }));

    fresh.resolve(page([BRAVO]));
    expect(await screen.findByText('bravo@acme.test')).toBeVisible();
    await act(async () => {
      stale.resolve(page([ALPHA]));
    });

    expect(screen.getByText('bravo@acme.test')).toBeVisible();
    expect(screen.queryByText('alpha@acme.test')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading users...')).not.toBeInTheDocument();
  });

  it('stays loading until the newest request settles, even if an older one finishes first', async () => {
    const stale = deferred<ReturnType<typeof page>>();
    const fresh = deferred<ReturnType<typeof page>>();
    mockGetAllUsers
      .mockResolvedValueOnce(page([ALPHA]))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const user = userEvent.setup();
    renderClient();
    await waitFor(() => expect(mockGetAllUsers).toHaveBeenCalledTimes(1));

    await user.type(screen.getByPlaceholderText('Search by email or name...'), 'br');
    await waitFor(() => expect(mockGetAllUsers).toHaveBeenCalledTimes(3));

    await act(async () => {
      stale.resolve(page([ALPHA]));
    });
    expect(screen.getByText('Loading users...')).toBeVisible();

    fresh.resolve(page([BRAVO]));
    expect(await screen.findByText('bravo@acme.test')).toBeVisible();
    expect(screen.queryByText('Loading users...')).not.toBeInTheDocument();
  });
});
