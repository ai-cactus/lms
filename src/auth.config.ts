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
        async session({ session, token }) {
            if (token.sub && session.user) {
                session.user.id = token.sub;
                session.user.organizationId = token.organizationId as string | undefined;
                session.user.role = token.role as string | undefined;
            }
            return session;
        },
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
            const isOnOnboarding = nextUrl.pathname.startsWith('/onboarding') && !nextUrl.pathname.startsWith('/onboarding-worker');
            const isOnOnboardingWorker = nextUrl.pathname.startsWith('/onboarding-worker');
            const isOnLearn = nextUrl.pathname.startsWith('/learn');
            const isOnAuth = nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/signup');

            if (isLoggedIn) {
                // @ts-ignore - organizationId is added in auth.ts
                const hasOrg = !!auth.user?.organizationId;
                // @ts-ignore - role is added in auth.ts
                const role = auth.user?.role;

                if (isOnDashboard) {
                    return true;
                }

                // Redirect new workers to code entry
                if (role === 'worker' && !hasOrg && !isOnOnboardingWorker) {
                    return Response.redirect(new URL('/onboarding-worker', nextUrl));
                }

                // Redirect new admins to onboarding
                if (role === 'admin' && !hasOrg && !isOnOnboarding) {
                    return Response.redirect(new URL('/onboarding', nextUrl));
                }

                // Prevent access to onboarding if already has org
                if (hasOrg && (isOnOnboarding || isOnOnboardingWorker)) {
                    if (role === 'worker') {
                        return Response.redirect(new URL('/worker', nextUrl));
                    }
                    return Response.redirect(new URL('/dashboard', nextUrl));
                }

                // Role-based Route Protection
                if (isOnDashboard) {
                    const path = nextUrl.pathname;

                    if (role === 'worker') {
                        // Workers should not be in dashboard at all
                        return Response.redirect(new URL('/worker', nextUrl));
                    }
                }

                // Protect Worker Routes
                if (nextUrl.pathname.startsWith('/worker')) {
                    if (role !== 'worker') {
                        return Response.redirect(new URL('/dashboard', nextUrl));
                    }
                }

                if (role === 'admin') {
                    // Block Worker Routes for Admins
                    if (nextUrl.pathname.startsWith('/worker')) {
                        return Response.redirect(new URL('/dashboard', nextUrl));
                    }
                }
            } else if (isOnDashboard) {
                return false; // Redirect to login
            }

            if (isOnOnboarding || isOnOnboardingWorker || isOnLearn) {
                if (!isLoggedIn) return false;
                return true;
            }

            if (isOnAuth) {
                if (isLoggedIn) {
                    // Logic for where to send them is complicated without user object here
                    // But typically straight to dashboard, and let dashboard redirect if needed?
                    // Or let's try to be smart if we can access session token properties
                    return Response.redirect(new URL('/dashboard', nextUrl));
                }
                return true;
            }
            return true;
        },
    },
    trustHost: true,
} satisfies NextAuthConfig;
