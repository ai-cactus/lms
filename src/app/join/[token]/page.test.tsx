/**
 * Regression tests for the /join/[token] page (Next.js 16 async `params`).
 *
 * Prior bug (CRITICAL): `params` was read synchronously (`params.token`),
 * which is always `undefined` for an async-params route in Next.js 16. The
 * lookup was `prisma.invite.findFirst({ where: { token: undefined, status:
 * 'pending' } })` — Prisma silently drops a strict-`undefined` filter, so it
 * matched the platform-wide OLDEST pending invite regardless of what token
 * (or garbage) was actually in the URL, letting `/join/<anything>` render and
 * create an account against the WRONG organization's invite.
 *
 * Fix: `params` is awaited, a blank/missing token fails closed via
 * `notFound()` BEFORE any query, and the lookup is a single
 * `prisma.invite.findUnique({ where: { token } })` — `token` is `@unique`, so
 * it can only ever resolve to the invite that owns that exact token (or none).
 *
 * These tests assert on both the rendered outcome AND the exact prisma call
 * shape, so a regression back to `findFirst`/an unguarded read would fail
 * even if the branching happened to still look right.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockNotFound, mockLogger } = vi.hoisted(() => ({
  prismaMock: { invite: { findUnique: vi.fn() } },
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));
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

function paramsFor(token: string | undefined) {
  return Promise.resolve({ token }) as Promise<{ token: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JoinPage — missing/blank token fails closed before any query', () => {
  it('calls notFound() and never touches the database when token is undefined', async () => {
    await expect(JoinPage({ params: paramsFor(undefined) })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it('calls notFound() and never touches the database when token is an empty/whitespace string', async () => {
    await expect(JoinPage({ params: paramsFor('   ') })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
  });
});

describe('JoinPage — pending, unexpired invite', () => {
  it('looks up exactly the token from the URL via findUnique and renders the account-creation form', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-1',
      token: 'tok-1',
      organizationId: 'org-1',
      expiresAt: FUTURE,
      status: 'pending',
      organization: { name: 'Acme Co' },
    });

    const element = await JoinPage({ params: paramsFor('tok-1') });
    render(element);

    expect(screen.getByTestId('join-page-client')).toHaveTextContent('Acme Co');
    expect(screen.getByTestId('join-page-client')).toHaveTextContent('invite-1');
    expect(prismaMock.invite.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { token: 'tok-1' },
      include: { organization: true },
    });
  });

  it('never renders a DIFFERENT invite than the one owning the requested token', async () => {
    // Guards the core regression: even if some other (older) invite exists,
    // the lookup is keyed on the exact token, not "any pending invite".
    prismaMock.invite.findUnique.mockImplementationOnce(({ where }) =>
      Promise.resolve(
        where.token === 'tok-correct'
          ? {
              id: 'invite-correct',
              token: 'tok-correct',
              organizationId: 'org-correct',
              expiresAt: FUTURE,
              status: 'pending',
              organization: { name: 'Correct Org' },
            }
          : null,
      ),
    );

    const element = await JoinPage({ params: paramsFor('tok-correct') });
    render(element);

    expect(screen.getByTestId('join-page-client')).toHaveTextContent('Correct Org');
    expect(screen.getByTestId('join-page-client')).toHaveTextContent('invite-correct');
  });
});

describe('JoinPage — already-accepted invite', () => {
  it('renders a friendly "already used" state instead of a 404', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-2',
      token: 'tok-2',
      status: 'accepted',
      expiresAt: FUTURE,
    });

    const element = await JoinPage({ params: paramsFor('tok-2') });
    render(element);

    expect(screen.getByText('This invite has already been used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});

describe('JoinPage — unknown or genuinely expired token', () => {
  it('calls notFound() when no invite owns the token at all', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce(null);

    await expect(JoinPage({ params: paramsFor('nonexistent') })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it('calls notFound() for a pending invite that is genuinely expired', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-3',
      token: 'tok-3',
      status: 'pending',
      expiresAt: PAST,
      organization: { name: 'Acme Co' },
    });

    await expect(JoinPage({ params: paramsFor('tok-3') })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledOnce();
  });
});
