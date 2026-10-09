/**
 * The /system organizations table: active organizations by default, a status
 * filter for deleted ones, and the right row action for each state.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAll, mockDeletePreview, mockRestorePreview } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockDeletePreview: vi.fn(),
  mockRestorePreview: vi.fn(),
}));
vi.mock('@/app/actions/system-admin', () => ({
  getAllOrganizations: mockGetAll,
  getOrganizationDeletePreview: mockDeletePreview,
  getOrganizationRestorePreview: mockRestorePreview,
  deleteOrganization: vi.fn(),
  restoreOrganization: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import SystemOrganizationsClient from './SystemOrganizationsClient';
import type { SystemOrganizationRow } from '@/app/actions/system-admin';

const CREATED = new Date('2026-01-01T00:00:00Z');

function row(overrides: Partial<SystemOrganizationRow> = {}): SystemOrganizationRow {
  return {
    id: 'org-1',
    name: 'Acme Health',
    slug: 'acme-health',
    deletedAt: null,
    createdAt: CREATED,
    memberCount: 5,
    ownerCount: 1,
    facilityCount: 2,
    subscription: { plan: 'growth', status: 'active' },
    ...overrides,
  };
}

const LIVE = row();
const GONE = row({
  id: 'org-2',
  name: 'Gone Care',
  slug: 'gone-care',
  deletedAt: new Date('2026-10-08T10:00:00Z'),
  memberCount: 0,
  ownerCount: 0,
});

function renderClient(initial: SystemOrganizationRow[] = [LIVE]) {
  return render(
    <SystemOrganizationsClient
      initialOrganizations={initial}
      initialTotal={initial.length}
      initialPage={1}
      initialTotalPages={1}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockResolvedValue({ organizations: [LIVE], total: 1, page: 1, totalPages: 1 });
});

describe('SystemOrganizationsClient — status filter', () => {
  it('requests active organizations first', async () => {
    renderClient();

    await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
    expect(mockGetAll).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusFilter: 'active', page: 1 }),
    );
    expect(screen.getByLabelText('Organization status')).toHaveValue('active');
  });

  it('switching the filter to deleted refetches with that filter and shows the Deleted badge', async () => {
    mockGetAll.mockResolvedValueOnce({ organizations: [LIVE], total: 1, page: 1, totalPages: 1 });
    const user = userEvent.setup();
    renderClient();
    await waitFor(() => expect(mockGetAll).toHaveBeenCalledTimes(1));
    mockGetAll.mockResolvedValue({ organizations: [GONE], total: 1, page: 1, totalPages: 1 });

    await user.selectOptions(screen.getByLabelText('Organization status'), 'deleted');

    await waitFor(() =>
      expect(mockGetAll).toHaveBeenLastCalledWith(
        expect.objectContaining({ statusFilter: 'deleted', page: 1 }),
      ),
    );
    expect(await screen.findByText('Gone Care')).toBeVisible();
    expect(screen.getByText('Deleted')).toBeVisible();
    expect(screen.queryByText('Acme Health')).not.toBeInTheDocument();
  });

  it('offers all three filter values', () => {
    renderClient();

    const options = Array.from(
      (screen.getByLabelText('Organization status') as HTMLSelectElement).options,
    ).map((option) => option.value);
    expect(options).toEqual(['active', 'deleted', 'all']);
  });

  it('sends the search text with the request', async () => {
    const user = userEvent.setup();
    renderClient();
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText('Search by name or slug...'), 'ac');

    await waitFor(() =>
      expect(mockGetAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ac' })),
    );
  });
});

describe('SystemOrganizationsClient — rows', () => {
  it('shows an Active badge, members with owner count and the plan with its status', async () => {
    renderClient();

    expect(await screen.findByText('Acme Health')).toBeVisible();
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.getByText(/\(1 owner\)/)).toBeInTheDocument();
    expect(screen.getByText('(active)')).toBeInTheDocument();
  });

  it('offers Delete for a live organization and Restore for a deleted one, each opening its own preview', async () => {
    const user = userEvent.setup();
    mockGetAll.mockResolvedValue({ organizations: [LIVE, GONE], total: 2, page: 1, totalPages: 1 });
    mockDeletePreview.mockResolvedValue(null);
    mockRestorePreview.mockResolvedValue(null);
    renderClient([LIVE, GONE]);
    await screen.findByText('Gone Care');

    const menus = await screen.findAllByRole('button', { name: /actions|more|menu/i });
    expect(menus).toHaveLength(2);

    await user.click(menus[0]);
    expect(screen.queryByRole('menuitem', { name: 'Restore' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(mockDeletePreview).toHaveBeenCalledWith('org-1');
    expect(mockRestorePreview).not.toHaveBeenCalled();

    await user.click((await screen.findAllByRole('button', { name: /actions|more|menu/i }))[1]);
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    expect(mockRestorePreview).toHaveBeenCalledWith('org-2');
  });
});
