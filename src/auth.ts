import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"
import { authConfig } from './auth.config';

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
        }),
        Credentials({
            async authorize(credentials) {
                const parsedCredentials = loginSchema.safeParse(credentials);

                if (parsedCredentials.success) {
                    const { email, password } = parsedCredentials.data;
                    const user = await prisma.user.findUnique({ where: { email } });
                    if (!user) return null;

                    const passwordsMatch = await bcrypt.compare(password, user.password);
                    if (passwordsMatch) return user;
                }

                console.log('Invalid credentials');
                return null;
            },
        }),
    ],
    // Overwrite callbacks to include database logic which is not safe for edge
    callbacks: {
        ...authConfig.callbacks,
        async signIn({ user, account }) {
            if (account?.provider === 'microsoft-entra-id') {
                // Look up user by email in our DB to link OAuth identity
                const dbUser = await prisma.user.findUnique({
                    where: { email: user.email! },
                    select: { id: true, organizationId: true, role: true }
                });
                if (!dbUser) {
                    // User has no account in our system — block sign-in
                    return '/login?error=NoAccount';
                }
                // Override the OAuth provider ID with our DB user ID and attach DB fields
                user.id = dbUser.id;
                user.organizationId = dbUser.organizationId;
                user.role = dbUser.role;

                // Check for DB profile name
                const profile = await prisma.profile.findUnique({
                    where: { id: dbUser.id },
                    select: { fullName: true }
                });

                if (profile?.fullName) {
                    // Override OAuth name with DB profile name
                    user.name = profile.fullName;
                } else {
                    // No profile exists (e.g. user was created via enrollment invite)
                    // Create a profile from OAuth data so they have an identity
                    const oauthName = user.name || '';
                    const nameParts = oauthName.split(' ');
                    const firstName = nameParts[0] || '';
                    const lastName = nameParts.slice(1).join(' ') || '';

                    try {
                        await prisma.profile.create({
                            data: {
                                id: dbUser.id,
                                email: user.email!,
                                firstName,
                                lastName,
                                fullName: oauthName || user.email!,
                            }
                        });
                        user.name = oauthName || user.email!;
                    } catch (profileErr) {
                        console.error('[Auth] Failed to create profile for OAuth user:', profileErr);
                        user.name = user.email!;
                    }
                }
            }
            return true;
        },
        async jwt({ token, user, trigger, session }) {
            if (user) {
                token.sub = user.id; // Ensure DB user ID, not OAuth provider ID
                token.organizationId = user.organizationId;
                token.role = user.role;
                if (user.name) {
                    token.name = user.name; // Store DB profile name
                }
            }

            // Always fetch fresh data on subsequent calls to keep session in sync
            if (!user && token.sub) {
                try {
                    const freshUser = await prisma.user.findUnique({
                        where: { id: token.sub },
                        select: { organizationId: true, role: true, profile: { select: { fullName: true } } }
                    });

                    if (freshUser) {
                        token.organizationId = freshUser.organizationId;
                        token.role = freshUser.role;
                        // Always sync name from DB profile; fall back to email
                        token.name = freshUser.profile?.fullName || token.email || 'User';
                    } else {
                        console.error('[Auth] User not found during refresh. Invalidating session for:', token.sub);
                        return null; // Invalidate session
                    }
                } catch (error) {
                    console.error('[Auth] Error fetching user:', error);
                    // If DB is down, maybe don't invalidate immediately? 
                    // But for now, safety first.
                    return null;
                }
            }
            return token;
        }
    },
});
