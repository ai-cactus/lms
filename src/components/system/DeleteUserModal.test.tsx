/**
 * BUG-27 — the delete confirmation must show everything the delete does:
 * the notification preferences that cascade away, and the direct reports who
 * silently lose their manager when `OrganizationUser.managerId` is SetNull.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/actions/system-admin', () => ({ deleteUserWithRelations: vi.fn() }));

import DeleteUserModal from './DeleteUserModal';
import type { DeletePreview } from '@/app/actions/system-admin';

function preview(
  overrides: {
    counts?: Partial<DeletePreview['counts']>;
    retained?: Partial<DeletePreview['retained']>;
  } = {},
): DeletePreview {
  return {
    user: { id: 'u1', email: 'manager@acme.com', role: 'supervisor', name: 'Mia Manager' },
    counts: {
      enrollments: 0,
      quizAttempts: 0,
      certificates: 0,
      notifications: 0,
      notificationPreferences: 0,
      jobs: 0,
      invites: 0,
      verificationTokens: 0,
      ...overrides.counts,
    },
    retained: {
      courses: 0,
      documents: 0,
      otherEnrollments: 0,
      directReports: 0,
      organizationsWithoutCustodian: [],
      ...overrides.retained,
    },
  };
}

describe('DeleteUserModal — impact preview', () => {
  it('lists notification preferences among the records deleted', () => {
    render(
      <DeleteUserModal
        preview={preview({ counts: { notificationPreferences: 3 } })}
        onClose={vi.fn()}
      />,
    );

    const row = screen.getByRole('row', { name: /Notification Preferences/ });
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  it('warns that direct reports will lose their manager and lists them as kept', () => {
    render(
      <DeleteUserModal preview={preview({ retained: { directReports: 4 } })} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/direct reports will lose their manager/i)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Direct reports \(manager cleared\)/ });
    expect(within(row).getByText('4')).toBeInTheDocument();
  });

  it('uses the singular for one direct report', () => {
    render(
      <DeleteUserModal preview={preview({ retained: { directReports: 1 } })} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/direct report will lose their manager/i)).toBeInTheDocument();
  });

  it('shows no manager warning when nobody reports to the user', () => {
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);

    expect(screen.queryByText(/lose their manager/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Direct reports/ })).not.toBeInTheDocument();
  });
});
