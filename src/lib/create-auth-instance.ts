import NextAuth, { NextAuthConfig, User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
type Role = 'admin' | 'worker';

interface AuthInstanceConfig {
  cookiePrefix: 'admin' | 'worker';
  allowedRole: Role;
  basePath: string; // "/api/auth" | "/api/auth-worker"
}

export function createAuthInstance(instanceConfig: AuthInstanceConfig) {
  const { cookiePrefix, allowedRole, basePath } = instanceConfig;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  const config: NextAuthConfig = {
    basePath,
    trustHost: true,

    // ✅ Cookie isolation — the ONLY thing that differs between instances
    cookies: {
      sessionToken: {
        name: `${useSecureCookies ? '__Secure-' : ''}${cookiePrefix}.session-token`,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
        },
      },
      csrfToken: {
        name: `${useSecureCookies ? '__Host-' : ''}${cookiePrefix}.csrf-token`,
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
      },
      callbackUrl: {
        name: `${useSecureCookies ? '__Secure-' : ''}${cookiePrefix}.callback-url`,
        options: { sameSite: 'lax', path: '/', secure: useSecureCookies },
      },
    },

    providers: [
      Credentials({
        async authorize(credentials) {
          const { email, password } = (credentials || {}) as {
            email: string;
            password: string;
          };

          console.log(
            `[NextAuth Factory] Attempting login for ${email} on instance ${cookiePrefix}`,
          );
          const user = await prisma.user.findUnique({ where: { email } });

          if (!user || !user.password) {
            console.log('[NextAuth Factory] User not found or no password map');
            return null;
          }

          if (user.role !== allowedRole) {
            console.log(
              `[NextAuth Factory] Role blocked. Found: ${user.role}, Allowed: ${allowedRole}`,
            );
            return null;
          }

          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            console.log('[NextAuth Factory] Password bcrypt validation failed');
            return null;
          }

          console.log(`[NextAuth Factory] Validated securely. Creating session for ${user.email}`);

          return {
            id: user.id,
            email: user.email,
            role: user.role as Role,
            organizationId: user.organizationId,
          } as User;
        },
      }),

      // Expose Microsoft OAuth on both admin and worker instances if env vars are present
      ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID
        ? [
            MicrosoftEntraID({
              clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
              clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
              issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
    ],

    callbacks: {
      async signIn({ user, account }) {
        if (account?.provider === 'microsoft-entra-id') {
          let dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true, organizationId: true, role: true },
          });

          // Check for pending invites
          const pendingInvite = await prisma.invite.findFirst({
            where: { email: user.email!, status: 'pending' },
            orderBy: { createdAt: 'desc' },
          });

          if (!dbUser) {
            // New user Signup Flow
            console.log(
              `[NextAuth] Creating new ${allowedRole} user via Microsoft OAuth: ${user.email}`,
            );

            let matchedOrgId = null;
            let matchedRole = allowedRole;

            if (pendingInvite) {
              matchedOrgId = pendingInvite.organizationId;
              const inviteRole = pendingInvite.role;
              matchedRole =
                inviteRole === 'admin' || inviteRole === 'worker' ? inviteRole : 'worker';
              console.log(
                `[NextAuth] Found pending invite for ${user.email}, joining org ${matchedOrgId} as ${matchedRole}`,
              );
            }

            dbUser = await prisma.user.create({
              data: {
                email: user.email!,
                password: '', // OAuth users don't need a password initially
                role: matchedRole,
                organizationId: matchedOrgId,
                emailVerified: true, // Trust OAuth provider email verification
              },
              select: { id: true, organizationId: true, role: true },
            });

            // Mark invite as accepted if we used one
            if (pendingInvite) {
              await prisma.invite.update({
                where: { id: pendingInvite.id },
                data: { status: 'accepted' },
              });
            }
          } else {
            // Existing user login
            if (pendingInvite && !dbUser.organizationId) {
              // User exists but has no org yet, and has a new invite
              console.log(
                `[NextAuth] Existing user ${user.email} accepting invite to org ${pendingInvite.organizationId}`,
              );
              dbUser = await prisma.user.update({
                where: { id: dbUser.id },
                data: {
                  organizationId: pendingInvite.organizationId,
                  role:
                    pendingInvite.role === 'admin' || pendingInvite.role === 'worker'
                      ? pendingInvite.role
                      : 'worker',
                },
                select: { id: true, organizationId: true, role: true },
              });

              await prisma.invite.update({
                where: { id: pendingInvite.id },
                data: { status: 'accepted' },
              });
            }
          }

          if (dbUser.role !== allowedRole) {
            console.log(
              `[NextAuth] Role mismatch during SSO. Expected ${allowedRole}, got ${dbUser.role}. Automatically routing to correct instance...`,
            );
            if (dbUser.role === 'worker')
              return '/api/auth-worker/signin/microsoft-entra-id?callbackUrl=/worker';
            if (dbUser.role === 'admin')
              return '/api/auth/signin/microsoft-entra-id?callbackUrl=/dashboard';
            return `${config.pages?.signIn}?error=AccessDenied`;
          }

          user.id = dbUser.id;
          user.organizationId = dbUser.organizationId;
          user.role = dbUser.role as Role;

          const profile = await prisma.profile.findUnique({
            where: { id: dbUser.id },
            select: { fullName: true },
          });

          if (profile?.fullName) {
            user.name = profile.fullName;
          } else {
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
                },
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

      async jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          token.role = user.role;
          token.organizationId = user.organizationId;
          if (user.name) {
            token.name = user.name;
          }
        }

        // ✅ Re-validate against DB on every decode
        if (token.id) {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              id: true,
              role: true,
              organizationId: true,
              profile: { select: { fullName: true } },
            },
          });

          if (!freshUser) return null; // Invalidates session if user deleted
          if (freshUser.role !== allowedRole) return null; // Invalidates if role changed

          token.role = freshUser.role as Role;
          token.organizationId = freshUser.organizationId;
          token.name = freshUser.profile?.fullName || token.email || 'User';
        }

        return token;
      },

      async session({ session, token }) {
        if (token) {
          session.user.id = token.id as string;
          session.user.role = token.role as Role;
          session.user.organizationId = token.organizationId as string | null;
        }
        return session;
      },
    },

    pages: {
      signIn: '/login',
      error: '/login',
    },

    session: { strategy: 'jwt' },
  };

  return NextAuth(config);
}
