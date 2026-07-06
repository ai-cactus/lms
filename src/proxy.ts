import { NextRequest, NextResponse } from 'next/server';
/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
// @ts-ignore - NextAuth does not reliably export decode type in this scope
import { decode, JWT } from 'next-auth/jwt';
import { logger, maskEmail } from '@/lib/logger';

// All route rules live in one config object — easy to audit and extend
const ROUTE_CONFIG = {
  worker: {
    cookiePrefix: 'worker',
    requiredRole: 'worker',
    loginPath: '/login',
    // All paths that belong to the worker context
    paths: ['/worker', '/onboarding-worker', '/api/auth-worker'],
    // Where a worker lands if they have no org yet
    onboardingPath: '/onboarding-worker',
    homePath: '/worker',
  },
  admin: {
    cookiePrefix: 'admin',
    requiredRole: 'admin',
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
  // work in runWithCorrelationId() (e.g. background jobs). Broadening this to
  // every API route is F-013 (deferred).
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
  if (pathname.startsWith('/api/auth')) {
    return passThrough();
  }

  // Not an auth-protected route — let it through
  if (!context) return passThrough();

  const cfg = ROUTE_CONFIG[context];
  // F-035: decode with the SAME secret the encoder signs with.
  // create-auth-instance.ts uses NEXTAUTH_SECRET; falling back to AUTH_SECRET
  // preserves parity if only the legacy variable is set. Reading a different
  // variable here than the encoder used would make every token fail to decode.
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET!;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  const cookieName = `${useSecureCookies ? '__Secure-' : ''}${cfg.cookiePrefix}.session-token`;
  const rawToken =
    req.cookies.get(cookieName)?.value ||
    req.cookies.get(`${cfg.cookiePrefix}.session-token`)?.value;

  logger.info({ msg: `[Proxy] Target Auth: ${context}` });
  logger.info({ msg: `[Proxy] Searching for cookie: ${cookieName}. Found token? ${!!rawToken}` });

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
    logger.info({
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
    logger.info({ msg: `[Proxy] Token is null after decode.` });
    return NextResponse.redirect(new URL(cfg.loginPath, req.url));
  }

  // ✅ Role mismatch at the token level (e.g., role changed in DB via jwt callback)
  if (token.role !== cfg.requiredRole) {
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
  // NOTE: We deliberately skip this check on the login page itself.
  // A user with an unfinished/abandoned 2FA session must be allowed to reach
  // /login so they can re-authenticate (as the same or a different account).
  // NextAuth's signIn flow will mint a new session and new sessionId, starting
  // the MFA challenge fresh. Redirecting to /verify-2fa from /login would
  // trap the user in the old session's 2FA flow with no way out.
  if (
    (token as unknown as Record<string, unknown>).mfaEnabled === true &&
    (token as unknown as Record<string, unknown>).mfaVerified !== true &&
    pathname !== '/verify-2fa' &&
    pathname !== cfg.loginPath
  ) {
    const mfaUrl = new URL('/verify-2fa', req.url);
    mfaUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(mfaUrl);
  }

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
    '/api/auth/:path*',
    '/api/auth-worker/:path*',
  ],
};
