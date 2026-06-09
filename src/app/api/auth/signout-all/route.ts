import { NextResponse } from 'next/server';

/**
 * GET /api/auth/signout-all
 *
 * Clears both the admin and worker session cookies, then redirects to /login.
 *
 * Why a custom endpoint instead of NextAuth's built-in signOut?
 *
 * The /verify-2fa page is a standalone page with no SessionProvider context.
 * It can be reached from EITHER an admin OR a worker session (or both, in
 * the multi-account scenario). NextAuth's client signOut() requires a
 * SessionProvider configured for the right basePath, which we cannot
 * determine without resolving the session first.
 *
 * This endpoint sidesteps that complexity by deleting both cookies outright.
 * It is safe because:
 *  - Cookies are HttpOnly — only the server can delete them.
 *  - Deleting an already-absent cookie is a no-op.
 *  - The user is immediately redirected to /login, which is a public route.
 */
export async function GET(req: Request) {
  const useSecureCookies = process.env.NODE_ENV === 'production';
  const loginUrl = new URL('/login', req.url).toString();

  const response = NextResponse.redirect(loginUrl);

  const cookiesToClear = [
    useSecureCookies ? '__Secure-admin.session-token' : 'admin.session-token',
    useSecureCookies ? '__Secure-worker.session-token' : 'worker.session-token',
    // Clear non-secure variants too, in case the environment switched
    'admin.session-token',
    'worker.session-token',
  ];

  for (const name of cookiesToClear) {
    response.cookies.set(name, '', {
      httpOnly: true,
      secure: useSecureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: 0, // Expire immediately
    });
  }

  return response;
}
