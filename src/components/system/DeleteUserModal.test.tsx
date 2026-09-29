/**
 * Q-23 — the delete confirmation says what the soft delete actually does:
 * access is removed, nothing is destroyed, and compliance records are retained.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDelete } = vi.hoisted(() => ({ mockDelete: vi.fn() }));
vi.mock('@/app/actions/system-admin', () => ({ deleteUserWithRelations: mockDelete }));

import DeleteUserModal from './DeleteUserModal';
import type { DeletePreview } from '@/app/actions/system-admin';

function preview(
  overrides: {
    revoked?: Partial<DeletePreview['revoked']>;
    retained?: Partial<DeletePreview['retained']>;
  } = {},
): DeletePreview {
  return {
    user: { id: 'u1', email: 'manager@acme.com', role: 'supervisor', name: 'Mia Manager' },
    deletedAt: null,
    revoked: { organizations: ['Acme'], pendingInvites: 0, ...overrides.revoked },
    retained: {
      enrollments: 0,
      quizAttempts: 0,
      certificates: 0,
      courses: 0,
      documents: 0,
      directReports: 0,
      ...overrides.retained,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeleteUserModal — Q-23 copy', () => {
  it('states that access is removed and records are retained', () => {
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);

    expect(
      screen.getByText(
        "This removes Mia Manager's access to every organization. Certificates, quiz history and completion records are retained for compliance and are not deleted.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/permanently/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });

  it('keeps the button verb "Delete"', () => {
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('warns that the email stays reserved', () => {
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);
    expect(screen.getByText(/email address stays reserved/i)).toBeInTheDocument();
  });
});

describe('DeleteUserModal — impact preview', () => {
  it('lists certificates, enrollments and attempts as retained', () => {
    render(
      <DeleteUserModal
        preview={preview({ retained: { certificates: 3, enrollments: 5, quizAttempts: 7 } })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Records retained:' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Certificates/ })).getByText('3')).toBeVisible();
    expect(within(screen.getByRole('row', { name: /Enrollments/ })).getByText('5')).toBeVisible();
    expect(within(screen.getByRole('row', { name: /Quiz Attempts/ })).getByText('7')).toBeVisible();
  });

  it('lists deactivated memberships and expired invites as access removed', () => {
    render(
      <DeleteUserModal
        preview={preview({ revoked: { organizations: ['Acme', 'Beta'], pendingInvites: 1 } })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Acme, Beta')).toBeInTheDocument();
    const memberships = screen.getByRole('row', { name: /Organization memberships/ });
    expect(within(memberships).getByText('2')).toBeVisible();
    const invites = screen.getByRole('row', { name: /Pending invites \(expired\)/ });
    expect(within(invites).getByText('1')).toBeVisible();
  });

  it('keeps direct reports on the retained side with their manager link', () => {
    render(
      <DeleteUserModal preview={preview({ retained: { directReports: 4 } })} onClose={vi.fn()} />,
    );

    const row = screen.getByRole('row', { name: /Direct reports \(manager link kept\)/ });
    expect(within(row).getByText('4')).toBeVisible();
  });

  it('hides zero-count rows', () => {
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);
    expect(screen.queryByRole('row', { name: /Certificates/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Records retained:' })).not.toBeInTheDocument();
  });
});

describe('DeleteUserModal — confirm flow', () => {
  it('deletes once the email is typed and shows the retained-records success message', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, membershipsDeactivated: 1 });
    const user = userEvent.setup();
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'manager@acme.com');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('u1');
    expect(await screen.findByText(/can no longer sign in to any organization/)).toBeVisible();
  });

  it('shows a returned refusal', async () => {
    mockDelete.mockResolvedValueOnce({
      success: false,
      error: 'This user was already deleted on 2026-09-28.',
    });
    const user = userEvent.setup();
    render(<DeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'manager@acme.com');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('This user was already deleted on 2026-09-28.')).toBeVisible();
  });
});
