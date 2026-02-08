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
        async session({ session, token }) {
            if (token.sub && session.user) {
                session.user.id = token.sub;
                session.user.organizationId = token.organizationId as string | undefined;
                session.user.role = token.role as string | undefined;
            }
            return session;
        },
        async jwt({ token, user, trigger, session }) {
            if (user) {
                token.organizationId = user.organizationId;
                token.role = user.role;
            }

            // Always fetch fresh data on subsequent calls to keep session in sync
            if (!user && token.sub) {
                const freshUser = await prisma.user.findUnique({
                    where: { id: token.sub },
                    select: { organizationId: true, role: true }
                });

                if (freshUser) {
                    token.organizationId = freshUser.organizationId;
                    token.role = freshUser.role;
                }
            }
            return token;
        }
    },
});
