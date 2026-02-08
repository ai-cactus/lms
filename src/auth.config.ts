import type { NextAuthConfig } from 'next-auth';

// Define the config that is safe for Edge/Middleware
export const authConfig = {
    pages: {
        signIn: '/login',
    },
    providers: [
        // Providers will be merged in the main auth.ts
    ],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
            const isOnOnboarding = nextUrl.pathname.startsWith('/onboarding');
            const isOnAuth = nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/signup');

            if (isOnDashboard) {
                if (isLoggedIn) return true;
                return false; // Redirect to login
            }

            if (isOnOnboarding) {
                if (!isLoggedIn) return false;
                // We handle the 'hasOrg' redirect logic inside the middleware function or here if we had access to user details
                // But typically authorized callback is good for simple boolean checks
                return true;
            }

            if (isOnAuth) {
                if (isLoggedIn) {
                    return Response.redirect(new URL('/dashboard', nextUrl));
                }
                return true;
            }
            return true;
        },
    },
    trustHost: true,
} satisfies NextAuthConfig;
