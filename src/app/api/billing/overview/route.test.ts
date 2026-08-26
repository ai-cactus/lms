/**
 * Tests for GET /api/billing/overview.
 *
 * This route had zero coverage before this suite — which is exactly why #33
 * shipped broken and stayed broken. `activeStaffCount` used to filter on
 * `role: { in: [...WORKER_ROLES] }`, so an org with 1 worker + 6 managers
 * showed "1 / 50" instead of the true seat count. The route now counts every
 * `active: true` `OrganizationUser` row regardless of role — owner included,
 * invited-but-unactivated excluded (they have no `OrganizationUser` row until
 * they accept) — and the count MUST stay scoped to the caller's own
 * organization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAuth, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const prismaMock = {
    organization: { findUnique: vi.fn() },
    organizationUser: { count: vi.fn() },
    invoice: { findMany: vi.fn() },
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

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { GET } from './route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_1 = {
  name: 'Acme Clinic',
  facilities: [{ staffCount: 50 }],
  stripeCustomerId: null,
  subscription: { id: 'sub-row-1', plan: 'growth', status: 'active' },
};

/**
 * Raw `OrganizationUser` rows across two orgs, used to drive a real filter in
 * `organizationUser.count`'s mock implementation rather than a canned number —
 * a wrong `where` clause (missing org scope, or a role filter creeping back
 * in) changes what this returns, the same way it would against a real DB.
 */
const ORGANIZATION_USERS = [
  // org-1: literal #33 repro — 1 worker + 6 managers, owner included, all active.
  { organizationId: 'org-1', role: 'nurse', active: true },
  { organizationId: 'org-1', role: 'owner', active: true },
  { organizationId: 'org-1', role: 'admin', active: true },
  { organizationId: 'org-1', role: 'supervisor', active: true },
  { organizationId: 'org-1', role: 'hr', active: true },
  { organizationId: 'org-1', role: 'clinical_director', active: true },
  { organizationId: 'org-1', role: 'finance', active: true },
  // org-1: deactivated member — must not be counted.
  { organizationId: 'org-1', role: 'nurse', active: false },
  // org-2: noise. Must never leak into org-1's count.
  { organizationId: 'org-2', role: 'owner', active: true },
  { organizationId: 'org-2', role: 'nurse', active: true },
  { organizationId: 'org-2', role: 'nurse', active: true },
  { organizationId: 'org-2', role: 'nurse', active: false },
];

function mockAuthAs(organizationId: string, role = 'owner') {
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role, organizationId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthAs('org-1');
  prismaMock.organization.findUnique.mockResolvedValue(ORG_1);
  prismaMock.organizationUser.count.mockImplementation(
    async ({ where }: { where: { organizationId: string; active?: boolean } }) =>
      ORGANIZATION_USERS.filter(
        (u) =>
          u.organizationId === where.organizationId &&
          (where.active === undefined || u.active === where.active),
      ).length,
  );
  prismaMock.invoice.findMany.mockResolvedValue([]);
});

describe('GET /api/billing/overview — activeStaffCount (#33 regression)', () => {
  it('counts every active member regardless of role — 1 worker + 6 managers yields 7, owner included', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activeStaffCount).toBe(7);
    expect(prismaMock.organizationUser.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', active: true },
    });
  });

  it('excludes members with active: false', async () => {
    const res = await GET();
    const body = await res.json();

    // 8 org-1 rows exist total (7 active + 1 deactivated); only the 7 active count.
    expect(body.activeStaffCount).toBe(7);
    expect(body.activeStaffCount).not.toBe(8);
  });

  it('does not count invited-but-not-yet-activated users', async () => {
    // Invited users get an `Invite` row, not an `OrganizationUser` row, until
    // they accept (see createMembership) — so they cannot appear in a count
    // sourced from `organizationUser.count`. `prismaMock` deliberately has no
    // `invite` mock: if the route ever queried an invite table this call
    // would throw, so a clean 200 here proves the route never consults one.
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activeStaffCount).toBe(7);
  });

  it('never counts another organization members — cross-org isolation', async () => {
    mockAuthAs('org-2');

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // org-2 has 3 active rows (owner + 2 nurses) and 1 deactivated — must not
    // see org-1's 7, and must not sum both orgs' active rows either.
    expect(body.activeStaffCount).toBe(3);
    expect(prismaMock.organizationUser.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-2', active: true },
    });
  });
});

describe('GET /api/billing/overview — RBAC (billing.read registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never queries the DB or Stripe',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.organizationUser.count).not.toHaveBeenCalled();
    },
  );

  it('allows role=owner through to the normal overview path', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('allows role=finance through to the normal overview path', async () => {
    mockAuthAs('org-1', 'finance');

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });
});

describe('GET /api/billing/overview — normal path', () => {
  it('returns 404 when the caller has no organization', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: null } });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no organization found/i);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization row is missing', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
  });

  it('returns the organization, subscription and manual staffCount fields', async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.organization).toEqual({ name: 'Acme Clinic', staffCount: 50 });
    expect(body.subscription).toEqual(ORG_1.subscription);
  });

  it('skips the Stripe customer lookup and returns null when there is no stripeCustomerId', async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.defaultPaymentMethod).toBeNull();
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
  });

  it('returns the default payment method when Stripe has one expanded on the customer', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...ORG_1,
      stripeCustomerId: 'cus_1',
    });
    stripeMock.customers.retrieve.mockResolvedValue({
      deleted: false,
      invoice_settings: {
        default_payment_method: {
          id: 'pm_default',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
          billing_details: { name: 'Acme', address: { line1: '1 Main St', city: 'Metropolis' } },
        },
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(body.defaultPaymentMethod).toEqual(
      expect.objectContaining({ id: 'pm_default', brand: 'visa', last4: '4242' }),
    );
    expect(stripeMock.paymentMethods.list).not.toHaveBeenCalled();
  });

  it('falls back to listing attached payment methods when no default is expanded', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...ORG_1,
      stripeCustomerId: 'cus_1',
    });
    stripeMock.customers.retrieve.mockResolvedValue({
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });
    stripeMock.paymentMethods.list.mockResolvedValue({
      data: [
        {
          id: 'pm_fallback',
          card: { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2031 },
          billing_details: { name: 'Acme', address: null },
        },
      ],
    });

    const res = await GET();
    const body = await res.json();

    expect(stripeMock.paymentMethods.list).toHaveBeenCalledWith({
      customer: 'cus_1',
      type: 'card',
    });
    expect(body.defaultPaymentMethod).toEqual(
      expect.objectContaining({ id: 'pm_fallback', brand: 'mastercard' }),
    );
  });

  it('returns the two most recent invoices, mapped to the response shape', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-2',
        invoiceNumber: 'INV-002',
        amountPaid: 4900,
        currency: 'usd',
        status: 'paid',
        invoiceUrl: 'https://stripe.test/inv-2',
        pdfUrl: 'https://stripe.test/inv-2.pdf',
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
      {
        id: 'inv-1',
        invoiceNumber: 'INV-001',
        amountPaid: 4900,
        currency: 'usd',
        status: 'paid',
        invoiceUrl: 'https://stripe.test/inv-1',
        pdfUrl: 'https://stripe.test/inv-1.pdf',
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    expect(body.recentInvoices).toHaveLength(2);
    expect(body.recentInvoices[0]).toEqual(
      expect.objectContaining({ id: 'inv-2', invoiceNumber: 'INV-002', amountPaid: 4900 }),
    );
  });

  it('returns 500 when an unexpected error is thrown', async () => {
    prismaMock.organization.findUnique.mockRejectedValue(new Error('DB unreachable'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/internal server error/i);
  });
});
