import NextAuth from 'next-auth';
import { auth } from '@/auth';

export default auth((req) => {
    const isLoggedIn = !!req.auth;
    const isOnDashboard = req.nextUrl.pathname.startsWith('/dashboard');
    if (isOnDashboard) {
        if (isLoggedIn) return;
        return Response.redirect(new URL('/login', req.nextUrl)); // Redirect unauthenticated users to login page
    }

    // Redirect logged-in users away from Auth pages
    if (isLoggedIn && (req.nextUrl.pathname.startsWith('/login') || req.nextUrl.pathname.startsWith('/signup'))) {
        return Response.redirect(new URL('/dashboard', req.nextUrl));
    }
});

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
