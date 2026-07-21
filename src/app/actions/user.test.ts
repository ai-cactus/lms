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

const { prismaMock, mockHeaders, mockAdminAuth, mockWorkerAuth, mockRevalidatePath } = vi.hoisted(
  () => ({
    prismaMock: { profile: { upsert: vi.fn() } },
    mockHeaders: vi.fn(),
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockRevalidatePath: vi.fn(),
  }),
);

vi.mock('next/headers', () => ({ headers: mockHeaders }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { updateProfile } from './user';

const SESSION = { user: { id: 'user-1', email: 'user@acme.com' } };

function baseData(overrides: Partial<Parameters<typeof updateProfile>[0]> = {}) {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue({ get: () => null }); // non-worker referer → resolveSession uses adminAuth
  mockAdminAuth.mockResolvedValue(SESSION);
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.profile.upsert.mockResolvedValue({ id: 'user-1' });
});

describe('updateProfile — server-side name validation', () => {
  it('rejects an empty first name and never touches the database', async () => {
    const result = await updateProfile(baseData({ first_name: '' }));

    expect(result).toEqual({ success: false, error: 'First and last name are required.' });
    expect(prismaMock.profile.upsert).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only last name and never touches the database', async () => {
    const result = await updateProfile(baseData({ last_name: '   ' }));

    expect(result).toEqual({ success: false, error: 'First and last name are required.' });
    expect(prismaMock.profile.upsert).not.toHaveBeenCalled();
  });

  it('rejects a first name over 100 characters', async () => {
    const result = await updateProfile(baseData({ first_name: 'a'.repeat(101) }));

    expect(result).toEqual({
      success: false,
      error: 'Name is too long (maximum 100 characters).',
    });
    expect(prismaMock.profile.upsert).not.toHaveBeenCalled();
  });

  it('rejects a last name over 100 characters', async () => {
    const result = await updateProfile(baseData({ last_name: 'b'.repeat(101) }));

    expect(result).toEqual({
      success: false,
      error: 'Name is too long (maximum 100 characters).',
    });
    expect(prismaMock.profile.upsert).not.toHaveBeenCalled();
  });

  it('accepts a name at exactly the 100-character boundary', async () => {
    const result = await updateProfile(baseData({ first_name: 'a'.repeat(100) }));

    expect(result).toEqual({ success: true });
    expect(prismaMock.profile.upsert).toHaveBeenCalledOnce();
  });

  it('trims surrounding whitespace before persisting and computing the full name', async () => {
    const result = await updateProfile(baseData({ first_name: '  Jane ', last_name: ' Doe  ' }));

    expect(result).toEqual({ success: true });
    expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
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

    const result = await updateProfile(baseData({ first_name: '' }));

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.profile.upsert).not.toHaveBeenCalled();
  });
});
