/**
 * Tests for POST /api/billing/portal.
 *
 * Regression guard: this route previously gated on `isAdminRole()` (passes
 * every manager role); the registry reserves `billing.*` for owner + finance
 * only. Now gated on `authorize('billing.edit')` — this suite pins the
 * corrected per-role matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { mockAuth, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const prismaMock = {
    organization: { findUnique: vi.fn(), update: vi.fn() },
  };
  const stripeMock = {
    customers: { create: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  };
  return { mockAuth, prismaMock, stripeMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import { POST } from './route';

function makeReq(body: unknown = {}): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } });
  prismaMock.organization.findUnique.mockResolvedValue({
    stripeCustomerId: 'cus_1',
    name: 'Acme',
    primaryEmail: 'acme@example.com',
  });
  stripeMock.billingPortal.sessions.create.mockResolvedValue({
    url: 'https://billing.stripe.com/session_1',
  });
});

describe('POST /api/billing/portal — RBAC (billing.edit registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or looks up the org',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST(makeReq());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to create a portal session', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', role: 'finance', organizationId: 'org-1' },
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: 'https://billing.stripe.com/session_1' });
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1' }),
    );
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq());

    expect(res.status).toBe(401);
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/portal — normal path', () => {
  it('returns 404 when the caller has no organization', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: null } });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no organization found/i);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it('creates a Stripe customer first when the org has none yet', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      stripeCustomerId: null,
      name: 'Acme',
      primaryEmail: 'acme@example.com',
    });
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_new' });

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { organizationId: 'org-1' } }),
    );
    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { stripeCustomerId: 'cus_new' },
    });
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new' }),
    );
  });
});
