/**
 * Unit tests for src/proxy.ts (the auth/RBAC edge middleware).
 *
 * Focus: the new admin onboarding gates added alongside the staging-complaint
 * fix batch (mirrors the pre-existing worker gates) —
 *   - an admin session with NO organizationId hitting /dashboard/* is
 *     redirected to /onboarding instead of falling through to a page that
 *     would 500/render "no organization" (the courses page empty-state fix
 *     exists precisely because this proxy gate is the primary defense).
 *   - an admin session WITH organizationId hitting /onboarding/* is bounced
 *     back to /dashboard so a fully onboarded user can't re-enter the wizard.
 *
 * Plus a handful of pre-existing critical gates this file had ZERO test
 * coverage for before this session (no logged-in cookie, role mismatch,
 * MFA step-up, worker-side mirror) — included because a middleware this
 * security-critical (every /dashboard, /onboarding, /worker request) should
 * not ship changes with no regression guard at all.
 *
 * `next-auth/jwt`'s `decode` is mocked so these stay pure unit tests with no
 * real JWT encoding/HTTP — `handleProxy` itself is not exported, so it is
 * exercised indirectly through the exported `proxy(req)` entrypoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockDecode } = vi.hoisted(() => ({ mockDecode: vi.fn() }));

vi.mock('next-auth/jwt', () => ({ decode: mockDecode }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { proxy } from './proxy';

function makeRequest(pathname: string, cookieName?: string, cookieValue?: string): NextRequest {
  const url = `http://localhost:3005${pathname}`;
  const req = new NextRequest(url);
  if (cookieName) {
    req.cookies.set(cookieName, cookieValue ?? 'raw-token');
  }
  return req;
}

/** A Server Action invocation: POST to the current page carrying `next-action`. */
function makeServerActionRequest(pathname: string, cookieName: string): NextRequest {
  const req = new NextRequest(`http://localhost:3005${pathname}`, {
    method: 'POST',
    headers: { 'next-action': 'abc123def456' },
  });
  req.cookies.set(cookieName, 'raw-token');
  return req;
}

const ADMIN_COOKIE = 'admin.session-token';
const WORKER_COOKIE = 'worker.session-token';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy — admin onboarding gates', () => {
  it('redirects an org-less admin session away from /dashboard/* to /onboarding', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: null });

    const res = await proxy(makeRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/onboarding');
  });

  it('lets an org-less admin session through to /onboarding itself (no redirect loop)', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: null });

    const res = await proxy(makeRequest('/onboarding/step1', ADMIN_COOKIE));

    // NextResponse.next() carries no location header / redirect status.
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects an onboarded admin session away from /onboarding/* to /dashboard', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: 'org-1' });

    const res = await proxy(makeRequest('/onboarding/step1', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/dashboard');
  });

  it('lets an onboarded admin session through to /dashboard/*', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: 'org-1' });

    const res = await proxy(makeRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.headers.get('location')).toBeNull();
  });
});

describe('proxy — worker onboarding gates (pre-existing, mirrored by the admin gates above)', () => {
  it('redirects an org-less worker session away from /worker/* to /onboarding-worker', async () => {
    mockDecode.mockResolvedValue({ role: 'nurse', organizationId: null });

    const res = await proxy(makeRequest('/worker/courses/1', WORKER_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/onboarding-worker');
  });

  it('redirects an onboarded worker session away from /onboarding-worker to /worker', async () => {
    mockDecode.mockResolvedValue({ role: 'nurse', organizationId: 'org-1' });

    const res = await proxy(makeRequest('/onboarding-worker', WORKER_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/worker');
  });
});

describe('proxy — Server Action requests bypass the onboarding gates', () => {
  // Redirecting a Server Action POST to a different route crashes the client
  // with Next.js E394 instead of navigating. The onboarding gates are deferred
  // to the GET/RSC navigation that follows; the auth/role/MFA gates are not.
  it('lets an org-less admin Server Action POST on /dashboard/* through instead of redirecting it', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: null });

    const res = await proxy(makeServerActionRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.headers.get('location')).toBeNull();
  });

  it('lets an onboarded admin Server Action POST on /onboarding/* through instead of redirecting it', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: 'org-1' });

    const res = await proxy(makeServerActionRequest('/onboarding/step1', ADMIN_COOKIE));

    expect(res.headers.get('location')).toBeNull();
  });

  it('lets an org-less worker Server Action POST on /worker/* through instead of redirecting it', async () => {
    mockDecode.mockResolvedValue({ role: 'nurse', organizationId: null });

    const res = await proxy(makeServerActionRequest('/worker/courses/1', WORKER_COOKIE));

    expect(res.headers.get('location')).toBeNull();
  });

  it('still applies the role-mismatch gate to a Server Action POST', async () => {
    mockDecode.mockResolvedValue({ role: 'nurse', organizationId: 'org-1' });

    const res = await proxy(makeServerActionRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
  });

  it('still applies the MFA step-up gate to a Server Action POST', async () => {
    mockDecode.mockResolvedValue({
      role: 'owner',
      organizationId: 'org-1',
      mfaEnabled: true,
      mfaVerified: false,
    });

    const res = await proxy(makeServerActionRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
  });

  it('still redirects an unauthenticated Server Action POST to /login', async () => {
    const req = new NextRequest('http://localhost:3005/dashboard/courses', {
      method: 'POST',
      headers: { 'next-action': 'abc123def456' },
    });

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
  });

  it('applies the onboarding gate to an ordinary POST that is not a Server Action', async () => {
    mockDecode.mockResolvedValue({ role: 'owner', organizationId: null });

    const req = new NextRequest('http://localhost:3005/dashboard/courses', { method: 'POST' });
    req.cookies.set(ADMIN_COOKIE, 'raw-token');

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/onboarding');
  });
});

describe('proxy — session/role gates', () => {
  it('redirects to /login when no session cookie is present', async () => {
    const res = await proxy(makeRequest('/dashboard/courses'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('redirects to /login and clears the cookie when the token role no longer belongs to this context', async () => {
    // e.g. a role changed in the DB (jwt callback set it to a worker-only
    // role) but the stale admin-cookie token still claims admin access.
    mockDecode.mockResolvedValue({ role: 'nurse', organizationId: 'org-1' });

    const res = await proxy(makeRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
    expect(res.cookies.get(ADMIN_COOKIE)?.value).toBe('');
  });

  it('redirects to /login when the token fails to decode (malformed/expired) and clears the cookie', async () => {
    mockDecode.mockRejectedValue(new Error('decrypt failed'));

    const res = await proxy(makeRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
    expect(res.cookies.get(ADMIN_COOKIE)?.value).toBe('');
  });

  it('redirects to /login (not the challenge page) when MFA is enabled but not yet verified', async () => {
    mockDecode.mockResolvedValue({
      role: 'owner',
      organizationId: 'org-1',
      mfaEnabled: true,
      mfaVerified: false,
    });

    const res = await proxy(makeRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/login');
  });

  it('does not apply the MFA step-up gate on the login page itself', async () => {
    mockDecode.mockResolvedValue({
      role: 'owner',
      organizationId: 'org-1',
      mfaEnabled: true,
      mfaVerified: false,
    });

    const res = await proxy(makeRequest('/login', ADMIN_COOKIE));

    expect(res.headers.get('location')).toBeNull();
  });

  it('force-redirects to /reset-password when passwordResetRequired is set', async () => {
    mockDecode.mockResolvedValue({
      role: 'owner',
      organizationId: 'org-1',
      passwordResetRequired: true,
    });

    const res = await proxy(makeRequest('/dashboard/courses', ADMIN_COOKIE));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3005/reset-password?force=true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-013: API default-deny.
//
// Authentication for /api/** moved from per-handler imperative checks into the
// middleware, so a route is closed unless explicitly exempted. These tests are
// the guard against the two ways that change can go wrong: leaving a genuinely
// public endpoint unreachable (an outage), or exempting something that should
// have stayed closed (a hole).
// ─────────────────────────────────────────────────────────────────────────────
describe('proxy — API default-deny (F-013)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s an unauthenticated API request instead of letting the handler run', async () => {
    const res = await proxy(makeRequest('/api/billing/overview'));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    // Never a redirect: these are called by fetch(), and an HTML redirect
    // surfaces as an unparseable-response bug rather than a 401.
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows a request carrying a valid admin session', async () => {
    mockDecode.mockResolvedValue({ role: 'admin', organizationId: 'org-1' });

    const res = await proxy(makeRequest('/api/billing/overview', ADMIN_COOKIE));

    expect(res.status).toBe(200);
  });

  it('allows a request carrying a valid worker session', async () => {
    mockDecode.mockResolvedValue({ role: 'worker', organizationId: 'org-1' });

    const res = await proxy(makeRequest('/api/enrollments/e1/progress', 'worker.session-token'));

    expect(res.status).toBe(200);
  });

  it('401s when the cookie is present but undecodable', async () => {
    mockDecode.mockRejectedValue(new Error('bad signature'));

    const res = await proxy(makeRequest('/api/billing/overview', ADMIN_COOKIE));

    expect(res.status).toBe(401);
  });

  it('401s when decode resolves null', async () => {
    mockDecode.mockResolvedValue(null);

    const res = await proxy(makeRequest('/api/billing/overview', ADMIN_COOKIE));

    expect(res.status).toBe(401);
  });

  // Holding one stale cookie and one good one is normal during a session
  // transition, so a bad admin cookie must not mask a valid worker session.
  it('accepts a valid worker session even when the admin cookie is malformed', async () => {
    mockDecode
      .mockRejectedValueOnce(new Error('bad signature'))
      .mockResolvedValueOnce({ role: 'worker' });

    const req = makeRequest('/api/enrollments/e1/progress', ADMIN_COOKIE);
    req.cookies.set('worker.session-token', 'raw-token');

    const res = await proxy(req);

    expect(res.status).toBe(200);
  });

  describe('exemptions', () => {
    /**
     * Each of these MUST stay reachable without a session. A regression here is
     * an outage, not a hardening win:
     *   health          — the external uptime check runs before any login
     *   invite/accept   — the invitee has no account yet
     *   webhooks/stripe — called by Stripe; signature-authenticated. Blocking it
     *                     silently stops billing state reconciling
     *
     * contact-enterprise is deliberately NOT here: the name suggests a public
     * marketing form, but its only caller is the authenticated billing tab and
     * its handler requires `billing.read`. Allow-listing it would have made this
     * list document something untrue.
     */
    const publicRoutes = ['/api/health', '/api/invite/accept', '/api/webhooks/stripe'];

    it.each(publicRoutes)('allows %s without a session', async (path) => {
      const res = await proxy(makeRequest(path));

      expect(res.status).toBe(200);
      expect(mockDecode).not.toHaveBeenCalled();
    });

    // These run before a full session exists by nature.
    const preSessionAuthRoutes = [
      '/api/auth/verify',
      '/api/auth/resend-verification',
      '/api/auth/mfa/send',
      '/api/auth/mfa/verify',
      '/api/auth/signout-all',
      '/api/auth/callback/credentials',
      '/api/auth-worker/session',
    ];

    it.each(preSessionAuthRoutes)('allows %s without a session', async (path) => {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(200);
    });

    /**
     * /api/system/** authenticates with the HMAC system_admin_auth cookie, not a
     * NextAuth session, so requiring one here would lock the platform console
     * out entirely. Enforcing it at this layer would mean re-implementing that
     * HMAC with Web Crypto (the Edge runtime has no node:crypto) — duplicated
     * security logic, which is worse than the exemption. Unifying the two is
     * §4.4 of docs/rebuild/09-PLATFORM-ADMIN-SPEC.md.
     */
    it('passes /api/system/** through to its own auth mechanism', async () => {
      const res = await proxy(makeRequest('/api/system/manual'));

      expect(res.status).toBe(200);
      expect(mockDecode).not.toHaveBeenCalled();
    });

    // Exemption is by exact path, not prefix, so a nested route under a public
    // one does not inherit the exemption.
    it('does NOT exempt a nested path under a public route', async () => {
      const res = await proxy(makeRequest('/api/health/secrets'));
      expect(res.status).toBe(401);
    });
  });

  // Named like a public form, but authenticated: only the billing tab calls it
  // and the handler requires billing.read.
  it('gates /api/billing/contact-enterprise despite its public-sounding name', async () => {
    const res = await proxy(makeRequest('/api/billing/contact-enterprise'));
    expect(res.status).toBe(401);
  });

  it('stamps a correlation ID on the 401 as well', async () => {
    const res = await proxy(makeRequest('/api/billing/overview'));

    expect(res.status).toBe(401);
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });
});
