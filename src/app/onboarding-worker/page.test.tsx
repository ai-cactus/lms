/**
 * BUG-62: an existing member who enters their organization's join code is told
 * so at the verify step, before any organization card or Join button appears.
 * A browser reaches this page only with an org-less worker session, so the
 * refusal is covered here rather than end to end.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerify, mockJoin } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockJoin: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ update: vi.fn() }), signOut: vi.fn() }));
vi.mock('@/app/actions/organization-code', () => ({
  verifyOrganizationCode: mockVerify,
  joinOrganization: mockJoin,
}));

import WorkerOnboardingPage from './page';

async function submitCode(code: string) {
  const u = userEvent.setup();
  render(<WorkerOnboardingPage />);
  await u.type(screen.getByPlaceholderText('Enter 6-digit code'), code);
  await u.click(screen.getByRole('button', { name: 'Find Organization' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkerOnboardingPage — verify step (BUG-62)', () => {
  it('shows an active member the refusal and offers no Join', async () => {
    mockVerify.mockResolvedValue({
      success: false,
      error: 'You are already a member of this organization.',
    });

    await submitCode('123456');

    expect(
      await screen.findByText('You are already a member of this organization.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join/i })).not.toBeInTheDocument();
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('shows a deactivated member the refusal and offers no Join', async () => {
    mockVerify.mockResolvedValue({
      success: false,
      error: 'Your access to this organization was removed. Ask an administrator to restore it.',
    });

    await submitCode('123456');

    expect(
      await screen.findByText(
        'Your access to this organization was removed. Ask an administrator to restore it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join/i })).not.toBeInTheDocument();
  });

  it('CONTROL: shows a non-member the organization card with Join', async () => {
    mockVerify.mockResolvedValue({
      success: true,
      organization: {
        id: 'org-1',
        name: 'Acme Health',
        type: 'clinic',
        services: [],
        country: null,
        phone: null,
        contactName: null,
      },
    });

    await submitCode('123456');

    expect(await screen.findByText('Acme Health')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument();
  });
});
