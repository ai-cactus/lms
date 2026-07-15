import NextAuth, { NextAuthConfig, User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { expireSiblingSessionCookies } from '@/lib/auth/session-cookies';
import { logger, maskEmail } from '@/lib/logger';
import { isSessionMfaVerified } from '@/lib/session-mfa';
import {
  ADMIN_ROLES,
  WORKER_ROLES,
  ALL_ROLES,
  DEFAULT_SELF_SERVE_WORKER_ROLE,
} from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit, getClientContext } from '@/lib/audit';
import { BCRYPT_COST } from '@/lib/bcrypt-config';

interface AuthInstanceConfig {
  cookiePrefix: 'admin' | 'worker';
  allowedRoles: readonly Role[];
  basePath: string; // "/api/auth" | "/api/auth-worker"
  // Roles allowed to KEEP an existing session on this instance during JWT
  // re-validation, as opposed to `allowedRoles` which gates who may LOG IN.
  // Defaults to `allowedRoles`. The worker instance widens this to ALL_ROLES so
  // an admin who bridges into learner mode (see actions/session-bridge.ts) keeps
  // a valid worker-cookie session without being able to log in via the worker
  // login form.
  sessionAllowedRoles?: readonly Role[];
}

// Record the user's most-recent sign-in time. Fire-and-forget and fully
// guarded: a failure here must never break the auth path, so it is logged at
// `warn` and swallowed rather than propagated.
function recordLoginTimestamp(userId: string, instance: string) {
  prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }).catch((err) => {
    logger.warn({ msg: '[auth] Failed to record lastLoginAt', userId, instance, err });
  });
}

export function createAuthInstance(instanceConfig: AuthInstanceConfig) {
  const { cookiePrefix, allowedRoles, basePath } = instanceConfig;
  const sessionAllowedRoles = instanceConfig.sessionAllowedRoles ?? allowedRoles;
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
        async authorize(credentials, request) {
          const { email, password } = (credentials || {}) as {
            email: string;
            password: string;
          };

          // F-033: Throttle at the credential layer so a direct POST to
          // /api/auth/callback/credentials is rate-limited even when it bypasses
          // the `authenticate` server action (which throttles per-IP on its own).
          // Uses dedicated key namespaces so it doesn't share counters with the
          // action's `login:${ip}` limiter. Returns null (a normal auth failure)
          // when exceeded, preserving the existing timing/return behavior.
          const ip =
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') ||
            'unknown';
          const normalizedEmail = email?.toLowerCase().trim();
          // F-001: client context for the audit trail (best-effort ip/user-agent).
          const clientCtx = getClientContext(request.headers);
          const maskedEmail = email ? maskEmail(email) : undefined;

          // F-024: auth-critical — fail CLOSED if Redis is down so an outage can't
          // open an unlimited credential-stuffing window at the callback layer.
          const ipCheck = await checkRateLimit(`login:callback:ip:${ip}`, 10, 900, {
            failClosed: true,
          });
          const acctCheck = normalizedEmail
            ? await checkRateLimit(`login:callback:acct:${normalizedEmail}`, 10, 900, {
                failClosed: true,
              })
            : { allowed: true };
          if (!ipCheck.allowed || !acctCheck.allowed) {
            logger.warn({
              msg: 'Auth login throttled at credential layer',
              instance: cookiePrefix,
              ip,
            });
            await audit({
              action: 'auth.login.failure',
              ...clientCtx,
              metadata: { reason: 'rate_limited', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

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
            await audit({
              action: 'auth.login.failure',
              ...clientCtx,
              metadata: { reason: 'user_not_found', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

          if (!allowedRoles.includes(user.role as Role)) {
            logger.warn({
              msg: 'Auth login failed: role mismatch',
              role: user.role,
              allowed: allowedRoles.join(','),
              instance: cookiePrefix,
            });
            await audit({
              action: 'auth.login.failure',
              actorId: user.id,
              actorRole: user.role,
              organizationId: user.organizationId ?? undefined,
              ...clientCtx,
              metadata: { reason: 'role_mismatch', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

          // ISSUE 2: a non-owner admin-tier account with no org has been removed
          // from its organization (owner is the only legitimately org-less admin
          // role, mid-onboarding). Deny login before verifying the password.
          if (cookiePrefix === 'admin' && user.role !== 'owner' && !user.organizationId) {
            logger.warn({
              msg: 'Auth login failed: removed from organization',
              instance: cookiePrefix,
            });
            await audit({
              action: 'auth.login.failure',
              actorId: user.id,
              actorRole: user.role,
              ...clientCtx,
              metadata: { reason: 'removed_from_org', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            logger.warn({ msg: 'Auth login failed: invalid password', instance: cookiePrefix });
            await audit({
              action: 'auth.login.failure',
              actorId: user.id,
              actorRole: user.role,
              organizationId: user.organizationId ?? undefined,
              ...clientCtx,
              metadata: { reason: 'invalid_password', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

          // F-058: transparently upgrade legacy hashes stored below the current
          // cost. Best-effort — a failed re-hash must never block a valid login.
          const costMatch = /^\$2[aby]\$(\d{2})\$/.exec(user.password);
          const storedCost = costMatch ? parseInt(costMatch[1], 10) : null;
          if (storedCost !== null && storedCost < BCRYPT_COST) {
            try {
              const upgraded = await bcrypt.hash(password, BCRYPT_COST);
              await prisma.user.update({
                where: { id: user.id },
                data: { password: upgraded },
              });
              logger.info({
                msg: 'Auth: upgraded password hash cost on login',
                userId: user.id,
                fromCost: storedCost,
                toCost: BCRYPT_COST,
              });
            } catch (rehashErr) {
              logger.error({
                msg: 'Auth: password hash upgrade failed (login unaffected)',
                userId: user.id,
                err: rehashErr,
              });
            }
          }

          logger.info({
            msg: 'Auth login success',
            email: maskEmail(user.email),
            instance: cookiePrefix,
            mfaEnabled: user.mfaEnabled,
          });
          await audit({
            action: 'auth.login.success',
            actorId: user.id,
            actorRole: user.role,
            organizationId: user.organizationId ?? undefined,
            ...clientCtx,
            metadata: { instance: cookiePrefix, mfaEnabled: user.mfaEnabled },
          });

          recordLoginTimestamp(user.id, cookiePrefix);

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

    events: {
      // F-001: audit logout. For the JWT strategy the signOut event carries the
      // decoded `token`; record the account that signed out (best-effort).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async signOut(message: any) {
        const token = message && 'token' in message ? message.token : null;
        if (!token) return;
        await audit({
          actorId: token.id ?? token.sub,
          actorRole: token.role,
          organizationId: token.organizationId ?? undefined,
          action: 'auth.logout',
          targetType: 'user',
          targetId: token.id ?? token.sub,
        });
      },
    },

    callbacks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async signIn({ user, account }: any) {
        if (account?.provider === 'microsoft-entra-id') {
          let dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true, organizationId: true, role: true },
          });

          const pendingInvite = await prisma.invite.findFirst({
            where: { email: user.email!, status: 'pending' },
            orderBy: { createdAt: 'desc' },
          });

          if (!dbUser) {
            // D3: a brand-new admin-instance user with no invite becomes `owner`
            // (they are founding an organisation). A worker-instance user with no
            // invite becomes the default self-serve worker role.
            let matchedOrgId = null;
            let matchedRole: Role =
              cookiePrefix === 'worker' ? DEFAULT_SELF_SERVE_WORKER_ROLE : 'owner';

            logger.info({
              msg: 'OAuth: creating new user',
              email: maskEmail(user.email!),
              role: matchedRole,
            });

            if (pendingInvite) {
              matchedOrgId = pendingInvite.organizationId;
              const inviteRole = pendingInvite.role;
              const isValidRole = (r: unknown): r is Role => ALL_ROLES.includes(r as Role);
              matchedRole = isValidRole(inviteRole) ? inviteRole : DEFAULT_SELF_SERVE_WORKER_ROLE;
              logger.info({
                msg: 'OAuth: pending invite found',
                email: maskEmail(user.email!),
                orgId: matchedOrgId,
                role: matchedRole,
              });
            }

            const randomPassword = await bcrypt.hash(
              crypto.randomUUID() + Date.now().toString(),
              BCRYPT_COST,
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

            // F-001: OAuth-originated signup.
            await audit({
              action: 'auth.signup',
              actorId: dbUser.id,
              actorRole: matchedRole,
              organizationId: dbUser.organizationId ?? undefined,
              metadata: {
                provider: 'microsoft-entra-id',
                viaInvite: !!pendingInvite,
                email: maskEmail(user.email!),
              },
            });

            if (pendingInvite) {
              await prisma.invite.update({
                where: { id: pendingInvite.id },
                data: { status: 'accepted' },
              });
              await audit({
                action: 'auth.invite.accept',
                actorId: dbUser.id,
                actorRole: matchedRole,
                organizationId: pendingInvite.organizationId ?? undefined,
                targetType: 'invite',
                targetId: pendingInvite.id,
                metadata: { provider: 'microsoft-entra-id', email: maskEmail(user.email!) },
              });
            }
          } else {
            if (pendingInvite && !dbUser.organizationId) {
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
                    : DEFAULT_SELF_SERVE_WORKER_ROLE,
                },
                select: { id: true, organizationId: true, role: true },
              });

              await prisma.invite.update({
                where: { id: pendingInvite.id },
                data: { status: 'accepted' },
              });
              // F-001: existing OAuth user consuming a pending invite.
              await audit({
                action: 'auth.invite.accept',
                actorId: dbUser.id,
                actorRole: (dbUser.role as Role) ?? undefined,
                organizationId: pendingInvite.organizationId ?? undefined,
                targetType: 'invite',
                targetId: pendingInvite.id,
                metadata: { provider: 'microsoft-entra-id', email: maskEmail(user.email!) },
              });
            } else if (
              cookiePrefix === 'admin' &&
              dbUser.role !== 'owner' &&
              !dbUser.organizationId
            ) {
              // ISSUE 2: a non-owner admin-tier account with no org has been
              // removed from its organization — deny the OAuth login.
              logger.warn({
                msg: 'OAuth: removed non-owner admin denied',
                email: maskEmail(user.email!),
              });
              return `${config.pages?.signIn}?error=AccessRevoked`;
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

          recordLoginTimestamp(dbUser.id, cookiePrefix);
          // OAuth users bypass MFA — Microsoft Entra ID has its own MFA policies
          (user as User & { mfaVerified?: boolean }).mfaVerified = true;

          // F-001: OAuth login success (role gate already passed above).
          await audit({
            action: 'auth.login.success',
            actorId: dbUser.id,
            actorRole: (dbUser.role as Role) ?? undefined,
            organizationId: dbUser.organizationId ?? undefined,
            metadata: {
              provider: 'microsoft-entra-id',
              instance: cookiePrefix,
              email: maskEmail(user.email!),
            },
          });

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

        // ISSUE 4: a successful login on this instance must drop any lingering
        // session cookie from the sibling instance, so the two portals never
        // hold two live sessions for different accounts at once. Deletion is
        // emitted via expireSiblingSessionCookies() (not a bare cookies().delete)
        // so the `__Secure-` prefixed cookie is expired WITH the `Secure`
        // attribute — a bare delete omits it and the browser rejects the
        // deletion under https (see session-cookies.ts).
        try {
          const cookieStore = await cookies();
          expireSiblingSessionCookies(cookieStore, cookiePrefix);
          logger.info({
            msg: '[Auth] Cleared sibling session cookie on login',
            instance: cookiePrefix,
          });
        } catch (err) {
          logger.warn({
            msg: '[Auth] Failed to clear sibling session cookie on login',
            instance: cookiePrefix,
            err,
          });
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
          // re-authenticate. A stale `worker` token needs no such guard — it
          // self-heals below when DB re-validation overwrites token.role with the
          // user's migrated worker-category role.
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
                sessionVersion: true,
                authProvider: true,
                profile: { select: { fullName: true } },
              },
            });
          } catch (dbError) {
            // F-036 (deliberate, do not change): this path is fail-OPEN. A DB
            // failure (timeout, connection pool exhaustion, etc.) must NOT
            // destroy sessions — we return the existing token to keep the user
            // logged in. This trades revocation latency for availability: a DB
            // blip should never mass-log-out the fleet. Session invalidation
            // still happens on the next successful decode once the DB recovers.
            logger.error({
              msg: '[Auth] JWT callback DB query failed, preserving session',
              error: String(dbError),
            });
            return token;
          }

          if (!freshUser) return null; // User was deleted — invalidate
          if (!sessionAllowedRoles.includes(freshUser.role as Role)) return null; // Role no longer permitted on this instance — invalidate

          // F-059: a completed password reset bumps `sessionVersion`, logging out
          // every other existing session. On sign-in `token.sessionVersion` is
          // still unset (or is a legacy token that predates this field), so we
          // stamp it below rather than invalidate. Only a definite mismatch —
          // a number on the token that differs from the freshly-read value —
          // means the password was reset elsewhere, so invalidate. DB errors
          // already returned above with the token intact, so a blip never
          // mass-logs-out.
          if (
            typeof token.sessionVersion === 'number' &&
            token.sessionVersion !== freshUser.sessionVersion
          ) {
            return null;
          }
          token.sessionVersion = freshUser.sessionVersion;

          // Defense-in-depth: a non-owner admin-tier account with no org can only be
          // in this state after staff removal (owner is the only legitimately
          // org-less admin role, mid-onboarding). Catches it even if a future removal
          // path forgets to bump sessionVersion.
          if (cookiePrefix === 'admin' && freshUser.role !== 'owner' && !freshUser.organizationId) {
            logger.warn({
              msg: '[Auth] Removed non-owner admin session detected, invalidating',
              instance: cookiePrefix,
            });
            return null;
          }

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
