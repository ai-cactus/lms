/**
 * The permanent organization delete confirmation. The destructive button needs
 * the exact name, the word DELETE and the acknowledgement; a refusal in the
 * preview locks the whole form. The Stripe cancel box shows only for a live
 * subscription and starts ticked. (The server re-validates everything — see
 * hard-delete-organization.test.ts.)
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHardDelete } = vi.hoisted(() => ({ mockHardDelete: vi.fn() }));
vi.mock('@/app/actions/system-admin', () => ({ hardDeleteOrganization: mockHardDelete }));

import HardDeleteOrganizationModal from './HardDeleteOrganizationModal';
import type { OrganizationHardDeletePreview } from '@/lib/system/hard-delete-organization';

const NAME = 'Acme Behavioral Health';
const DELETE_BUTTON = { name: 'Permanently delete' };
const CANCEL_BOX = { name: /Cancel the Stripe subscription now/ };
const ACK_BOX = { name: /I understand this permanently destroys/ };

function preview(
  overrides: Partial<OrganizationHardDeletePreview> = {},
): OrganizationHardDeletePreview {
  return {
    enabled: true,
    organization: { id: 'org-1', name: NAME, slug: 'acme', deletedAt: new Date('2026-10-01') },
    refusal: null,
    destroyed: {
      memberships: 3,
      facilities: 1,
      courses: 2,
      lessons: 5,
      documents: 1,
      documentVersions: 1,
      enrollments: 4,
      quizAttempts: 6,
      certificates: 2,
      notifications: 0,
      courseAssignments: 1,
      offerings: 0,
      invites: 1,
      invoices: 3,
      categories: 4,
      emailMessages: 2,
      notificationEvents: 1,
      cycleSummaryRuns: 0,
      jobs: 0,
    },
    storageObjects: 7,
    kept: {
      users: 3,
      usersAlsoInOtherOrgs: 1,
      usersLeftWithoutOrganization: 2,
      auditLogs: 12,
      phiDecisions: 0,
      stripeCustomer: true,
    },
    subscription: { plan: 'growth', status: 'active', cancelAtPeriodEnd: false },
    canCancelSubscription: true,
    ...overrides,
  };
}

async function confirmAll(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(`Type ${NAME} to confirm`), NAME);
  await user.type(screen.getByPlaceholderText('DELETE'), 'DELETE');
  await user.click(screen.getByRole('checkbox', ACK_BOX));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HardDeleteOrganizationModal', () => {
  it('keeps the button disabled until name, word and acknowledgement all match', async () => {
    const user = userEvent.setup();
    render(<HardDeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);
    const button = screen.getByRole('button', DELETE_BUTTON);

    await user.type(screen.getByPlaceholderText(`Type ${NAME} to confirm`), NAME);
    expect(button).toBeDisabled();
    await user.type(screen.getByPlaceholderText('DELETE'), 'delete');
    await user.click(screen.getByRole('checkbox', ACK_BOX));
    expect(button).toBeDisabled();

    await user.clear(screen.getByPlaceholderText('DELETE'));
    await user.type(screen.getByPlaceholderText('DELETE'), 'DELETE');
    expect(button).toBeEnabled();
  });

  it('pre-ticks the Stripe cancel for a live subscription and sends it', async () => {
    const user = userEvent.setup();
    mockHardDelete.mockResolvedValue({ success: true, subscriptionCancelled: true });
    render(<HardDeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    expect(screen.getByRole('checkbox', CANCEL_BOX)).toBeChecked();
    await confirmAll(user);
    await user.click(screen.getByRole('button', DELETE_BUTTON));

    expect(mockHardDelete).toHaveBeenCalledWith('org-1', {
      confirmName: NAME,
      confirmWord: 'DELETE',
      acknowledged: true,
      cancelSubscription: true,
    });
    expect(await screen.findByText('The Stripe subscription was cancelled.')).toBeVisible();
  });

  it('warns that billing continues when the Stripe cancel is cleared', async () => {
    const user = userEvent.setup();
    mockHardDelete.mockResolvedValue({ success: true });
    render(<HardDeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', CANCEL_BOX));
    expect(
      screen.getByText(
        'Billing keeps running in Stripe until the subscription is cancelled there.',
      ),
    ).toBeVisible();

    await confirmAll(user);
    await user.click(screen.getByRole('button', DELETE_BUTTON));
    expect(mockHardDelete).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ cancelSubscription: false }),
    );
  });

  it('offers no Stripe cancel without a live subscription', () => {
    render(
      <HardDeleteOrganizationModal
        preview={preview({
          subscription: { plan: 'growth', status: 'canceled', cancelAtPeriodEnd: false },
          canCancelSubscription: false,
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('checkbox', CANCEL_BOX)).not.toBeInTheDocument();
  });

  it('a refusal disables every input and the button', () => {
    render(
      <HardDeleteOrganizationModal
        preview={preview({ refusal: 'This organization owns 1 global course(s).' })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('This organization owns 1 global course(s).')).toBeVisible();
    expect(screen.getByRole('button', DELETE_BUTTON)).toBeDisabled();
    expect(screen.getByRole('checkbox', ACK_BOX)).toBeDisabled();
    expect(screen.getByPlaceholderText('DELETE')).toBeDisabled();
  });

  it('shows a returned error, and that billing already stopped', async () => {
    const user = userEvent.setup();
    mockHardDelete.mockResolvedValue({
      success: false,
      error: "Some records still reference this organization's data, so nothing was deleted.",
      subscriptionCancelled: true,
    });
    render(<HardDeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await confirmAll(user);
    await user.click(screen.getByRole('button', DELETE_BUTTON));

    expect(
      await screen.findByText(/Some records still reference this organization's data/),
    ).toBeVisible();
    expect(screen.getByText(/The Stripe subscription was already cancelled/)).toBeVisible();
  });

  it('reports stored files that could not be removed', async () => {
    const user = userEvent.setup();
    mockHardDelete.mockResolvedValue({ success: true, storageFailures: 2 });
    render(<HardDeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await confirmAll(user);
    await user.click(screen.getByRole('button', DELETE_BUTTON));

    expect(
      await screen.findByText(
        '2 stored file(s) could not be removed. They were recorded for retry.',
      ),
    ).toBeVisible();
  });
});
