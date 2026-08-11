import { NextRequest, NextResponse } from 'next/server';
/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
// @ts-ignore - NextAuth does not reliably export decode type in this scope
import { decode, JWT } from 'next-auth/jwt';
import { logger, maskEmail } from '@/lib/logger';
import { ADMIN_ROLES, ALL_ROLES } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

// All route rules live in one config object — easy to audit and extend.
// `allowedRoles` is a set: after the RBAC migration the admin portal is shared by
// every admin-tier role (owner/supervisor/hr/clinical_director/finance). The
// worker portal accepts every role at the proxy so an admin bridged into learner
// mode (see actions/session-bridge.ts) can reach /worker on their worker cookie;
// the worker LOGIN form still gates on WORKER_ROLES.
const ROUTE_CONFIG = {
  worker: {
    cookiePrefix: 'worker',
    allowedRoles: ALL_ROLES,
    loginPath: '/login',
    // All paths that belong to the worker context
    paths: ['/worker', '/onboarding-worker', '/api/auth-worker'],
    // Where a worker lands if they have no org yet
    onboardingPath: '/onboarding-worker',
    homePath: '/worker',
  },
  admin: {
    cookiePrefix: 'admin',
    allowedRoles: ADMIN_ROLES,
    loginPath: '/login',
    paths: ['/dashboard', '/onboarding', '/login', '/api/auth'],
    homePath: '/dashboard',
  },
} as const;

function getContext(pathname: string): 'worker' | 'admin' | null {
  if (ROUTE_CONFIG.worker.paths.some((p) => pathname.startsWith(p))) return 'worker';
  if (ROUTE_CONFIG.admin.paths.some((p) => pathname.startsWith(p))) return 'admin';
  return null; // Public route — skip auth
}

/* ─── API default-deny (F-013) ───────────────────────────────────────────────
 *
 * Every `/api/**` handler used to guard itself with an imperative session check.
 * That is opt-in security: a handler that forgets one is fully open, and nothing
 * fails when it does. It also makes correctness impossible to verify locally — a
 * route that authorises several layers below its handler is indistinguishable,
 * to a reviewer or a grep, from a genuine hole.
 *
 * So authentication moves to the framework: unless a path is listed below, it
 * requires a valid session cookie before the handler runs. A new route is closed
 * by default, and opening it is a visible, reviewable edit to this file.
 *
 * SCOPE — this layer does authN only. Roles, org scoping, enrollment and MFA
 * step-up stay in the handlers: the Edge runtime cannot reach Prisma, and those
 * checks need the database. This does not replace `guardApiSession`; it means a
 * forgotten one is no longer an unauthenticated hole.
 */

/** Reachable WITHOUT any session, by design. Keep this list short and justified. */
const PUBLIC_API_ROUTES: readonly string[] = [
  // Liveness probe for the external uptime check — must answer before login.
  '/api/health',
  // The invitee has no account yet; authenticated by a CSPRNG token instead.
  '/api/invite/accept',
  // Called by Stripe, not a browser. Authenticated by webhook signature, and it
  // MUST stay reachable or billing state silently stops reconciling.
  '/api/webhooks/stripe',
];

/**
 * Prefixes that authenticate themselves by a DIFFERENT mechanism, so requiring a
 * NextAuth cookie here would lock them out.
 *
 * `/api/system/**` uses the HMAC `system_admin_auth` cookie
 * (src/lib/system-auth.ts), verified inside each handler. Enforcing it here would
 * mean re-implementing that HMAC with Web Crypto, since the Edge runtime has no
 * `node:crypto` — duplicated security logic in two places, which is worse than
 * this exemption. Unifying the two mechanisms is §4.4 of
 * docs/rebuild/09-PLATFORM-ADMIN-SPEC.md.
 */
const SELF_AUTHENTICATED_API_PREFIXES: readonly string[] = ['/api/system/'];

function isExemptApiRoute(pathname: string): boolean {
  if (PUBLIC_API_ROUTES.includes(pathname)) return true;
  return SELF_AUTHENTICATED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Requires SOME authenticated session on an API route. Either portal cookie
 * satisfies it — an admin bridged into learner mode legitimately holds both, and
 * deciding WHICH one is appropriate needs the database, so that stays in the
 * handler.
 */
async function gateApiRoute(
  req: NextRequest,
  pathname: string,
  passThrough: () => NextResponse,
): Promise<NextResponse> {
  if (isExemptApiRoute(pathname)) return passThrough();

  // Same vars in the same order as the encoder in create-auth-instance.ts, or
  // decoding fails and a valid session is wrongly rejected.
  const secret = (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)!;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  for (const prefix of ['admin', 'worker'] as const) {
    const cookieName = `${useSecureCookies ? '__Secure-' : ''}${prefix}.session-token`;
    const rawToken =
      req.cookies.get(cookieName)?.value || req.cookies.get(`${prefix}.session-token`)?.value;
    if (!rawToken) continue;

    try {
      // The salt must be the cookie name the token was encoded under.
      const token = await decode({ token: rawToken, secret, salt: cookieName });
      if (token) return passThrough();
    } catch {
      // A malformed cookie is not an authenticated session. Try the other portal
      // rather than failing outright — holding one bad cookie and one good one is
      // normal during a session transition.
    }
  }

  logger.warn({ msg: '[Proxy] Unauthenticated API request blocked', path: pathname });
  // JSON, never a redirect: these are called by fetch(), and an HTML redirect
  // surfaces as an unparseable-response bug rather than a 401.
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function proxy(req: NextRequest) {
  // F-067: Assign a correlation ID per matched request. Honour an inbound
  // x-correlation-id (distributed tracing) or mint a fresh one, and propagate
  // it on the request (to downstream handlers) and the response (to clients and
  // log pipelines).
  //
  // NOTE: the middleware runs on the Edge runtime, which cannot load
  // `node:async_hooks`, so we do NOT bind an AsyncLocalStorage scope here — we
  // only propagate the ID via headers. Node-runtime code that wants all its
  // logs stamped with this ID can read the x-correlation-id header and wrap its
  // work in runWithCorrelationId() (e.g. background jobs).
  //
  // The matcher now covers /api/:path*, so every API request gets a correlation
  // ID as well as the F-013 authentication gate.
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  const res = await handleProxy(req, correlationId);
  res.headers.set('x-correlation-id', correlationId);
  return res;
}

async function handleProxy(req: NextRequest, correlationId: string): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const context = getContext(pathname);

  // Forward the correlation ID to downstream handlers/pages as a request header
  // so any pass-through response carries it into the route it serves.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-correlation-id', correlationId);
  const passThrough = () => NextResponse.next({ request: { headers: requestHeaders } });

  // NextAuth API routes handle their own session parsing and JSON responses.
  // We MUST NOT intercept them to return HTML redirects!
  //
  // This prefix also covers the pre-session auth endpoints that legitimately run
  // without a cookie — /api/auth/verify, /api/auth/resend-verification,
  // /api/auth/mfa/{send,verify} and /api/auth/signout-all — plus
  // /api/auth-worker/**, which matches this prefix too. They are therefore
  // exempt from the API gate below by construction.
  if (pathname.startsWith('/api/auth')) {
    return passThrough();
  }

  // F-013: every other API route needs a session before its handler runs.
  if (pathname.startsWith('/api/')) {
    return gateApiRoute(req, pathname, passThrough);
  }

  // Not an auth-protected route — let it through
  if (!context) return passThrough();

  const cfg = ROUTE_CONFIG[context];
  // Must match the encoder in src/lib/create-auth-instance.ts — same vars, same
  // order (AUTH_SECRET first, then NEXTAUTH_SECRET) — or decryption fails and the
  // proxy would wrongly discard a valid session.
  const secret = (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)!;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  const cookieName = `${useSecureCookies ? '__Secure-' : ''}${cfg.cookiePrefix}.session-token`;
  const rawToken =
    req.cookies.get(cookieName)?.value ||
    req.cookies.get(`${cfg.cookiePrefix}.session-token`)?.value;

  logger.debug({ msg: `[Proxy] Target Auth: ${context}` });
  logger.debug({ msg: `[Proxy] Searching for cookie: ${cookieName}. Found token? ${!!rawToken}` });

  // Not logged in — send to the correct login page
  if (!rawToken) {
    // Don't redirect loop on the login page itself
    if (pathname === cfg.loginPath) return passThrough();
    return NextResponse.redirect(new URL(cfg.loginPath, req.url));
  }

  let token: JWT | null = null;
  try {
    const salt = cookieName;
    token = await decode({ token: rawToken, secret, salt });
    /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
    // @ts-ignore - JWT email is injected natively but omitted from standard JWT definition
    logger.debug({
      msg: `[Proxy] Decoded token successfully for ${context}`,
      email: maskEmail(token?.email ?? ''),
    });
  } catch (err) {
    logger.error({ msg: `[Proxy] Token decode failed for ${context}`, err });
    // Malformed/expired token — clear it and redirect
    const res = NextResponse.redirect(new URL(cfg.loginPath, req.url));
    res.cookies.delete(cookieName);
    return res;
  }

  if (!token) {
    logger.debug({ msg: `[Proxy] Token is null after decode.` });
    return NextResponse.redirect(new URL(cfg.loginPath, req.url));
  }

  // ✅ Role mismatch at the token level (e.g., role changed in DB via jwt callback).
  // The token role must belong to this context's allowed set.
  if (!cfg.allowedRoles.includes(token.role as Role)) {
    const res = NextResponse.redirect(new URL(cfg.loginPath, req.url));
    res.cookies.delete(cookieName);
    return res;
  }

  // ✅ Password Reset required check
  if (
    (token as unknown as Record<string, unknown>).passwordResetRequired &&
    pathname !== '/reset-password'
  ) {
    const url = new URL('/reset-password', req.url);
    url.searchParams.set('force', 'true');
    // F-057: The user's email is intentionally NOT placed in the URL — it
    // previously leaked PII in the query string (and browser history/logs).
    // The force-reset page resolves the user from the authenticated session.
    return NextResponse.redirect(url);
  }

  // ✅ MFA Step-up check
  //
  // A session whose MFA is enabled but not yet verified is bounced to /login —
  // NOT to the challenge page directly. The single email-OTP challenge lives
  // behind a short-lived Redis challenge token that only authenticate() (in
  // src/app/actions/auth.ts) mints on a fresh sign-in; there is no standing
  // challenge for the stateless Edge proxy to resume. A fresh login starts the
  // challenge cleanly and itself routes to /mfa/verify?challenge=...
  //
  // We deliberately skip this on /login itself so an unfinished/abandoned 2FA
  // session can re-authenticate (as the same or a different account) instead of
  // being trapped in a redirect loop.
  if (
    (token as unknown as Record<string, unknown>).mfaEnabled === true &&
    (token as unknown as Record<string, unknown>).mfaVerified !== true &&
    pathname !== cfg.loginPath
  ) {
    return NextResponse.redirect(new URL(cfg.loginPath, req.url));
  }

  // Server Actions POST to the page they were invoked from and carry a
  // `next-action` header. Answering one with a redirect to a DIFFERENT route
  // crashes the client ("An unexpected response was received from the server",
  // Next.js E394) instead of navigating. The onboarding gates below are purely
  // about where a session BELONGS, so they are safely deferred to the ordinary
  // GET/RSC navigation that follows the action — which hits them normally. The
  // auth/role/MFA gates above are deliberately NOT deferred: those must deny
  // the action itself.
  const isServerAction = req.method === 'POST' && req.headers.has('next-action');

  if (!isServerAction) {
    // Worker-specific: force onboarding if no org
    if (
      context === 'worker' &&
      !token.organizationId &&
      pathname !== ROUTE_CONFIG.worker.onboardingPath
    ) {
      return NextResponse.redirect(new URL(ROUTE_CONFIG.worker.onboardingPath, req.url));
    }

    // Worker with org trying to hit onboarding — send home
    if (
      context === 'worker' &&
      token.organizationId &&
      pathname === ROUTE_CONFIG.worker.onboardingPath
    ) {
      return NextResponse.redirect(new URL(ROUTE_CONFIG.worker.homePath, req.url));
    }
  }

  // ✅ Both admin and worker sessions can coexist independently.
  // Each context reads ONLY its own cookie and validates role above.
  // Simultaneous admin + worker sessions in different tabs is expected behavior.
  return passThrough();
}

export const config = {
  // ✅ Explicitly list all protected segments — no catch-all regex surprises
  matcher: [
    '/dashboard/:path*',
    '/onboarding/:path*',
    '/worker/:path*',
    '/onboarding-worker/:path*',
    '/login',
    // F-013: the whole API surface, so authentication is default-deny. Adding a
    // route no longer means remembering to guard it — see gateApiRoute and its
    // two exemption lists above.
    '/api/:path*',
  ],
};
