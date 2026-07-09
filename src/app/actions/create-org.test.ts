/**
 * Unit tests for createOrganization() in src/app/actions/organization.ts
 *
 * Guards validated:
 *   - One-org-per-user: a user already linked to an org cannot create another
 *   - Missing required fields are rejected early
 *   - Happy path: org + facility created in a transaction, user role set to 'owner'
 *
 * External deps (@/auth, @/lib/prisma) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuth,
  mockUserFindUnique,
  mockOrgFindFirst,
  mockOrgCreate,
  mockFacilityCreate,
  mockUserUpdate,
  mockTransaction,
} = vi.hoisted(() => {
  const mockOrgCreate = vi.fn();
  const mockFacilityCreate = vi.fn();
  const mockUserUpdate = vi.fn();

  return {
    mockAuth: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockOrgFindFirst: vi.fn(),
    mockOrgCreate,
    mockFacilityCreate,
    mockUserUpdate,
    mockTransaction: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
    facility: { update: vi.fn(), create: mockFacilityCreate },
    organization: { findFirst: mockOrgFindFirst, create: mockOrgCreate, update: vi.fn() },
    $transaction: mockTransaction,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { createOrganization } from './organization';

// ── Helpers ───────────────────────────────────────────────────────────────────

const validData = {
  legalName: 'New Corp',
  primaryContactEmail: 'owner@newcorp.com',
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'user-1', email: 'u@acme.com', role: 'nurse', organizationId: null, ...overrides },
  };
}

/** Wire up $transaction to execute the callback with a mock tx object. */
function setupTransaction() {
  mockOrgCreate.mockResolvedValue({ id: 'org-new' });
  mockFacilityCreate.mockResolvedValue({ id: 'fac-new' });
  mockUserUpdate.mockResolvedValue({});
  mockTransaction.mockImplementation(
    async (fn: (tx: { organization: unknown; facility: unknown; user: unknown }) => unknown) => {
      return fn({
        organization: { create: mockOrgCreate },
        facility: { create: mockFacilityCreate },
        user: { update: mockUserUpdate },
      });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Not authenticated ─────────────────────────────────────────────────────────

describe('createOrganization() — unauthenticated', () => {
  it('returns Not authenticated when session is null', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await createOrganization(validData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not authenticated');
  });
});

// ── One-org-per-user guard ────────────────────────────────────────────────────

describe('createOrganization() — one-org-per-user guard', () => {
  it('rejects when user already has an organizationId', async () => {
    mockAuth.mockResolvedValue(makeSession({ organizationId: 'org-existing' }));
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-existing' });

    const result = await createOrganization(validData);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already belong/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('createOrganization() — input validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession());
    mockUserFindUnique.mockResolvedValue({ organizationId: null });
  });

  it('rejects when legalName is an empty string', async () => {
    const result = await createOrganization({ legalName: '', primaryContactEmail: 'a@b.com' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('rejects when primaryContactEmail is missing', async () => {
    const result = await createOrganization({ legalName: 'New Corp', primaryContactEmail: '' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('createOrganization() — happy path', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession());
    mockUserFindUnique.mockResolvedValue({ organizationId: null });
    mockOrgFindFirst.mockResolvedValue(null); // no duplicate name
    setupTransaction();
  });

  it('returns success with the new organizationId', async () => {
    const result = await createOrganization(validData);

    expect(result.success).toBe(true);
    expect(result.organizationId).toBe('org-new');
  });

  it('links the user to the new org and facility as owner', async () => {
    await createOrganization(validData);

    expect(mockUserUpdate).toHaveBeenCalledOnce();
    const updateArg = mockUserUpdate.mock.calls[0][0].data;
    expect(updateArg.role).toBe('owner');
    expect(updateArg.organizationId).toBe('org-new');
    expect(updateArg.facilityId).toBe('fac-new');
  });

  it('creates a facility with the org legalName as the facility name', async () => {
    await createOrganization(validData);

    expect(mockFacilityCreate).toHaveBeenCalledOnce();
    const facilityArg = mockFacilityCreate.mock.calls[0][0].data;
    expect(facilityArg.organizationId).toBe('org-new');
    expect(facilityArg.name).toBe('New Corp');
  });
});

// ── Duplicate org name ────────────────────────────────────────────────────────

describe('createOrganization() — duplicate name guard', () => {
  it('rejects when an org with the same name already exists', async () => {
    mockAuth.mockResolvedValue(makeSession());
    mockUserFindUnique.mockResolvedValue({ organizationId: null });
    mockOrgFindFirst.mockResolvedValue({ id: 'existing-org', name: 'New Corp' });

    const result = await createOrganization(validData);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
