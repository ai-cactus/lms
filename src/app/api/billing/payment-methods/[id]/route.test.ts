/**
 * Tests for DELETE /api/billing/payment-methods/[id].
 *
 * Regression guard: this route previously gated on `isAdminRole()` (passes
 * every manager role); the registry reserves `billing.*` for owner + finance
 * only. Now gated on `authorize('billing.delete')` — this suite pins the
 * corrected per-role matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { mockAuth, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const prismaMock = {
    organization: { findUnique: vi.fn() },
  };
  const stripeMock = {
    paymentMethods: { retrieve: vi.fn(), detach: vi.fn() },
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

import { DELETE } from './route';

function makeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function makeProps(id = 'pm_1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } });
  prismaMock.organization.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1' });
  stripeMock.paymentMethods.retrieve.mockResolvedValue({ customer: 'cus_1' });
  stripeMock.paymentMethods.detach.mockResolvedValue({});
});

describe('DELETE /api/billing/payment-methods/[id] — RBAC (billing.delete registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or looks up the org',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await DELETE(makeReq(), makeProps());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to detach the payment method', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', role: 'finance', organizationId: 'org-1' },
    });

    const res = await DELETE(makeReq(), makeProps('pm_1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, message: 'Payment method removed.' });
    expect(stripeMock.paymentMethods.detach).toHaveBeenCalledWith('pm_1');
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await DELETE(makeReq(), makeProps());

    expect(res.status).toBe(401);
    expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/billing/payment-methods/[id] — ownership check', () => {
  it('reports "not found" and never detaches when the payment method belongs to a different customer', async () => {
    stripeMock.paymentMethods.retrieve.mockResolvedValue({ customer: 'cus_other' });

    const res = await DELETE(makeReq(), makeProps());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    expect(stripeMock.paymentMethods.detach).not.toHaveBeenCalled();
  });
});
