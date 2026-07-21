/**
 * Tests for GET /api/billing/payment-methods.
 *
 * Regression guard: this route (and its 11 siblings under
 * src/app/api/billing/) previously gated on `isAdminRole()`, which passes
 * ALL manager roles (owner/supervisor/hr/clinical_director/finance) — but the
 * permission registry (`src/lib/rbac/permissions.ts`) reserves `billing.*`
 * for owner + finance only. Supervisor/HR/Clinical Director could reach live
 * Stripe payment-method data. The route now gates on `authorize('billing.read')`
 * against the registry; this suite pins the corrected per-role matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const prismaMock = {
    organization: { findUnique: vi.fn() },
  };
  const stripeMock = {
    customers: { retrieve: vi.fn() },
    paymentMethods: { list: vi.fn() },
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

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } });
  prismaMock.organization.findUnique.mockResolvedValue({ stripeCustomerId: null });
});

describe('GET /api/billing/payment-methods — RBAC (billing.read registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never calls Stripe or looks up the org',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.paymentMethods.list).not.toHaveBeenCalled();
    },
  );

  it('allows role=owner through to the normal list path', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ paymentMethods: [], defaultPaymentMethodId: null });
  });

  it('allows role=finance through to the normal list path', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', role: 'finance', organizationId: 'org-1' },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ paymentMethods: [], defaultPaymentMethodId: null });
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });
});

describe('GET /api/billing/payment-methods — normal path', () => {
  it('returns 404 when the caller has no organization', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: null } });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no organization found/i);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it('lists mapped payment methods and flags the default one', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_1' });
    stripeMock.customers.retrieve.mockResolvedValue({
      deleted: false,
      invoice_settings: { default_payment_method: 'pm_default' },
    });
    stripeMock.paymentMethods.list.mockResolvedValue({
      data: [
        {
          id: 'pm_default',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
          billing_details: { name: 'Acme', email: 'a@acme.com', address: null },
        },
      ],
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.defaultPaymentMethodId).toBe('pm_default');
    expect(body.paymentMethods).toEqual([
      expect.objectContaining({ id: 'pm_default', brand: 'visa', last4: '4242', isDefault: true }),
    ]);
  });
});
