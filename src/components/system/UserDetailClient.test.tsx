/**
 * The permanent-delete control on the user detail page appears only for an
 * already soft-deleted user AND only where the environment flag is on; a live
 * user keeps the soft-delete danger zone and nothing else.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPush, mockHardPreview, mockSoftPreview } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHardPreview: vi.fn(),
  mockSoftPreview: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));
vi.mock('@/app/actions/system-admin', () => ({
  getUserDeletePreview: mockSoftPreview,
  getUserHardDeletePreview: mockHardPreview,
}));
vi.mock('./HardDeleteUserModal', () => ({
  default: ({
    preview,
    onSuccess,
  }: {
    preview: { user: { email: string } };
    onSuccess: () => void;
  }) => (
    <div role="dialog" aria-label="hard delete modal">
      {preview.user.email}
      <button onClick={onSuccess}>finish</button>
    </div>
  ),
}));
vi.mock('./DeleteUserModal', () => ({ default: () => <div role="dialog">soft delete modal</div> }));

import UserDetailClient from './UserDetailClient';
import type { SystemUserDetail } from '@/app/actions/system-admin';

function detail(overrides: Partial<SystemUserDetail> = {}): SystemUserDetail {
  return {
    id: 'u1',
    email: 'dana@acme.test',
    role: 'worker',
    authProvider: 'credentials',
    emailVerified: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    deletedAt: null,
    organization: { id: 'o1', name: 'Acme', slug: 'acme' },
    profile: { fullName: 'Dana Departed', firstName: 'Dana', lastName: 'Departed' },
    courses: [],
    enrollments: [],
    documents: [],
    _count: { courses: 0, enrollments: 0, documents: 0, notifications: 0 },
    ...overrides,
  };
}

const DELETED = new Date('2026-10-01');
const HARD_BUTTON = { name: 'Permanently delete' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserDetailClient — permanent deletion control', () => {
  it('shows the control for a soft-deleted user when the flag is on', () => {
    render(<UserDetailClient user={detail({ deletedAt: DELETED })} hardDeleteEnabled />);

    expect(screen.getByText('Permanent deletion')).toBeVisible();
    expect(
      screen.getByText(
        'This user is already deleted. Permanently deleting removes their account and every record tied to it. This cannot be undone.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', HARD_BUTTON)).toBeEnabled();
  });

  it('hides it when the flag is off, even for a soft-deleted user', () => {
    render(<UserDetailClient user={detail({ deletedAt: DELETED })} hardDeleteEnabled={false} />);

    expect(screen.queryByText('Permanent deletion')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', HARD_BUTTON)).not.toBeInTheDocument();
  });

  it('hides it for a user who has not been soft-deleted, even with the flag on', () => {
    render(<UserDetailClient user={detail()} hardDeleteEnabled />);

    expect(screen.queryByRole('button', HARD_BUTTON)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete This User/ })).toBeVisible();
  });

  it('a soft-deleted user shows no soft-delete danger zone', () => {
    render(<UserDetailClient user={detail({ deletedAt: DELETED })} hardDeleteEnabled />);

    expect(screen.queryByRole('button', { name: /Delete This User/ })).not.toBeInTheDocument();
  });

  it('loads the preview on click and opens the modal, then goes back to /system on success', async () => {
    mockHardPreview.mockResolvedValue({ user: { email: 'dana@acme.test' } });
    const user = userEvent.setup();
    render(<UserDetailClient user={detail({ deletedAt: DELETED })} hardDeleteEnabled />);

    await user.click(screen.getByRole('button', HARD_BUTTON));

    expect(mockHardPreview).toHaveBeenCalledWith('u1');
    const modal = await screen.findByRole('dialog', { name: 'hard delete modal' });
    expect(modal).toHaveTextContent('dana@acme.test');

    await user.click(screen.getByRole('button', { name: 'finish' }));
    expect(mockPush).toHaveBeenCalledWith('/system');
  });

  it('opens no modal when the preview is null or fails', async () => {
    const user = userEvent.setup();
    render(<UserDetailClient user={detail({ deletedAt: DELETED })} hardDeleteEnabled />);

    mockHardPreview.mockResolvedValueOnce(null);
    await user.click(screen.getByRole('button', HARD_BUTTON));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    mockHardPreview.mockRejectedValueOnce(new Error('Unauthorized'));
    await user.click(screen.getByRole('button', HARD_BUTTON));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', HARD_BUTTON)).toBeEnabled();
  });
});
