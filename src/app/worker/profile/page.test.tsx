/**
 * BUG-65: the profile page sends the browser a signed display URL for the
 * user's avatar, never the stored storage URI — that names the bucket and the
 * object key. A save carries only a reference `uploadAvatar` returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockGetSignedUrl, mockProfileForm } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
    organizationUser: { findUnique: vi.fn() },
  },
  mockGetSignedUrl: vi.fn(),
  mockProfileForm: vi.fn(() => null),
}));

vi.mock('@/auth.worker', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/storage', () => ({ getSignedUrl: mockGetSignedUrl, deleteFile: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/components/worker/WorkerProfileForm', () => ({ default: mockProfileForm }));

import WorkerProfilePage from './page';

const STORED_URI = 'gcs://lms-private-bucket/avatars/worker-1/1700000000000-me.png';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'worker-1', organizationUserId: null, role: 'nurse' },
  });
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'worker-1',
    firstName: 'Nina',
    lastName: 'Adeyemi',
    email: 'nina@acme.test',
    avatarUrl: STORED_URI,
    authProvider: 'credentials',
  });
  mockGetSignedUrl.mockResolvedValue('https://signed.example/me.png?sig=1');
});

describe('WorkerProfilePage — avatar (BUG-65)', () => {
  it('passes the signed display URL and never the stored storage URI', async () => {
    const element = await WorkerProfilePage();
    const props = element.props as { user: Record<string, unknown> };

    expect(props.user.avatarDisplayUrl).toBe('https://signed.example/me.png?sig=1');
    expect(props.user).not.toHaveProperty('avatarUrl');
    expect(JSON.stringify(element.props)).not.toContain('lms-private-bucket');
    expect(JSON.stringify(element.props)).not.toContain('avatars/worker-1');
  });

  it('degrades to no display URL when signing fails, still without the URI', async () => {
    mockGetSignedUrl.mockRejectedValue(new Error('signing down'));

    const element = await WorkerProfilePage();
    const props = element.props as { user: Record<string, unknown> };

    expect(props.user.avatarDisplayUrl).toBeNull();
    expect(JSON.stringify(element.props)).not.toContain('lms-private-bucket');
  });
});
