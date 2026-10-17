/**
 * Restoring brings back exactly the members the delete deactivated. The modal
 * must say how many, warn (not block) about the plan's seat limit, and refuse
 * outright when no active owner would remain.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRestore } = vi.hoisted(() => ({ mockRestore: vi.fn() }));
vi.mock('@/app/actions/system-admin', () => ({ restoreOrganization: mockRestore }));

import RestoreOrganizationModal from './RestoreOrganizationModal';
import type { OrganizationRestorePreview } from '@/lib/system/delete-organization';

function preview(overrides: Partial<OrganizationRestorePreview> = {}): OrganizationRestorePreview {
  return {
    organization: {
      id: 'org-1',
      name: 'Acme Health',
      slug: 'acme-health',
      deletedAt: new Date('2026-10-08T10:00:00Z'),
    },
    membersToReactivate: 4,
    skippedDeletedUsers: 0,
    ownersAfterRestore: 1,
    seatWarning: null,
    blockedReason: null,
    ...overrides,
  };
}

const restoreButton = () => screen.getByRole('button', { name: 'Restore organization' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RestoreOrganizationModal', () => {
  it('states how many members come back', () => {
    render(<RestoreOrganizationModal preview={preview()} onClose={vi.fn()} />);

    expect(
      screen.getByText(
        'Restoring brings back the 4 members who were active when this organization was deleted.',
      ),
    ).toBeInTheDocument();
    expect(restoreButton()).toBeEnabled();
  });

  it('lists members skipped because their identity was deleted since', () => {
    render(
      <RestoreOrganizationModal
        preview={preview({ membersToReactivate: 3, skippedDeletedUsers: 1 })}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('row', { name: /Deleted users \(not reactivated\)\s*1/ }),
    ).toBeVisible();
  });

  it('warns about the seat limit without blocking the restore', () => {
    render(
      <RestoreOrganizationModal
        preview={preview({ seatWarning: { used: 12, max: 10, over: 2 } })}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/This puts the organization 2 over its plan limit of 10\./),
    ).toBeVisible();
    expect(restoreButton()).toBeEnabled();
  });

  it('shows no seat warning when within the limit', () => {
    render(<RestoreOrganizationModal preview={preview()} onClose={vi.fn()} />);

    expect(screen.queryByText(/over its plan limit/)).not.toBeInTheDocument();
  });

  it('blocks the restore with the owner message and never calls the action', async () => {
    const user = userEvent.setup();
    render(
      <RestoreOrganizationModal
        preview={preview({
          ownersAfterRestore: 0,
          blockedReason:
            'No active owner would remain after restoring. Restore is blocked until an owner is available.',
        })}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'No active owner would remain after restoring. Restore is blocked until an owner is available.',
      ),
    ).toBeVisible();
    expect(restoreButton()).toBeDisabled();
    await user.click(restoreButton());
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('restores and shows the success message', async () => {
    mockRestore.mockResolvedValueOnce({ success: true, membershipsReactivated: 4 });
    const user = userEvent.setup();
    render(<RestoreOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await user.click(restoreButton());

    expect(mockRestore).toHaveBeenCalledWith('org-1');
    expect(await screen.findByText(/restored\./)).toBeVisible();
  });

  it('shows a returned error and keeps the modal open', async () => {
    mockRestore.mockResolvedValueOnce({
      success: false,
      error: 'This organization is not deleted.',
    });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RestoreOrganizationModal preview={preview()} onClose={onClose} />);

    await user.click(restoreButton());

    expect(await screen.findByText('This organization is not deleted.')).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});
