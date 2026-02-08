import NextAuth from 'next-auth';
import { auth } from '@/auth';

export default auth((req) => {
    const isLoggedIn = !!req.auth;

    // cast user to any to avoid ts errors in middleware file before types are picked up globally
    const user = req.auth?.user as any;
    const hasOrg = !!user?.organizationId;

    const isOnDashboard = req.nextUrl.pathname.startsWith('/dashboard');
    const isOnOnboarding = req.nextUrl.pathname.startsWith('/onboarding');
    const isOnAuth = req.nextUrl.pathname.startsWith('/login') || req.nextUrl.pathname.startsWith('/signup');

    if (isOnDashboard) {
        if (!isLoggedIn) return Response.redirect(new URL('/login', req.nextUrl));
        // Strict org check removed for flexible onboarding
        // if (!hasOrg) return Response.redirect(new URL('/onboarding', req.nextUrl));
        return;
    }

    if (isOnOnboarding) {
        if (!isLoggedIn) return Response.redirect(new URL('/login', req.nextUrl));
        if (hasOrg) return Response.redirect(new URL('/dashboard', req.nextUrl));
        return;
    }

    if (isOnAuth) {
        if (isLoggedIn) {
            // Always go to dashboard, modal will handle org creation prompt
            return Response.redirect(new URL('/dashboard', req.nextUrl));
        }
        return;
    }
});

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
