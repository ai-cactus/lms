import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
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
    pages: {
        signIn: '/login',
    },
    trustHost: true,
    callbacks: {
        async session({ session, token }) {
            if (token.sub && session.user) {
                session.user.id = token.sub;
                session.user.organizationId = token.organizationId as string | undefined;
                session.user.role = token.role as string | undefined;
            }
            return session;
        },
        async jwt({ token, user }) {
            if (user) {
                token.organizationId = user.organizationId;
                token.role = user.role;
            }
            return token;
        }
    },
    // Fix for HTTP IP-based deployment (Loop issue):
    // Force usage of insecure cookies since we are likely not on HTTPS
    session: {
        strategy: 'jwt',
    },
    cookies: {
        sessionToken: {
            name: `next-auth.session-token`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: false, // Force false for HTTP IP access
            },
        },
    }
});
