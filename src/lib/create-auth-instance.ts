import NextAuth, { NextAuthConfig, User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
type Role = 'admin' | 'worker';

interface AuthInstanceConfig {
  cookiePrefix: 'admin' | 'worker';
  allowedRole: Role;
  basePath: string; // "/api/auth" | "/api/auth-worker"
}

export function createAuthInstance(instanceConfig: AuthInstanceConfig) {
  const { cookiePrefix, allowedRole, basePath } = instanceConfig;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  // Fail fast at startup — prevents silent session failures in production.
  // In test or build environments, we allow a fallback to prevents crashes during CI/CD.
  const isBuildOrTest =
    process.env.NODE_ENV === 'test' ||
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.CI === 'true';
  const authSecret =
    process.env.NEXTAUTH_SECRET || (isBuildOrTest ? 'build-time-dummy-secret' : undefined);

  if (!authSecret) {
    throw new Error('[Auth] NEXTAUTH_SECRET is not defined. Set it in your environment variables.');
  }

  const config: NextAuthConfig = {
    secret: authSecret,
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

          logger.info({
            msg: 'Auth login attempt',
            email: maskEmail(email),
            instance: cookiePrefix,
          });
          const user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              password: true,
              role: true,
              organizationId: true,
              mfaEnabled: true,
              passwordResetRequired: true,
            },
          });

          if (!user || !user.password) {
            logger.warn({ msg: 'Auth login failed: user not found', instance: cookiePrefix });
            return null;
          }

          if (user.role !== allowedRole) {
            logger.warn({
              msg: 'Auth login failed: role mismatch',
              role: user.role,
              allowed: allowedRole,
              instance: cookiePrefix,
            });
            return null;
          }

          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            logger.warn({ msg: 'Auth login failed: invalid password', instance: cookiePrefix });
            return null;
          }

          logger.info({
            msg: 'Auth login success',
            email: maskEmail(user.email),
            instance: cookiePrefix,
            mfaEnabled: user.mfaEnabled,
          });

          return {
            id: user.id,
            email: user.email,
            role: user.role as Role,
            organizationId: user.organizationId,
            passwordResetRequired: user.passwordResetRequired,
            mfaVerified: !user.mfaEnabled, // If MFA disabled, auto-verified; if enabled, must verify
          } as User & { mfaVerified: boolean; passwordResetRequired: boolean };
        },
      }),

      // Expose Microsoft OAuth on both admin and worker instances if env vars are present
      ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID
        ? [
            MicrosoftEntraID({
              clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
              clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
              issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
              // allowDangerousEmailAccountLinking removed — prevents silent account takeover
              // via Microsoft OAuth for users with existing credentials accounts.
              // New users signing up via Microsoft OAuth are still created normally.
            }),
          ]
        : []),
    ],

    callbacks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async signIn({ user, account }: any) {
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
            logger.info({
              msg: 'OAuth: creating new user',
              email: maskEmail(user.email!),
              role: allowedRole,
            });

            let matchedOrgId = null;
            let matchedRole = allowedRole;

            if (pendingInvite) {
              matchedOrgId = pendingInvite.organizationId;
              const inviteRole = pendingInvite.role;
              matchedRole =
                inviteRole === 'admin' || inviteRole === 'worker' ? inviteRole : 'worker';
              logger.info({
                msg: 'OAuth: pending invite found',
                email: maskEmail(user.email!),
                orgId: matchedOrgId,
                role: matchedRole,
              });
            }

            const randomPassword = await bcrypt.hash(
              crypto.randomUUID() + Date.now().toString(),
              12,
            );

            dbUser = await prisma.user.create({
              data: {
                email: user.email!,
                password: randomPassword,
                authProvider: 'microsoft-entra-id',
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
              logger.info({
                msg: 'OAuth: existing user accepting invite',
                email: maskEmail(user.email!),
                orgId: pendingInvite.organizationId,
              });
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

          if (!dbUser.role) {
            logger.info({ msg: 'OAuth: user has no role, continuing for onboarding' });
          } else if (dbUser.role !== allowedRole) {
            logger.warn({
              msg: 'OAuth: role mismatch, routing to correct instance',
              expected: allowedRole,
              got: dbUser.role,
            });
            if (dbUser.role === 'worker')
              return '/api/auth-worker/signin/microsoft-entra-id?callbackUrl=/worker';
            if (dbUser.role === 'admin')
              return '/api/auth/signin/microsoft-entra-id?callbackUrl=/dashboard';
            return `${config.pages?.signIn}?error=AccessDenied`;
          }

          user.id = dbUser.id;
          user.organizationId = dbUser.organizationId;
          user.role = dbUser.role as Role;
          // OAuth users bypass MFA — Microsoft Entra ID has its own MFA policies
          (user as User & { mfaVerified?: boolean }).mfaVerified = true;

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
              logger.error({ msg: 'OAuth: failed to create profile', error: String(profileErr) });
              user.name = user.email!;
            }
          }
        }
        return true;
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async jwt({ token, user }: any) {
        if (user) {
          token.id = user.id;
          token.role = user.role;
          token.organizationId = user.organizationId;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          token.passwordResetRequired = (user as any).passwordResetRequired ?? false;
          token.mfaVerified = (user as User & { mfaVerified?: boolean }).mfaVerified ?? false;
          if (user.name) {
            token.name = user.name;
          }
          // Set initial activity timestamp on sign-in
          token.lastActivity = Date.now();
        }

        // ✅ Re-validate against DB on every decode
        if (token.id) {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              id: true,
              role: true,
              organizationId: true,
              mfaEnabled: true,
              passwordResetRequired: true,
              profile: { select: { fullName: true } },
            },
          });

          if (!freshUser) return null; // Invalidates session if user deleted
          if (freshUser.role !== allowedRole) return null; // Invalidates if role changed

          // ── Inactivity timeout check ──────────────────────────────────────
          const lastActivity = token.lastActivity as number | undefined;
          if (lastActivity) {
            const timeoutMinutes = Math.max(
              5,
              Math.min(120, parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || '15', 10)),
            );
            const elapsed = Date.now() - lastActivity;
            if (elapsed > timeoutMinutes * 60 * 1000) {
              logger.info({
                msg: 'Session expired due to inactivity',
                userId: token.id,
                elapsedMs: elapsed,
                timeoutMinutes,
                instance: cookiePrefix,
              });
              return null; // Invalidate session
            }
          }
          // Refresh activity timestamp
          token.lastActivity = Date.now();

          token.role = freshUser.role as Role;
          token.organizationId = freshUser.organizationId;
          token.name = freshUser.profile?.fullName || token.email || 'User';
          token.mfaEnabled = freshUser.mfaEnabled;
          token.passwordResetRequired = freshUser.passwordResetRequired;
        }

        return token;
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async session({ session, token }: any) {
        if (token) {
          session.user.id = token.id as string;
          session.user.role = token.role as Role;
          session.user.organizationId = token.organizationId as string | null;
          (session.user as User & { mfaVerified?: boolean }).mfaVerified =
            (token.mfaVerified as boolean) ?? false;
          (session.user as User & { mfaEnabled?: boolean }).mfaEnabled =
            (token.mfaEnabled as boolean) ?? false;
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

  const instance = NextAuth(config);
  return { ...instance, options: config };
}
