import { NextRequest, NextResponse } from "next/server";
import { decode, JWT } from "next-auth/jwt";

// ✅ All route rules live in one config object — easy to audit and extend
const ROUTE_CONFIG = {
  worker: {
    cookiePrefix: "worker",
    requiredRole: "worker",
    loginPath: "/login-worker",
    // All paths that belong to the worker context
    paths: ["/worker", "/onboarding-worker", "/login-worker", "/api/auth-worker"],
    // Where a worker lands if they have no org yet
    onboardingPath: "/onboarding-worker",
    homePath: "/worker",
  },
  admin: {
    cookiePrefix: "admin",
    requiredRole: "admin",
    loginPath: "/login",
    paths: ["/dashboard", "/onboarding", "/login", "/api/auth"],
    homePath: "/dashboard",
  },
} as const;

function getContext(pathname: string): "worker" | "admin" | null {
  if (ROUTE_CONFIG.worker.paths.some((p) => pathname.startsWith(p))) return "worker";
  if (ROUTE_CONFIG.admin.paths.some((p) => pathname.startsWith(p))) return "admin";
  return null; // Public route — skip auth
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let context = getContext(pathname);

  // NextAuth API routes handle their own session parsing and JSON responses.
  // We MUST NOT intercept them to return HTML redirects!
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Not an auth-protected route — let it through
  if (!context) return NextResponse.next();

  const cfg = ROUTE_CONFIG[context];
  const secret = process.env.AUTH_SECRET!;
  const useSecureCookies = process.env.NODE_ENV === "production";

  const cookieName = `${useSecureCookies ? "__Secure-" : ""}${cfg.cookiePrefix}.session-token`;
  const rawToken = req.cookies.get(cookieName)?.value || req.cookies.get(`${cfg.cookiePrefix}.session-token`)?.value;

  console.log(`[Middleware] Target Auth: ${context}`);
  console.log(`[Middleware] Searching for cookie: ${cookieName}. Found token? ${!!rawToken}`);

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
    console.log(`[Middleware] Decoded token successfully for ${context}:`, token?.email);
  } catch (err) {
    console.error(`[Middleware] Token decode failed for ${context}:`, err);
    // Malformed/expired token — clear it and redirect
    const res = NextResponse.redirect(new URL(cfg.loginPath, req.url));
    res.cookies.delete(cookieName);
    return res;
  }

  if (!token) {
    console.log(`[Middleware] Token is null after decode.`);
    return NextResponse.redirect(new URL(cfg.loginPath, req.url));
  }

  // ✅ Role mismatch at the token level (e.g., role changed in DB via jwt callback)
  if (token.role !== cfg.requiredRole) {
    const res = NextResponse.redirect(new URL(cfg.loginPath, req.url));
    res.cookies.delete(cookieName);
    return res;
  }

  // Worker-specific: force onboarding if no org
  if (
    context === "worker" &&
    !token.organizationId &&
    pathname !== ROUTE_CONFIG.worker.onboardingPath
  ) {
    return NextResponse.redirect(new URL(ROUTE_CONFIG.worker.onboardingPath, req.url));
  }

  // Worker with org trying to hit onboarding — send home
  if (
    context === "worker" &&
    token.organizationId &&
    pathname === ROUTE_CONFIG.worker.onboardingPath
  ) {
    return NextResponse.redirect(new URL(ROUTE_CONFIG.worker.homePath, req.url));
  }

  return NextResponse.next();
}

export const config = {
  // ✅ Explicitly list all protected segments — no catch-all regex surprises
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/worker/:path*",
    "/onboarding-worker/:path*",
    "/login",
    "/login-worker",
    "/api/auth/:path*",
    "/api/auth-worker/:path*",
  ],
};
