/**
 * BUG-65: the profile page sends the browser a signed display URL for the
 * user's avatar, never the stored storage URI — that names the bucket and the
 * object key. A save carries only a reference `uploadAvatar` returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockGetSignedUrl, mockProfileSettings } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
    organizationUser: { findUnique: vi.fn() },
    facilityDocument: { findMany: vi.fn() },
  },
  mockGetSignedUrl: vi.fn(),
  mockProfileSettings: vi.fn(() => null),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/storage', () => ({ getSignedUrl: mockGetSignedUrl, deleteFile: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/facility/facility-cards', () => ({ listFacilityCards: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/components/dashboard/profile/ProfileSettings', () => ({
  default: mockProfileSettings,
}));

import ProfilePage from './page';

const STORED_URI = 'gcs://lms-private-bucket/avatars/admin-1/1700000000000-me.png';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'admin-1', organizationUserId: null, role: 'owner', email: 'o@acme.test' },
  });
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'admin-1',
    firstName: 'Ola',
    lastName: 'Owner',
    email: 'o@acme.test',
    avatarUrl: STORED_URI,
    authProvider: 'credentials',
  });
  mockGetSignedUrl.mockResolvedValue('https://signed.example/me.png?sig=1');
});

describe('ProfilePage — avatar (BUG-65)', () => {
  it('passes the signed display URL and never the stored storage URI', async () => {
    const element = await ProfilePage();
    const props = element.props as { profile: Record<string, unknown> };

    expect(props.profile.avatarDisplayUrl).toBe('https://signed.example/me.png?sig=1');
    expect(props.profile).not.toHaveProperty('avatarUrl');
    expect(JSON.stringify(element.props)).not.toContain('lms-private-bucket');
    expect(JSON.stringify(element.props)).not.toContain('avatars/admin-1');
  });
});
