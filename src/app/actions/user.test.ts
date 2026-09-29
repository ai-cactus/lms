/**
 * Tests for updateProfile() (src/app/actions/user.ts).
 *
 * QA fix: the server action trusted `data.first_name`/`data.last_name`
 * verbatim — an empty string, whitespace-only string, or an arbitrarily long
 * string all passed straight through to the DB (the client is not a trust
 * boundary). Now mirrors the accept-invite zod bounds: non-empty after trim,
 * max 100 characters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockHeaders,
  mockAdminAuth,
  mockWorkerAuth,
  mockRevalidatePath,
  mockInvalidateRevalidationCache,
  mockBcryptCompare,
  mockBcryptHash,
  mockUploadFile,
  mockGetSignedUrl,
} = vi.hoisted(() => ({
  // Profile was merged into User — name fields live directly on the identity.
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    organizationUser: { update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    invite: { findMany: vi.fn() },
    facility: { findMany: vi.fn() },
  },
  mockHeaders: vi.fn(),
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockInvalidateRevalidationCache: vi.fn(),
  mockBcryptCompare: vi.fn(),
  mockBcryptHash: vi.fn(),
  mockUploadFile: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mockHeaders }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// changePassword actively busts the JWT revalidation cache; stub it so tests
// don't reach the real Redis client, and kept as a spy (not an inline
// vi.fn()) so tests can assert it's actually called.
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: mockInvalidateRevalidationCache,
}));
vi.mock('bcryptjs', () => ({
  default: { compare: mockBcryptCompare, hash: mockBcryptHash },
  compare: mockBcryptCompare,
  hash: mockBcryptHash,
}));

vi.mock('@/lib/storage', () => ({
  uploadFile: mockUploadFile,
  getSignedUrl: mockGetSignedUrl,
}));

import { updateProfile, changePassword, getStaffUsers, uploadAvatar } from './user';
import type { PortalRealm } from '@/lib/auth/portal-sessions';

const SESSION = { user: { id: 'user-1', email: 'user@acme.com' } };

function baseData(overrides: Partial<Parameters<typeof updateProfile>[1]> = {}) {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue({ get: () => null });
  mockAdminAuth.mockResolvedValue(SESSION);
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.user.update.mockResolvedValue({ id: 'user-1' });
  prismaMock.organizationUser.update.mockResolvedValue({ id: 'ou-1' });
  prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe('updateProfile — server-side name validation', () => {
  it('rejects an empty first name and never touches the database', async () => {
    const result = await updateProfile('admin', baseData({ first_name: '' }));

    expect(result).toEqual({ success: false, error: 'First and last name are required.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only last name and never touches the database', async () => {
    const result = await updateProfile('admin', baseData({ last_name: '   ' }));

    expect(result).toEqual({ success: false, error: 'First and last name are required.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a first name over 100 characters', async () => {
    const result = await updateProfile('admin', baseData({ first_name: 'a'.repeat(101) }));

    expect(result).toEqual({
      success: false,
      error: 'Name is too long (maximum 100 characters).',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a last name over 100 characters', async () => {
    const result = await updateProfile('admin', baseData({ last_name: 'b'.repeat(101) }));

    expect(result).toEqual({
      success: false,
      error: 'Name is too long (maximum 100 characters).',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('accepts a name at exactly the 100-character boundary', async () => {
    const result = await updateProfile('admin', baseData({ first_name: 'a'.repeat(100) }));

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
  });

  it('trims surrounding whitespace before persisting and computing the full name', async () => {
    const result = await updateProfile(
      'admin',
      baseData({ first_name: '  Jane ', last_name: ' Doe  ' }),
    );

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          fullName: 'Jane Doe',
        }),
      }),
    );
  });

  it('returns "Not authenticated" without validating names when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const result = await updateProfile('admin', baseData({ first_name: '' }));

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateProfile — founder ruling Q3/Q17 (2026-09-23) retired job titles: the
// system-assigned role IS the title, so this action writes the identity only
// and never reaches the membership row.
// ---------------------------------------------------------------------------

describe('updateProfile — writes the identity only', () => {
  it('updates the name fields and never touches the membership row', async () => {
    mockAdminAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@acme.com',
        organizationId: 'org-1',
        organizationUserId: 'ou-db',
      },
    });

    const result = await updateProfile('admin', baseData());

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'user-1' },
      data: { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', avatarUrl: undefined },
    });
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.organizationUser.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('succeeds for an org-less session, which no longer has a membership to resolve', async () => {
    mockAdminAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@acme.com',
        organizationId: null,
        organizationUserId: null,
      },
    });

    const result = await updateProfile('admin', baseData());

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// changePassword() — self-service password change. F-059 bumps sessionVersion
// on completion; commit 66aa961 added an active cache bust on top so the
// invalidation isn't bounded by the revalidation cache's TTL.
// ---------------------------------------------------------------------------

describe('changePassword — self-service password change', () => {
  const EXISTING_HASH = 'existing-hashed-password';

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      password: EXISTING_HASH,
      authProvider: 'credentials',
    });
    prismaMock.user.update.mockResolvedValue({});
    mockInvalidateRevalidationCache.mockResolvedValue(undefined);
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue('new-hashed-password');
  });

  it('returns "Not authenticated" and touches no DB when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const result = await changePassword('admin', {
      currentPassword: 'oldPass1!',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it("updates the password, bumps sessionVersion, and busts the session's cached revalidation snapshot by id, after the DB write", async () => {
    const result = await changePassword('admin', {
      currentPassword: 'correctCurrentPass1!',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: true });
    expect(mockBcryptCompare).toHaveBeenCalledWith('correctCurrentPass1!', EXISTING_HASH);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        password: 'new-hashed-password',
        passwordResetRequired: false,
        sessionVersion: { increment: 1 },
      },
    });
    // commit 66aa961: unlike the pre-existing F-059 sessionVersion bump alone
    // (which only self-heals within the cache TTL), this is the active bust
    // that makes the invalidation immediate.
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('user-1');
    expect(prismaMock.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateRevalidationCache.mock.invocationCallOrder[0],
    );
  });

  it('rejects an OAuth account (no password to change) and does NOT invalidate the cache', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ password: null, authProvider: 'google' });

    const result = await changePassword('admin', { newPassword: 'NewStr0ng!Pass1' });

    expect(result).toEqual({
      success: false,
      error: 'Cannot change password for OAuth accounts.',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('returns "Incorrect current password." and does NOT update or invalidate when the current password is wrong', async () => {
    mockBcryptCompare.mockResolvedValue(false);

    const result = await changePassword('admin', {
      currentPassword: 'wrongPass',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: false, error: 'Incorrect current password.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('rejects a new password under 12 characters before ever touching the DB', async () => {
    const result = await changePassword('admin', {
      currentPassword: 'correctCurrentPass1!',
      newPassword: 'short1!',
    });

    expect(result).toEqual({
      success: false,
      error: 'New password must be at least 12 characters long.',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('returns a generic failure and does NOT invalidate the cache when the DB update throws', async () => {
    prismaMock.user.update.mockRejectedValue(new Error('connection pool exhausted'));

    const result = await changePassword('admin', {
      currentPassword: 'correctCurrentPass1!',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: false, error: 'Failed to change password' });
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });
});

/**
 * D-01 — facility scoping of the staff roster.
 *
 * The anti-over-fix case matters as much as the fix: HR is org-wide BY DESIGN
 * (`ORG_WIDE_FACILITY_ROLES`) and `TC-HR-001` passed. Narrowing HR while fixing
 * supervisor would be a new defect wearing a fix's clothes. These assert on the
 * Prisma `where` the action actually builds, not on its return value.
 */
describe('getStaffUsers — D-01 facility scoping', () => {
  const ORG = 'org-a';

  const sessionFor = (role: string) => ({
    user: {
      id: 'u1',
      role,
      organizationId: ORG,
      organizationUserId: 'ou1',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    prismaMock.organizationUser.findMany.mockResolvedValue([]);
    prismaMock.invite.findMany.mockResolvedValue([]);
    prismaMock.facility.findMany.mockResolvedValue([{ id: 'annex', name: 'Annex' }]);
  });

  it('does NOT narrow HR — org-wide by design (TC-HR-001 must not regress)', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor('hr'));

    await getStaffUsers();

    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('facilities');
    const inviteWhere = prismaMock.invite.findMany.mock.calls[0][0].where;
    expect(inviteWhere).not.toHaveProperty('facilityId');
    // org-wide roles short-circuit before any facility lookup
    expect(prismaMock.facility.findMany).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'clinical_director', 'finance'])(
    'does NOT narrow %s — also org-wide',
    async (role) => {
      mockAdminAuth.mockResolvedValue(sessionFor(role));

      if (role === 'clinical_director' || role === 'finance') {
        // no user.read — denied before any query
        await expect(getStaffUsers()).rejects.toThrow('Unauthorized');
        expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
        return;
      }

      await getStaffUsers();
      const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('facilities');
    },
  );

  it('narrows supervisor to its own facilities, and scopes pending invites too', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor('supervisor'));

    await getStaffUsers();

    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where.facilities).toEqual({
      some: { facilityId: { in: ['annex'] }, active: true },
    });
    const inviteWhere = prismaMock.invite.findMany.mock.calls[0][0].where;
    expect(inviteWhere.facilityId).toEqual({ in: ['annex'] });
  });

  it('a supervisor with no facility assignments sees nothing, not everything', async () => {
    mockAdminAuth.mockResolvedValue(sessionFor('supervisor'));
    prismaMock.facility.findMany.mockResolvedValue([]);

    await getStaffUsers();

    const where = prismaMock.organizationUser.findMany.mock.calls[0][0].where;
    expect(where.facilities).toEqual({ some: { facilityId: { in: [] }, active: true } });
  });

  it('denies a worker — the roster was reachable via workerAuth() with no check at all', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(sessionFor('nurse'));

    await expect(getStaffUsers()).rejects.toThrow('Unauthorized');
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BUG-05 — self-service writes act on the portal the caller names, and only
// that portal. One browser can hold an admin session and a worker session for
// two DIFFERENT accounts; the old referer sniff preferred the admin session for
// any referer-less request and fell back across portals, so a worker's save
// could rename (or re-password) the admin account.
// ---------------------------------------------------------------------------

describe('BUG-05 — realm selection for self-service writes', () => {
  const ADMIN_SESSION = {
    user: { id: 'admin-user', email: 'boss@acme.com', organizationId: 'org-a' },
  };
  const WORKER_SESSION = {
    user: { id: 'worker-user', email: 'nurse@acme.com', organizationId: 'org-b' },
  };

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash', authProvider: 'credentials' });
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue('new-hash');
    mockInvalidateRevalidationCache.mockResolvedValue(undefined);
    mockUploadFile.mockResolvedValue({ storageUri: 'gcs://bucket/avatars/x.png' });
  });

  describe('with BOTH sessions in the browser', () => {
    beforeEach(() => {
      mockAdminAuth.mockResolvedValue(ADMIN_SESSION);
      mockWorkerAuth.mockResolvedValue(WORKER_SESSION);
    });

    it('a worker-portal save writes the worker account, never the admin one', async () => {
      const result = await updateProfile('worker', baseData());

      expect(result).toEqual({ success: true });
      expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ where: { id: 'worker-user' } }),
      );
    });

    it('an admin-portal save writes the admin account', async () => {
      await updateProfile('admin', baseData());

      expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ where: { id: 'admin-user' } }),
      );
    });

    it('ignores the referer entirely — a /worker referer cannot move an admin save', async () => {
      mockHeaders.mockResolvedValue({ get: () => 'https://app.test/worker/profile' });

      await updateProfile('admin', baseData());

      expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ where: { id: 'admin-user' } }),
      );
    });

    it('a worker-portal password change re-passwords and evicts the worker account only', async () => {
      const result = await changePassword('worker', {
        currentPassword: 'correctCurrentPass1!',
        newPassword: 'NewStr0ng!Pass1',
      });

      expect(result).toEqual({ success: true });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'worker-user' } }),
      );
      expect(prismaMock.user.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ where: { id: 'worker-user' } }),
      );
      expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('worker-user');
    });

    it("a worker-portal avatar upload is stored under the worker's own prefix", async () => {
      const form = new FormData();
      form.append('file', new File(['x'], 'me.png', { type: 'image/png' }));

      const result = await uploadAvatar('worker', form);

      expect(result).toEqual({ success: true, url: 'gcs://bucket/avatars/x.png' });
      expect(mockUploadFile.mock.calls[0][0]).toMatch(/^avatars\/worker-user\//);
    });
  });

  describe('never falls back to the other portal', () => {
    it('a worker-portal save with only an admin session is refused, writing nothing', async () => {
      mockAdminAuth.mockResolvedValue(ADMIN_SESSION);
      mockWorkerAuth.mockResolvedValue(null);

      const result = await updateProfile('worker', baseData());

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('an admin-portal save with only a worker session is refused, writing nothing', async () => {
      mockAdminAuth.mockResolvedValue(null);
      mockWorkerAuth.mockResolvedValue(WORKER_SESSION);

      const result = await updateProfile('admin', baseData());

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(mockAdminAuth).toHaveBeenCalled();
      expect(mockWorkerAuth).not.toHaveBeenCalled();
    });

    it('a password change with the other portal only is refused, writing nothing', async () => {
      mockAdminAuth.mockResolvedValue(ADMIN_SESSION);
      mockWorkerAuth.mockResolvedValue(null);

      const result = await changePassword('worker', { newPassword: 'NewStr0ng!Pass1' });

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  it.each([undefined, '', 'system', 'Admin'])(
    'an unknown realm %j resolves no session and writes nothing',
    async (realm) => {
      mockAdminAuth.mockResolvedValue(ADMIN_SESSION);
      mockWorkerAuth.mockResolvedValue(WORKER_SESSION);

      const result = await updateProfile(realm as unknown as PortalRealm, baseData());

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(mockAdminAuth).not.toHaveBeenCalled();
      expect(mockWorkerAuth).not.toHaveBeenCalled();
    },
  );

  it('the staff roster reads the admin portal only — a worker session is never consulted', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'mgr', role: 'owner', organizationId: 'org-a', organizationUserId: 'ou' },
    });

    await expect(getStaffUsers()).rejects.toThrow('Unauthorized');
    expect(mockWorkerAuth).not.toHaveBeenCalled();
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RISK-02 — clearing a profile photo. `undefined` means "leave unchanged", so
// an intentional clear must arrive as null and be written as null. A new photo
// must be one `uploadAvatar` produced for THIS user: the profile pages sign the
// stored value by key, so any other URI would be read back as a signed URL.
// ---------------------------------------------------------------------------

describe('updateProfile — avatarUrl', () => {
  const OWN_AVATAR = 'gcs://bucket/avatars/user-1/1700000000000-me.png';

  function writtenAvatar() {
    return prismaMock.user.update.mock.calls[0][0].data.avatarUrl;
  }

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('clears the stored photo when sent %s', async (_label, avatarUrl) => {
    const result = await updateProfile('admin', baseData({ avatarUrl }));

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update.mock.calls[0][0].data).toHaveProperty('avatarUrl', null);
  });

  it('leaves the stored photo untouched when avatarUrl is omitted', async () => {
    await updateProfile('admin', baseData());

    expect(writtenAvatar()).toBeUndefined();
  });

  it.each([OWN_AVATAR, 'minio://lms-documents/avatars/user-1/123-me.png'])(
    'stores a photo from the caller’s own avatar uploads: %s',
    async (avatarUrl) => {
      const result = await updateProfile('admin', baseData({ avatarUrl }));

      expect(result).toEqual({ success: true });
      expect(writtenAvatar()).toBe(avatarUrl);
    },
  );

  it.each([
    ["another user's avatar", 'gcs://bucket/avatars/user-2/1-them.png'],
    ['a prefix collision on the user id', 'gcs://bucket/avatars/user-10/1-them.png'],
    ["another tenant's document", 'gcs://bucket/documents/org-b/secret.pdf'],
    ['a traversal out of the avatar folder', 'gcs://bucket/avatars/user-1/../../documents/x.pdf'],
    ['an external URL', 'https://evil.example/pixel.png'],
    ['a legacy local path', '/uploads/avatars/user-1/me.png'],
  ])('refuses %s and writes nothing', async (_label, avatarUrl) => {
    const result = await updateProfile('admin', baseData({ avatarUrl }));

    expect(result).toEqual({
      success: false,
      error: 'Invalid profile photo. Please upload it again.',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses a non-string avatarUrl (Server Action arguments are unchecked)', async () => {
    const result = await updateProfile('admin', baseData({ avatarUrl: 42 as unknown as string }));

    expect(result.success).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BUG-48 — the roster drew `User.avatarUrl` straight into `<img src>`. That
// value is a `gcs://`/`minio://` storage URI: it names the bucket and key, and
// no browser can fetch it. The payload must carry a signed URL instead.
// ---------------------------------------------------------------------------

describe('getStaffUsers — avatar URLs', () => {
  const STORED = 'gcs://lms-bucket/avatars/user-7/1700000000000-me.png';
  const SIGNED =
    'https://storage.googleapis.com/lms-bucket/avatars/user-7/me.png?X-Goog-Signature=abc';

  function member(avatarUrl: string | null, userId = 'user-7') {
    return {
      id: `ou-${userId}`,
      userId,
      role: 'nurse',
      joinedAt: new Date('2026-09-01T00:00:00.000Z'),
      user: { email: `${userId}@acme.com`, fullName: 'Pat Doe', avatarUrl },
      facilities: [],
    };
  }

  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'u1', role: 'owner', organizationId: 'org-a', organizationUserId: 'ou1' },
    });
    prismaMock.invite.findMany.mockResolvedValue([]);
  });

  it('sends a signed URL, never the stored storage URI', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([member(STORED)]);
    mockGetSignedUrl.mockResolvedValue(SIGNED);

    const entries = await getStaffUsers();

    expect(mockGetSignedUrl).toHaveBeenCalledWith(STORED);
    expect(entries[0].avatarUrl).toBe(SIGNED);
    expect(JSON.stringify(entries)).not.toContain('gcs://');
  });

  it('sends null for a member without a photo and signs nothing', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([member(null)]);

    const entries = await getStaffUsers();

    expect(entries[0].avatarUrl).toBeNull();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('degrades one unsignable avatar to initials without failing the roster', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      member(STORED, 'user-7'),
      member('gcs://lms-bucket/avatars/user-8/1-me.png', 'user-8'),
    ]);
    mockGetSignedUrl.mockRejectedValueOnce(new Error('GCS unavailable')).mockResolvedValue(SIGNED);

    const entries = await getStaffUsers();

    expect(entries.map((e) => e.avatarUrl)).toEqual([null, SIGNED]);
  });
});
