/**
 * The permanent-delete control on the organization detail page appears only for
 * an already soft-deleted organization AND only where the environment flag is
 * on. A successful delete leaves the page (the organization no longer exists).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPush, mockHardPreview } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHardPreview: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));
vi.mock('@/app/actions/system-admin', () => ({
  getOrganizationDeletePreview: vi.fn(),
  getOrganizationRestorePreview: vi.fn(),
  getOrganizationHardDeletePreview: mockHardPreview,
}));
vi.mock('./HardDeleteOrganizationModal', () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => (
    <div role="dialog" aria-label="hard delete modal">
      <button onClick={onSuccess}>finish</button>
    </div>
  ),
}));

import OrganizationDetailClient from './OrganizationDetailClient';
import type { SystemOrganizationDetail } from '@/app/actions/system-admin';

function detail(overrides: Partial<SystemOrganizationDetail> = {}): SystemOrganizationDetail {
  return {
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    createdAt: new Date('2026-01-01'),
    deletedAt: new Date('2026-10-01'),
    memberTotal: 0,
    members: [],
    facilities: [],
    subscription: null,
    ...overrides,
  };
}

const PERMANENT = { name: 'Permanently delete' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrganizationDetailClient permanent deletion', () => {
  it('is offered for a soft-deleted organization when the flag is on', () => {
    render(<OrganizationDetailClient organization={detail()} hardDeleteEnabled />);

    expect(screen.getByText('Permanent deletion')).toBeVisible();
    expect(screen.getByRole('button', PERMANENT)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restore This Organization' })).toBeVisible();
  });

  it('is hidden when the flag is off', () => {
    render(<OrganizationDetailClient organization={detail()} hardDeleteEnabled={false} />);

    expect(screen.queryByRole('button', PERMANENT)).not.toBeInTheDocument();
  });

  it('is hidden for a live organization', () => {
    render(
      <OrganizationDetailClient organization={detail({ deletedAt: null })} hardDeleteEnabled />,
    );

    expect(screen.queryByRole('button', PERMANENT)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete This Organization' })).toBeVisible();
  });

  it('loads the preview, then returns to the organization list on success', async () => {
    const user = userEvent.setup();
    mockHardPreview.mockResolvedValue({ refusal: null });
    render(<OrganizationDetailClient organization={detail()} hardDeleteEnabled />);

    await user.click(screen.getByRole('button', PERMANENT));
    expect(mockHardPreview).toHaveBeenCalledWith('org-1');

    await user.click(await screen.findByRole('button', { name: 'finish' }));
    expect(mockPush).toHaveBeenCalledWith('/system/organizations');
  });
});
