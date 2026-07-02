import NextAuth, { NextAuthConfig, User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import { isSessionMfaVerified } from '@/lib/session-mfa';
import { ADMIN_ROLES, WORKER_ROLES, ALL_ROLES } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

interface AuthInstanceConfig {
  cookiePrefix: 'admin' | 'worker';
  allowedRoles: readonly Role[];
  basePath: string; // "/api/auth" | "/api/auth-worker"
}

export function createAuthInstance(instanceConfig: AuthInstanceConfig) {
  const { cookiePrefix, allowedRoles, basePath } = instanceConfig;
  const useSecureCookies = process.env.NODE_ENV === 'production';

  // Fail fast at startup — prevents silent session failures in production.
  // In test or build environments, we allow a fallback to prevents crashes during CI/CD.
  const isBuildOrTest =
    process.env.NODE_ENV === 'test' ||
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.CI === 'true';
  // Resolve the secret used to ENCRYPT the session JWT. This MUST match the value
  // the proxy uses to DECRYPT it (see src/proxy.ts) — same vars, same order:
  // AUTH_SECRET first, then NEXTAUTH_SECRET.
  const authSecret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (isBuildOrTest ? 'build-time-dummy-secret' : undefined);

  if (!authSecret) {
    throw new Error(
      '[Auth] Neither AUTH_SECRET nor NEXTAUTH_SECRET is defined. Set one in your environment variables.',
    );
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

          if (!allowedRoles.includes(user.role as Role)) {
            logger.warn({
              msg: 'Auth login failed: role mismatch',
              role: user.role,
              allowed: allowedRoles.join(','),
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
            // D3: a brand-new admin-instance user with no invite becomes `owner`
            // (they are founding an organisation). A worker-instance user with no
            // invite becomes `worker`.
            let matchedOrgId = null;
            let matchedRole: Role = allowedRoles.includes('worker') ? 'worker' : 'owner';

            logger.info({
              msg: 'OAuth: creating new user',
              email: maskEmail(user.email!),
              role: matchedRole,
            });

            if (pendingInvite) {
              matchedOrgId = pendingInvite.organizationId;
              const inviteRole = pendingInvite.role;
              const isValidRole = (r: unknown): r is Role => ALL_ROLES.includes(r as Role);
              matchedRole = isValidRole(inviteRole) ? inviteRole : 'worker';
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

            // Attach to the org's facility when joining via invite; null otherwise.
            const matchedFacilityId = matchedOrgId
              ? ((
                  await prisma.facility.findFirst({
                    where: { organizationId: matchedOrgId },
                    select: { id: true },
                  })
                )?.id ?? null)
              : null;

            dbUser = await prisma.user.create({
              data: {
                email: user.email!,
                password: randomPassword,
                authProvider: 'microsoft-entra-id',
                role: matchedRole,
                organizationId: matchedOrgId,
                facilityId: matchedFacilityId,
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
              const inviteFacility = await prisma.facility.findFirst({
                where: { organizationId: pendingInvite.organizationId },
                select: { id: true },
              });
              dbUser = await prisma.user.update({
                where: { id: dbUser.id },
                data: {
                  organizationId: pendingInvite.organizationId,
                  facilityId: inviteFacility?.id ?? null,
                  role: ALL_ROLES.includes(pendingInvite.role as Role)
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
          } else if (!allowedRoles.includes(dbUser.role as Role)) {
            logger.warn({
              msg: 'OAuth: role mismatch, routing to correct instance',
              expected: allowedRoles.join(','),
              got: dbUser.role,
            });
            if (WORKER_ROLES.includes(dbUser.role as Role))
              return '/api/auth-worker/signin/microsoft-entra-id?callbackUrl=/worker';
            if (ADMIN_ROLES.includes(dbUser.role as Role))
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
          // Generate a stable session ID once at sign-in. NextAuth v5 re-encodes the JWT
          // on every session() call, and .setIssuedAt() in the encoder overwrites `iat`
          // each time — so `iat` cannot be used as a session identifier.
          token.sessionId = crypto.randomUUID();
          if (user.name) {
            token.name = user.name;
          }
        }

        // ✅ Re-validate against DB on every decode
        if (token.id) {
          // Retired-role guard: the legacy `admin` role no longer exists. Any JWT
          // still carrying it predates the RBAC rollout and must be forced to
          // re-authenticate. NOTE: `worker` is NOT retired — worker sessions stay.
          if (token.role === 'admin') {
            logger.warn({
              msg: '[Auth] Stale JWT with retired admin role detected, forcing re-auth',
              instance: cookiePrefix,
            });
            return null;
          }

          let freshUser;
          try {
            freshUser = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: {
                id: true,
                role: true,
                organizationId: true,
                mfaEnabled: true,
                mfaVerifiedAt: true,
                passwordResetRequired: true,
                authProvider: true,
                profile: { select: { fullName: true } },
              },
            });
          } catch (dbError) {
            // DB failure (timeout, connection pool exhaustion, etc.) must NOT destroy sessions.
            // Return the existing token to keep the user logged in.
            logger.error({
              msg: '[Auth] JWT callback DB query failed, preserving session',
              error: String(dbError),
            });
            return token;
          }

          if (!freshUser) return null; // User was deleted — invalidate
          if (!allowedRoles.includes(freshUser.role as Role)) return null; // Role changed — invalidate

          token.role = freshUser.role as Role;
          token.organizationId = freshUser.organizationId;
          token.name = freshUser.profile?.fullName || token.email || 'User';
          token.mfaEnabled = freshUser.mfaEnabled;
          token.authProvider = freshUser.authProvider;
          token.passwordResetRequired = freshUser.passwordResetRequired;

          // Determine mfaVerified based on per-session Redis state:
          // Each session is identified by userId + sessionId (a stable UUID set
          // at sign-in), so completing MFA on one device doesn't mark other
          // sessions as verified.
          if (freshUser.mfaEnabled) {
            const sid = token.sessionId as string | undefined;
            if (sid) {
              token.mfaVerified = await isSessionMfaVerified(freshUser.id, sid);
            } else {
              token.mfaVerified = false;
            }
          } else {
            // MFA disabled — always considered verified
            token.mfaVerified = true;
          }
        }

        return token;
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async session({ session, token }: any) {
        if (token) {
          session.user.id = token.id as string;
          session.user.role = token.role as Role;
          session.user.organizationId = token.organizationId as string | null;
          session.user.authProvider = (token.authProvider as string) ?? 'credentials';
          (session.user as User & { mfaVerified?: boolean }).mfaVerified =
            (token.mfaVerified as boolean) ?? false;
          (session.user as User & { mfaEnabled?: boolean }).mfaEnabled =
            (token.mfaEnabled as boolean) ?? false;
          (session.user as User & { sessionId?: string }).sessionId =
            (token.sessionId as string) ?? undefined;
        }
        return session;
      },
    },

    pages: {
      signIn: '/login',
      error: '/login',
    },

    session: {
      strategy: 'jwt',
      maxAge: parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || '60', 10) * 60,
    },
  };

  const instance = NextAuth(config);
  return { ...instance, options: config };
}
