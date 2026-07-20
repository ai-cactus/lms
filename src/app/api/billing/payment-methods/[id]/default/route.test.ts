/**
 * Tests for POST /api/billing/payment-methods/[id]/default.
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
    organization: { findUnique: vi.fn() },
  };
  const stripeMock = {
    paymentMethods: { retrieve: vi.fn() },
    customers: { update: vi.fn() },
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
  stripeMock.customers.update.mockResolvedValue({});
});

describe('POST /api/billing/payment-methods/[id]/default — RBAC (billing.edit registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or looks up the org',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST(makeReq(), makeProps());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.customers.update).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to set the default payment method', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', role: 'finance', organizationId: 'org-1' },
    });

    const res = await POST(makeReq(), makeProps('pm_1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, message: 'Default payment method updated.' });
    expect(stripeMock.customers.update).toHaveBeenCalledWith('cus_1', {
      invoice_settings: { default_payment_method: 'pm_1' },
    });
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq(), makeProps());

    expect(res.status).toBe(401);
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/payment-methods/[id]/default — ownership check', () => {
  it('reports "not found" and never sets the default when the payment method belongs to a different customer', async () => {
    stripeMock.paymentMethods.retrieve.mockResolvedValue({ customer: 'cus_other' });

    const res = await POST(makeReq(), makeProps());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });
});
