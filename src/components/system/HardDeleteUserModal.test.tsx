/**
 * The permanent-delete confirmation. The destructive button needs BOTH the exact
 * email and the acknowledgement; a refusal in the preview locks the whole form.
 * (The server re-validates both — see hard-delete-user.test.ts.)
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHardDelete } = vi.hoisted(() => ({ mockHardDelete: vi.fn() }));
vi.mock('@/app/actions/system-admin', () => ({ hardDeleteUser: mockHardDelete }));

import HardDeleteUserModal from './HardDeleteUserModal';
import type { UserHardDeletePreview } from '@/lib/system/hard-delete-user';

const EMAIL = 'Dana.Departed@Acme.test';

function preview(overrides: Partial<UserHardDeletePreview> = {}): UserHardDeletePreview {
  return {
    enabled: true,
    user: { id: 'u1', email: EMAIL, name: 'Dana Departed', deletedAt: new Date('2026-10-01') },
    refusal: null,
    authored: { courses: 0, documents: 0 },
    destroyed: {
      memberships: 2,
      enrollments: 4,
      quizAttempts: 9,
      certificates: 3,
      notifications: 6,
      invites: 1,
      emailMessages: 5,
      notificationEvents: 7,
      jobs: 1,
      mfaFactors: 1,
      mfaRecoveryCodes: 10,
      verificationTokens: 1,
    },
    storageObjects: { avatarFolder: true, certificatePdfs: 3 },
    directReports: 0,
    organizations: [{ name: 'Acme', deleted: false, wasOwner: false }],
    ...overrides,
  };
}

const DELETE_BUTTON = { name: 'Permanently delete' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HardDeleteUserModal — gating the destructive button', () => {
  it('is disabled until the email matches exactly AND the box is ticked', async () => {
    const user = userEvent.setup();
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);
    const button = screen.getByRole('button', DELETE_BUTTON);
    const box = screen.getByRole('textbox');
    const checkbox = screen.getByRole('checkbox');

    expect(button).toBeDisabled();

    await user.type(box, EMAIL);
    expect(button).toBeDisabled();

    await user.click(checkbox);
    expect(button).toBeEnabled();

    await user.click(checkbox);
    expect(button).toBeDisabled();
  });

  it.each([
    ['wrong case', EMAIL.toLowerCase()],
    ['a trailing space', `${EMAIL} `],
    ['a prefix', EMAIL.slice(0, -1)],
    ['another address', 'someone@else.test'],
  ])('stays disabled when the typed email is %s', async (_label, typed) => {
    const user = userEvent.setup();
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByRole('textbox'), typed);

    expect(screen.getByRole('button', DELETE_BUTTON)).toBeDisabled();
  });

  it('does not call the server action while the button is disabled', async () => {
    const user = userEvent.setup();
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', DELETE_BUTTON));

    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('a refusal disables the inputs and the button even with a correct email', async () => {
    render(
      <HardDeleteUserModal
        preview={preview({
          refusal:
            'This user authored 1 course(s) and uploaded 0 document(s). Delete the organization instead; content is never reassigned.',
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/This user authored 1 course\(s\)/)).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', DELETE_BUTTON)).toBeDisabled();
  });
});

describe('HardDeleteUserModal — content', () => {
  it('shows the approved copy', () => {
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Permanently delete user' })).toBeVisible();
    expect(
      screen.getByText(
        "This permanently removes Dana Departed's account and the records below. There is no restore.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        `The email address will be free to register again. A new sign-up with ${EMAIL} creates a brand-new account with none of this history.`,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Certificates are compliance records. Once destroyed, their verification links stop working.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Audit-log entries are kept. They contain ids only.')).toBeVisible();
    expect(
      screen.getByText(
        'I understand this permanently destroys the records above, including certificates.',
      ),
    ).toBeVisible();
    expect(screen.getByText('To confirm, type the email address below:')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Permanently destroyed:' })).toBeVisible();
  });

  it('lists every destroyed category with its count', () => {
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    const expected: [RegExp, string][] = [
      [/Organization memberships/, '2'],
      [/Enrollments/, '4'],
      [/Quiz attempts/, '9'],
      [/^Certificates/, '3'],
      [/Notifications/, '6'],
      [/Invites to this email/, '1'],
      [/Emails sent to this address/, '5'],
      [/Stored files/, '3'],
    ];
    for (const [label, count] of expected) {
      expect(within(screen.getByRole('row', { name: label })).getByText(count)).toBeVisible();
    }
  });

  it('renders zero-count rows instead of hiding them', () => {
    render(
      <HardDeleteUserModal
        preview={preview({
          destroyed: {
            memberships: 0,
            enrollments: 0,
            quizAttempts: 0,
            certificates: 0,
            notifications: 0,
            invites: 0,
            emailMessages: 0,
            notificationEvents: 0,
            jobs: 0,
            mfaFactors: 0,
            mfaRecoveryCodes: 0,
            verificationTokens: 0,
          },
          storageObjects: { avatarFolder: true, certificatePdfs: 0 },
        })}
        onClose={vi.fn()}
      />,
    );

    for (const label of [/Enrollments/, /^Certificates/, /Emails sent to this address/]) {
      expect(within(screen.getByRole('row', { name: label })).getByText('0')).toBeVisible();
    }
  });

  it('names the organizations, marking owner and deleted', () => {
    render(
      <HardDeleteUserModal
        preview={preview({
          organizations: [
            { name: 'Acme', deleted: false, wasOwner: true },
            { name: 'Beta', deleted: true, wasOwner: false },
          ],
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Acme (owner), Beta (deleted)')).toBeVisible();
  });

  it('mentions direct reports only when there are some', () => {
    const { rerender } = render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);
    expect(screen.queryByText(/direct report/)).not.toBeInTheDocument();

    rerender(<HardDeleteUserModal preview={preview({ directReports: 3 })} onClose={vi.fn()} />);
    expect(screen.getByText('3 direct report(s) will no longer have a manager.')).toBeVisible();
  });
});

describe('HardDeleteUserModal — submitting', () => {
  async function fillAndSubmit() {
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), EMAIL);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', DELETE_BUTTON));
  }

  it('sends the user id, the typed email and the acknowledgement', async () => {
    mockHardDelete.mockResolvedValue({ success: true, storageFailures: 0 });
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await fillAndSubmit();

    expect(mockHardDelete).toHaveBeenCalledTimes(1);
    expect(mockHardDelete).toHaveBeenCalledWith('u1', { confirmEmail: EMAIL, acknowledged: true });
  });

  it('shows the success message and, after the delay, calls onSuccess then onClose', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockHardDelete.mockResolvedValue({ success: true, storageFailures: 0 });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<HardDeleteUserModal preview={preview()} onClose={onClose} onSuccess={onSuccess} />);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole('textbox'), EMAIL);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', DELETE_BUTTON));

    expect(await screen.findByText(/permanently deleted\. Redirecting/)).toBeVisible();
    expect(screen.getByText(EMAIL)).toBeVisible();
    expect(screen.queryByText(/could not be removed/)).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports partial storage failure without calling it a failure', async () => {
    mockHardDelete.mockResolvedValue({ success: true, storageFailures: 2 });
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await fillAndSubmit();

    expect(await screen.findByText(/permanently deleted\. Redirecting/)).toBeVisible();
    expect(
      screen.getByText('2 stored file(s) could not be removed. They were recorded for retry.'),
    ).toBeVisible();
  });

  it('shows a returned refusal and keeps the form open for another attempt', async () => {
    mockHardDelete.mockResolvedValue({
      success: false,
      error: 'This user has 1 background job(s) still running. Try again once they finish.',
    });
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await fillAndSubmit();

    expect(
      await screen.findByText(
        'This user has 1 background job(s) still running. Try again once they finish.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', DELETE_BUTTON)).toBeEnabled();
  });

  it('shows a generic message when the action throws', async () => {
    mockHardDelete.mockRejectedValue(new Error('network'));
    render(<HardDeleteUserModal preview={preview()} onClose={vi.fn()} />);

    await fillAndSubmit();

    expect(await screen.findByText('An unexpected error occurred')).toBeVisible();
  });

  it('Cancel closes without calling the server', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HardDeleteUserModal preview={preview()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockHardDelete).not.toHaveBeenCalled();
  });
});
