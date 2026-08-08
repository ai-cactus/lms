import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, mockCookies } = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCookies: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));

import { getPortalSessions } from './portal-sessions';

/** Builds the object `(await cookies()).getAll()` is expected to return. */
const cookieJar = (names: string[]) => ({
  getAll: () => names.map((name) => ({ name, value: 'v' })),
});

const ADMIN_SESSION = { user: { id: 'admin-1', organizationUserId: 'ou-admin' } };
const WORKER_SESSION = { user: { id: 'worker-1', organizationUserId: 'ou-worker' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(ADMIN_SESSION);
  mockWorkerAuth.mockResolvedValue(WORKER_SESSION);
});

describe('getPortalSessions', () => {
  it('calls only workerAuth when only the worker cookie is present', async () => {
    mockCookies.mockResolvedValue(cookieJar(['worker.session-token']));

    const result = await getPortalSessions();

    expect(mockWorkerAuth).toHaveBeenCalledTimes(1);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(result).toEqual({ admin: null, worker: WORKER_SESSION });
  });

  it('calls only adminAuth when only the admin cookie is present', async () => {
    mockCookies.mockResolvedValue(cookieJar(['admin.session-token']));

    const result = await getPortalSessions();

    expect(mockAdminAuth).toHaveBeenCalledTimes(1);
    expect(mockWorkerAuth).not.toHaveBeenCalled();
    expect(result).toEqual({ admin: ADMIN_SESSION, worker: null });
  });

  it('calls both auth instances concurrently when both cookies are present', async () => {
    mockCookies.mockResolvedValue(cookieJar(['admin.session-token', 'worker.session-token']));

    // Neither auth() call resolves until we release it — if getPortalSessions
    // awaited them sequentially, workerAuth would not have been invoked yet
    // by the time we assert immediately after calling it (before either
    // deferred resolves).
    let releaseAdmin!: (v: unknown) => void;
    let releaseWorker!: (v: unknown) => void;
    mockAdminAuth.mockReturnValue(new Promise((resolve) => (releaseAdmin = resolve)));
    mockWorkerAuth.mockReturnValue(new Promise((resolve) => (releaseWorker = resolve)));

    const pending = getPortalSessions();

    // Both must already have been invoked, proving Promise.all fan-out rather
    // than `await adminAuth(); await workerAuth()`.
    await vi.waitFor(() => {
      expect(mockAdminAuth).toHaveBeenCalledTimes(1);
      expect(mockWorkerAuth).toHaveBeenCalledTimes(1);
    });

    releaseAdmin(ADMIN_SESSION);
    releaseWorker(WORKER_SESSION);

    const result = await pending;
    expect(result).toEqual({ admin: ADMIN_SESSION, worker: WORKER_SESSION });
  });

  it('calls neither auth instance and returns both null when neither cookie is present', async () => {
    mockCookies.mockResolvedValue(cookieJar(['some-unrelated-cookie']));

    const result = await getPortalSessions();

    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(mockWorkerAuth).not.toHaveBeenCalled();
    expect(result).toEqual({ admin: null, worker: null });
  });

  it('resolves the worker session from a chunked cookie when the unchunked name is absent', async () => {
    // NextAuth splits a JWT over 4KB into `<name>.0`, `<name>.1`, … with no
    // standalone `worker.session-token` cookie present at all.
    mockCookies.mockResolvedValue(cookieJar(['worker.session-token.0', 'worker.session-token.1']));

    const result = await getPortalSessions();

    expect(mockWorkerAuth).toHaveBeenCalledTimes(1);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(result.worker).toEqual(WORKER_SESSION);
  });

  it('treats __Secure- prefixed cookie names the same as the plain names', async () => {
    mockCookies.mockResolvedValue(
      cookieJar(['__Secure-admin.session-token', '__Secure-worker.session-token']),
    );

    const result = await getPortalSessions();

    expect(mockAdminAuth).toHaveBeenCalledTimes(1);
    expect(mockWorkerAuth).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ admin: ADMIN_SESSION, worker: WORKER_SESSION });
  });

  it('resolves a chunked __Secure- cookie the same as a chunked plain cookie', async () => {
    mockCookies.mockResolvedValue(cookieJar(['__Secure-admin.session-token.0']));

    const result = await getPortalSessions();

    expect(mockAdminAuth).toHaveBeenCalledTimes(1);
    expect(mockWorkerAuth).not.toHaveBeenCalled();
    expect(result.admin).toEqual(ADMIN_SESSION);
  });

  it('degrades to calling both auth instances when cookies() throws (no request scope)', async () => {
    mockCookies.mockRejectedValue(new Error('cookies() was called outside a request scope'));

    const result = await getPortalSessions();

    expect(mockAdminAuth).toHaveBeenCalledTimes(1);
    expect(mockWorkerAuth).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ admin: ADMIN_SESSION, worker: WORKER_SESSION });
  });
});
