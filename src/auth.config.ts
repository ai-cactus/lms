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
        async jwt({ token, user }) {
            if (user) {
                token.organizationId = user.organizationId;
                token.role = user.role;
            }
            return token;
        },
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
            // @ts-ignore
            const hasOrg = !!auth?.user?.organizationId;
            // @ts-ignore
            const role = auth?.user?.role;



            const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
            const isOnOnboarding = nextUrl.pathname.startsWith('/onboarding') && !nextUrl.pathname.startsWith('/onboarding-worker');
            const isOnOnboardingWorker = nextUrl.pathname.startsWith('/onboarding-worker');
            const isOnLearn = nextUrl.pathname.startsWith('/learn');
            const isOnAuth = nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/signup');
            const isWorkerPath = nextUrl.pathname.startsWith('/worker');

            if (isLoggedIn) {
                // @ts-ignore
                const hasOrg = !!auth.user?.organizationId;
                // @ts-ignore
                const role = auth.user?.role;

                // 1. Worker Redirection Logic
                if (role === 'worker') {
                    // If worker has no org, they MUST go to onboarding-worker
                    if (!hasOrg) {
                        if (isOnOnboardingWorker) return true; // Allow access
                        return Response.redirect(new URL('/onboarding-worker', nextUrl));
                    }

                    // If worker HAS org, they MUST go to /worker (or /learn if implemented)
                    if (hasOrg) {
                        if (isOnOnboardingWorker || isOnAuth) {
                            return Response.redirect(new URL('/worker', nextUrl));
                        }
                        // Workers cannot access dashboard
                        if (isOnDashboard) {
                            return Response.redirect(new URL('/worker', nextUrl));
                        }
                    }

                    // Allow access to /worker routes
                    if (isWorkerPath) return true;
                }

                // 2. Admin Redirection Logic
                if (role === 'admin') {
                    // If admin has no org, they MUST go to onboarding
                    if (!hasOrg) {
                        if (isOnOnboarding) return true;
                        return Response.redirect(new URL('/onboarding', nextUrl));
                    }

                    // If admin HAS org
                    if (hasOrg) {
                        if (isOnOnboarding || isOnAuth) {
                            return Response.redirect(new URL('/dashboard', nextUrl));
                        }
                        // Admins cannot access worker onboarding or worker routes? 
                        // (Maybe they can view, but for now redirect to dashboard)
                        if (isOnOnboardingWorker || isWorkerPath) {
                            return Response.redirect(new URL('/dashboard', nextUrl));
                        }
                    }
                }

                // Allow dashboard access for admins (implicit)
                if (isOnDashboard) return true;

            } else {
                // Not logged in
                if (isOnDashboard || isOnOnboarding || isOnOnboardingWorker || isOnLearn || isWorkerPath) {
                    return false; // Redirect to login
                }
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
