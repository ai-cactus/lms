/**
 * Tests for POST /api/billing/contact-enterprise.
 *
 * Regression guard: this route previously gated on `isAdminRole()` (passes
 * every manager role); the registry reserves `billing.*` for owner + finance
 * only. Now gated on `authorize('billing.read')` — this suite pins the
 * corrected per-role matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { mockAuth, prismaMock, mockSendEnterpriseInquiryEmail, mockVerifyCaptcha } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    prismaMock: { organization: { findUnique: vi.fn() } },
    mockSendEnterpriseInquiryEmail: vi.fn(),
    mockVerifyCaptcha: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/email', () => ({ sendEnterpriseInquiryEmail: mockSendEnterpriseInquiryEmail }));
vi.mock('@/lib/captcha', () => ({ verifyCaptcha: mockVerifyCaptcha }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import { POST } from './route';

const VALID_BODY = {
  firstName: 'Jane',
  lastName: 'Doe',
  workEmail: 'jane@acme.com',
  jobTitle: 'Director',
  organizationName: 'Acme Health',
  facilityType: 'Outpatient',
  numberOfFacilities: '3',
  numberOfStaff: '75',
  currentAccreditation: 'CARF',
  currentTrainingMethod: 'In-person',
  primaryPainPoint: 'Manual tracking',
};

function makeReq(body: unknown = VALID_BODY): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'user-1', role: 'owner', organizationId: 'org-1', email: 'owner@acme.com' },
  });
  mockVerifyCaptcha.mockResolvedValue(true);
  prismaMock.organization.findUnique.mockResolvedValue({
    name: 'Acme Health',
    primaryEmail: 'a@acme.com',
  });
  mockSendEnterpriseInquiryEmail.mockResolvedValue(undefined);
});

describe('POST /api/billing/contact-enterprise — RBAC (billing.read registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never sends the inquiry email',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST(makeReq());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(mockSendEnterpriseInquiryEmail).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to submit the inquiry', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', role: 'finance', organizationId: 'org-1' },
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSendEnterpriseInquiryEmail).toHaveBeenCalledOnce();
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq());

    expect(res.status).toBe(401);
    expect(mockSendEnterpriseInquiryEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/contact-enterprise — normal path', () => {
  it('rejects a missing required field with 400 before sending', async () => {
    const res = await POST(makeReq({ ...VALID_BODY, workEmail: '' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/work email is required/i);
    expect(mockSendEnterpriseInquiryEmail).not.toHaveBeenCalled();
  });

  it('sends the inquiry with the authenticated user context on success', async () => {
    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(mockSendEnterpriseInquiryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ authUserEmail: 'owner@acme.com' }),
    );
  });
});
