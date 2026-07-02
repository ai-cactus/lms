/**
 * THER-007 regression tests for the /join/[token] page branching:
 *   - pending, unexpired invite → renders the account-creation form
 *   - already-accepted invite → friendly "already used" state (not a 404)
 *   - unknown / genuinely expired token → notFound()
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockNotFound } = vi.hoisted(() => ({
  prismaMock: { invite: { findFirst: vi.fn() } },
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/app/join/[token]/JoinPageClient', () => ({
  default: ({ invite, orgName }: { invite: { id: string }; orgName: string }) => (
    <div data-testid="join-page-client">
      form for {orgName} / invite {invite.id}
    </div>
  ),
}));

import JoinPage from './page';

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JoinPage — pending, unexpired invite', () => {
  it('renders the account-creation form', async () => {
    prismaMock.invite.findFirst.mockResolvedValueOnce({
      id: 'invite-1',
      expiresAt: FUTURE,
      status: 'pending',
      organization: { name: 'Acme Co' },
    });

    const element = await JoinPage({ params: Promise.resolve({ token: 'tok-1' }) });
    render(element);

    expect(screen.getByTestId('join-page-client')).toHaveTextContent('Acme Co');
    expect(prismaMock.invite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'tok-1', status: 'pending' } }),
    );
    // Only the first (strict pending) lookup should run — no need for the
    // second "any status" lookup on the happy path.
    expect(prismaMock.invite.findFirst).toHaveBeenCalledOnce();
  });
});

describe('JoinPage — already-accepted invite', () => {
  it('renders a friendly "already used" state instead of a 404', async () => {
    // First (strict pending) lookup misses because status is 'accepted'.
    prismaMock.invite.findFirst.mockResolvedValueOnce(null);
    // Second (any-status) lookup finds it as accepted.
    prismaMock.invite.findFirst.mockResolvedValueOnce({ status: 'accepted' });

    const element = await JoinPage({ params: Promise.resolve({ token: 'tok-2' }) });
    render(element);

    expect(screen.getByText('This invite has already been used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});

describe('JoinPage — unknown or genuinely expired token', () => {
  it('calls notFound() when the token does not exist at all', async () => {
    prismaMock.invite.findFirst.mockResolvedValueOnce(null); // strict lookup misses
    prismaMock.invite.findFirst.mockResolvedValueOnce(null); // any-status lookup also misses

    await expect(JoinPage({ params: Promise.resolve({ token: 'nonexistent' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('calls notFound() for a pending invite that is genuinely expired', async () => {
    // Strict lookup (status: 'pending') can still match an expired pending
    // invite — the page's own expiresAt check must reject it.
    prismaMock.invite.findFirst.mockResolvedValueOnce({
      id: 'invite-3',
      expiresAt: PAST,
      status: 'pending',
      organization: { name: 'Acme Co' },
    });
    // Second lookup confirms it is still 'pending' (never accepted) — not the
    // accepted-state branch, so it must fall through to notFound().
    prismaMock.invite.findFirst.mockResolvedValueOnce({ status: 'pending' });

    await expect(JoinPage({ params: Promise.resolve({ token: 'tok-3' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mockNotFound).toHaveBeenCalledOnce();
  });
});
