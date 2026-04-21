import { NextRequest, NextResponse } from 'next/server';
// @ts-expect-error - NextAuth does not reliably export decode type in this scope
import { decode, JWT } from 'next-auth/jwt';

// ✅ All route rules live in one config object — easy to audit and extend
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
  const { pathname } = req.nextUrl;
  const context = getContext(pathname);

  // NextAuth API routes handle their own session parsing and JSON responses.
  // We MUST NOT intercept them to return HTML redirects!
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Not an auth-protected route — let it through
  if (!context) return NextResponse.next();

  const cfg = ROUTE_CONFIG[context];
  const secret = process.env.AUTH_SECRET!;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  const cookieName = `${useSecureCookies ? '__Secure-' : ''}${cfg.cookiePrefix}.session-token`;
  const rawToken =
    req.cookies.get(cookieName)?.value ||
    req.cookies.get(`${cfg.cookiePrefix}.session-token`)?.value;

  console.log(`[Proxy] Target Auth: ${context}`);
  console.log(`[Proxy] Searching for cookie: ${cookieName}. Found token? ${!!rawToken}`);

  // Not logged in — send to the correct login page
  if (!rawToken) {
    // Don't redirect loop on the login page itself
    if (pathname === cfg.loginPath) return NextResponse.next();
    return NextResponse.redirect(new URL(cfg.loginPath, req.url));
  }

  let token: JWT | null = null;
  try {
    const salt = cookieName;
    token = await decode({ token: rawToken, secret, salt });
    // @ts-expect-error - JWT email is injected natively but omitted from standard JWT definition
    console.log(`[Proxy] Decoded token successfully for ${context}:`, token?.email);
  } catch (err) {
    console.error(`[Proxy] Token decode failed for ${context}:`, err);
    // Malformed/expired token — clear it and redirect
    const res = NextResponse.redirect(new URL(cfg.loginPath, req.url));
    res.cookies.delete(cookieName);
    return res;
  }

  if (!token) {
    console.log(`[Proxy] Token is null after decode.`);
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
    // @ts-expect-error - JWT email is injected natively but omitted from standard JWT definition
    url.searchParams.set('email', token.email as string);
    return NextResponse.redirect(url);
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
  // Each context reads ONLY its own cookie (line 48-49) and validates role (line 80).
  // Simultaneous admin + worker sessions in different tabs is expected behavior.
  return NextResponse.next();
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
