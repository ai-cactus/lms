/**
 * Soft-deleting an organization is a cross-tenant action: the button stays
 * disabled until BOTH the exact organization name and the word DELETE are
 * typed, and never enables while the preview carries a refusal.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDelete } = vi.hoisted(() => ({ mockDelete: vi.fn() }));
vi.mock('@/app/actions/system-admin', () => ({ deleteOrganization: mockDelete }));

import DeleteOrganizationModal from './DeleteOrganizationModal';
import type { OrganizationSoftDeletePreview } from '@/lib/system/delete-organization';

function preview(
  overrides: Partial<OrganizationSoftDeletePreview> = {},
): OrganizationSoftDeletePreview {
  return {
    organization: { id: 'org-1', name: 'Acme Health', slug: 'acme-health', deletedAt: null },
    refusal: null,
    members: { active: 5, owners: 1, alsoInOtherLiveOrgs: 2 },
    pendingInvites: 3,
    subscription: null,
    retained: {
      courses: 4,
      documents: 6,
      enrollments: 20,
      certificates: 8,
      quizAttempts: 0,
      facilities: 1,
    },
    usedByOtherOrgs: { enrollments: 0, offerings: 0, certificates: 0 },
    ...overrides,
  };
}

const NAME_LABEL = 'Type the organization name to confirm:';
const WORD_LABEL = 'Type DELETE to confirm:';
const deleteButton = () => screen.getByRole('button', { name: 'Delete organization' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeleteOrganizationModal — copy', () => {
  it('says access is removed and records are retained and restorable', () => {
    render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    expect(
      screen.getByText(
        "This removes everyone's access to Acme Health. Courses, documents, enrollments, certificates and billing records are retained and can be restored.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/permanently/i)).not.toBeInTheDocument();
  });

  it('lists what loses access and what is retained, hiding zero rows', () => {
    render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Access removed:' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Active members/ })).getByText('5'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('row', { name: /Pending invites/ })).getByText('3'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Records retained:' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Certificates/ })).getByText('8')).toBeVisible();
    expect(screen.queryByRole('row', { name: /Quiz Attempts/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Used by other organizations/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the other-organization usage table only when something is shared', () => {
    render(
      <DeleteOrganizationModal
        preview={preview({ usedByOtherOrgs: { enrollments: 2, offerings: 0, certificates: 0 } })}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Used by other organizations (unchanged):' }),
    ).toBeInTheDocument();
  });
});

describe('DeleteOrganizationModal — subscription alert', () => {
  it.each(['active', 'past_due', 'trialing'])(
    'warns that a %s subscription is NOT cancelled',
    (status) => {
      render(
        <DeleteOrganizationModal
          preview={preview({
            subscription: { plan: 'growth', status, cancelAtPeriodEnd: false },
          })}
          onClose={vi.fn()}
        />,
      );

      expect(
        screen.getByText(
          `This organization has a ${status} subscription. Deleting it does NOT cancel billing.`,
        ),
      ).toBeVisible();
    },
  );

  it('shows no billing warning without a subscription or with a cancelled one', () => {
    const { rerender } = render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);
    expect(screen.queryByText(/does NOT cancel billing/)).not.toBeInTheDocument();

    rerender(
      <DeleteOrganizationModal
        preview={preview({
          subscription: { plan: 'growth', status: 'canceled', cancelAtPeriodEnd: false },
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/does NOT cancel billing/)).not.toBeInTheDocument();
  });
});

describe('DeleteOrganizationModal — confirmation gate', () => {
  it('is disabled until both the exact name and DELETE are typed', async () => {
    const user = userEvent.setup();
    render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);
    expect(deleteButton()).toBeDisabled();

    await user.type(screen.getByLabelText(NAME_LABEL), 'Acme Health');
    expect(deleteButton()).toBeDisabled();

    await user.type(screen.getByLabelText(WORD_LABEL), 'DELETE');
    expect(deleteButton()).toBeEnabled();
  });

  it('stays disabled when only the word is typed', async () => {
    const user = userEvent.setup();
    render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(WORD_LABEL), 'DELETE');

    expect(deleteButton()).toBeDisabled();
  });

  it.each([
    ['a name with different case', 'acme health', 'DELETE'],
    ['a partial name', 'Acme', 'DELETE'],
    ['a name with a trailing space', 'Acme Health ', 'DELETE'],
    ['a lowercase word', 'Acme Health', 'delete'],
    ['a partial word', 'Acme Health', 'DELET'],
  ])('stays disabled for %s', async (_label, name, word) => {
    const user = userEvent.setup();
    render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(NAME_LABEL), name);
    await user.type(screen.getByLabelText(WORD_LABEL), word);

    expect(deleteButton()).toBeDisabled();
  });

  it('deletes with both typed values and shows the success message', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, membershipsDeactivated: 5 });
    const user = userEvent.setup();
    render(<DeleteOrganizationModal preview={preview()} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(NAME_LABEL), 'Acme Health');
    await user.type(screen.getByLabelText(WORD_LABEL), 'DELETE');
    await user.click(deleteButton());

    expect(mockDelete).toHaveBeenCalledWith('org-1', {
      confirmName: 'Acme Health',
      confirmWord: 'DELETE',
    });
    expect(await screen.findByText(/deleted\. Members can no longer sign in\./)).toBeVisible();
  });

  it('shows a returned refusal and keeps the modal open', async () => {
    mockDelete.mockResolvedValueOnce({
      success: false,
      error: 'Too many attempts. Please wait 60 seconds and try again.',
    });
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DeleteOrganizationModal preview={preview()} onClose={onClose} />);

    await user.type(screen.getByLabelText(NAME_LABEL), 'Acme Health');
    await user.type(screen.getByLabelText(WORD_LABEL), 'DELETE');
    await user.click(deleteButton());

    expect(
      await screen.findByText('Too many attempts. Please wait 60 seconds and try again.'),
    ).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('DeleteOrganizationModal — refusal', () => {
  const refused = preview({
    organization: { id: 'org-sys', name: 'System', slug: 'system', deletedAt: null },
    refusal: 'The internal System organization cannot be deleted.',
  });

  it('shows the refusal, offers no confirmation inputs and keeps the button disabled', () => {
    render(<DeleteOrganizationModal preview={refused} onClose={vi.fn()} />);

    expect(screen.getByText('The internal System organization cannot be deleted.')).toBeVisible();
    expect(screen.queryByLabelText(NAME_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(WORD_LABEL)).not.toBeInTheDocument();
    expect(deleteButton()).toBeDisabled();
  });

  it('never calls the action even if the button is clicked', async () => {
    const user = userEvent.setup();
    render(<DeleteOrganizationModal preview={refused} onClose={vi.fn()} />);

    await user.click(deleteButton());

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
