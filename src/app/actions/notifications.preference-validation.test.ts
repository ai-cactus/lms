/**
 * RISK-03 — `setNotificationPreference(type, enabled)` accepted any string.
 * Server Action arguments are unchecked, so the type must be one the
 * notification catalog knows, and an unknown one is RETURNED as a refusal
 * (never thrown — production redacts thrown messages) with nothing written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, mockUpsert } = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = { notificationPreference: { upsert: mockUpsert } };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { setNotificationPreference } from './notifications';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({ user: { id: 'u1', organizationUserId: 'ou-1' } });
  mockUpsert.mockResolvedValue({});
});

describe('setNotificationPreference — type validation', () => {
  it('stores a preference for a catalog type', async () => {
    const result = await setNotificationPreference('COURSE_ASSIGNED', false);

    expect(result).toEqual({ success: true });
    expect(mockUpsert).toHaveBeenCalledExactlyOnceWith({
      where: { organizationUserId_type: { organizationUserId: 'ou-1', type: 'COURSE_ASSIGNED' } },
      create: { organizationUserId: 'ou-1', type: 'COURSE_ASSIGNED', enabled: false },
      update: { enabled: false },
    });
  });

  // COURSE_FAILED was withdrawn from the catalog (BUG-56): nothing ever sent it.
  it.each(['NOT_A_REAL_TYPE', '', 'course_assigned', 'COURSE_FAILED'])(
    'returns a refusal for the unknown type %j and writes nothing',
    async (type) => {
      const result = await setNotificationPreference(type, false);

      expect(result).toEqual({ success: false, error: 'Unknown notification type' });
      expect(mockUpsert).not.toHaveBeenCalled();
    },
  );

  it('refuses a non-boolean `enabled` rather than storing it', async () => {
    const result = await setNotificationPreference(
      'COURSE_ASSIGNED',
      'false' as unknown as boolean,
    );

    expect(result).toEqual({ success: false, error: 'Invalid preference value' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('still answers Unauthorized first when there is no membership', async () => {
    mockWorkerAuth.mockResolvedValue(null);

    const result = await setNotificationPreference('NOT_A_REAL_TYPE', false);

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
