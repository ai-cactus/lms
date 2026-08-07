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
import { enrollUserForRoleTargets } from '@/lib/enrollment/role-targets';
import { enrollInviteCourses } from '@/lib/enrollment/invite-courses';
import {
  createMembership,
  getActiveMembership,
  recordMembershipLogin,
  resolveActiveMembership,
  type MembershipResolution,
  type MembershipSummary,
} from '@/lib/auth/membership';

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

/** Session claims derived from a membership resolution. */
interface ResolvedClaims {
  role: Role;
  organizationId: string | null;
  organizationUserId: string | null;
}

/**
 * The role a session carries while its owner has no membership yet. A user with
 * ZERO membership rows has never joined an organization: on the admin portal
 * that is a prospective founder heading into onboarding, on the worker portal a
 * self-serve learner heading into join-by-code. Both reproduce exactly the
 * state such an account held before memberships existed (a role, no
 * organization), keeping the signup → onboarding paths unchanged.
 *
 * Not to be confused with the `revoked` resolution (memberships exist but all
 * are deactivated), which denies login instead.
 */
function provisionalRoleFor(cookiePrefix: 'admin' | 'worker'): Role {
  return cookiePrefix === 'worker' ? DEFAULT_SELF_SERVE_WORKER_ROLE : 'owner';
}

function claimsFor(
  membership: MembershipSummary | null,
  cookiePrefix: 'admin' | 'worker',
): ResolvedClaims {
  return membership
    ? {
        role: membership.role,
        organizationId: membership.organizationId,
        organizationUserId: membership.organizationUserId,
      }
    : {
        role: provisionalRoleFor(cookiePrefix),
        organizationId: null,
        organizationUserId: null,
      };
}

/**
 * Pick the membership a resolution activates. On `choice` the org picker lets
 * the user switch afterwards, but the session must always be scoped to a real
 * membership, so the first (oldest-joined, deterministic) one is provisionally
 * activated rather than leaving the session org-less.
 */
function activeMembershipOf(resolution: MembershipResolution): MembershipSummary | null {
  if (resolution.kind === 'resolved') return resolution.membership;
  if (resolution.kind === 'choice') return resolution.memberships[0];
  return null;
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

          const resolution = await resolveActiveMembership(user.id);

          // ISSUE 2: every membership this account held has been deactivated —
          // it was removed from its organization(s). Deny before verifying the
          // password. A user with NO membership rows at all is a prospective
          // founder mid-onboarding and is deliberately NOT caught here.
          if (resolution.kind === 'revoked') {
            logger.warn({
              msg: 'Auth login failed: removed from organization',
              instance: cookiePrefix,
            });
            await audit({
              action: 'auth.login.failure',
              actorId: user.id,
              ...clientCtx,
              metadata: { reason: 'removed_from_org', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

          const membership = activeMembershipOf(resolution);
          const claims = claimsFor(membership, cookiePrefix);

          if (!allowedRoles.includes(claims.role)) {
            logger.warn({
              msg: 'Auth login failed: role mismatch',
              role: claims.role,
              allowed: allowedRoles.join(','),
              instance: cookiePrefix,
            });
            await audit({
              action: 'auth.login.failure',
              actorId: user.id,
              actorRole: claims.role,
              organizationId: claims.organizationId ?? undefined,
              ...clientCtx,
              metadata: { reason: 'role_mismatch', instance: cookiePrefix, email: maskedEmail },
            });
            return null;
          }

          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            logger.warn({ msg: 'Auth login failed: invalid password', instance: cookiePrefix });
            await audit({
              action: 'auth.login.failure',
              actorId: user.id,
              actorRole: claims.role,
              organizationId: claims.organizationId ?? undefined,
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
            actorRole: claims.role,
            organizationId: claims.organizationId ?? undefined,
            ...clientCtx,
            metadata: { instance: cookiePrefix, mfaEnabled: user.mfaEnabled },
          });

          // Only a DEFINITE activation may be remembered. On `choice` the
          // membership above is the provisional first-joined default
          // `activeMembershipOf` falls back to so this JWT has a target;
          // persisting it would make `resolveActiveMembership` read it back as a
          // genuine pick and suppress the org picker on every later login. The
          // remembered org is stamped only by an explicit pick — see
          // `switchOrganization` in app/actions/session-bridge.ts.
          if (membership && resolution.kind === 'resolved') {
            recordMembershipLogin(user.id, membership);
          }

          return {
            id: user.id,
            email: user.email,
            ...claims,
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
          const email = user.email!;
          let dbUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, fullName: true },
          });

          const pendingInvite = await prisma.invite.findFirst({
            where: { email, status: 'pending' },
            orderBy: { createdAt: 'desc' },
          });

          const inviteRole: Role | null = pendingInvite
            ? ALL_ROLES.includes(pendingInvite.role as Role)
              ? (pendingInvite.role as Role)
              : DEFAULT_SELF_SERVE_WORKER_ROLE
            : null;

          const isNewUser = !dbUser;
          if (!dbUser) {
            const randomPassword = await bcrypt.hash(
              crypto.randomUUID() + Date.now().toString(),
              BCRYPT_COST,
            );

            const oauthName = user.name || '';
            const nameParts = oauthName.split(' ');

            dbUser = await prisma.user.create({
              data: {
                email,
                password: randomPassword,
                authProvider: 'microsoft-entra-id',
                emailVerified: true, // Trust OAuth provider email verification
                firstName: nameParts[0] || '',
                lastName: nameParts.slice(1).join(' ') || '',
                fullName: oauthName || email,
              },
              select: { id: true, fullName: true },
            });

            logger.info({
              msg: '[auth] OAuth: created new identity',
              email: maskEmail(email),
              viaInvite: !!pendingInvite,
            });

            // F-001: OAuth-originated signup.
            await audit({
              action: 'auth.signup',
              actorId: dbUser.id,
              actorRole: inviteRole ?? undefined,
              organizationId: pendingInvite?.organizationId,
              metadata: {
                provider: 'microsoft-entra-id',
                viaInvite: !!pendingInvite,
                email: maskEmail(email),
              },
            });
          }

          // A pending invite is consumed whenever the invitee is not already a
          // member of that organization — for a brand-new identity as well as an
          // existing one joining an additional org.
          let invitedMembership: MembershipSummary | null = null;
          if (pendingInvite && inviteRole) {
            const existing = await getActiveMembership(dbUser.id, pendingInvite.organizationId);
            if (!existing) {
              logger.info({
                msg: '[auth] OAuth: accepting pending invite',
                email: maskEmail(email),
                orgId: pendingInvite.organizationId,
              });

              invitedMembership = await createMembership({
                userId: dbUser.id,
                organizationId: pendingInvite.organizationId,
                facilityId: pendingInvite.facilityId,
                role: inviteRole,
              });

              await prisma.invite.update({
                where: { id: pendingInvite.id },
                data: { status: 'accepted' },
              });

              // F-001: OAuth user consuming a pending invite.
              await audit({
                action: 'auth.invite.accept',
                actorId: dbUser.id,
                actorRole: inviteRole,
                organizationId: pendingInvite.organizationId,
                targetType: 'invite',
                targetId: pendingInvite.id,
                metadata: { provider: 'microsoft-entra-id', email: maskEmail(email) },
              });

              // Live auto-enroll: the new membership must pick up its role's
              // active role-target assignments, then materialise any courses
              // parked on the accepted invite. Neither throws.
              await enrollUserForRoleTargets(
                invitedMembership.organizationUserId,
                invitedMembership.organizationId,
              );
              await enrollInviteCourses(invitedMembership.organizationUserId, pendingInvite.id);
            }
          }

          const resolution = await resolveActiveMembership(dbUser.id);

          // ISSUE 2: every membership was deactivated — access removed.
          if (resolution.kind === 'revoked') {
            logger.warn({
              msg: '[auth] OAuth: removed member denied',
              email: maskEmail(email),
            });
            return `${config.pages?.signIn}?error=AccessRevoked`;
          }

          const membership = invitedMembership ?? activeMembershipOf(resolution);
          const claims = claimsFor(membership, cookiePrefix);

          // A brand-new identity with no invite has no membership yet and is
          // heading into onboarding; every other session must land on the portal
          // that matches its resolved role.
          if (membership && !allowedRoles.includes(claims.role)) {
            logger.warn({
              msg: '[auth] OAuth: role mismatch, routing to correct instance',
              expected: allowedRoles.join(','),
              got: claims.role,
            });
            if (WORKER_ROLES.includes(claims.role))
              return '/api/auth-worker/signin/microsoft-entra-id?callbackUrl=/worker';
            if (ADMIN_ROLES.includes(claims.role))
              return '/api/auth/signin/microsoft-entra-id?callbackUrl=/dashboard';
            return `${config.pages?.signIn}?error=AccessDenied`;
          }

          if (isNewUser) {
            logger.info({ msg: '[auth] OAuth: new identity, continuing for onboarding' });
          }

          user.id = dbUser.id;
          user.organizationId = claims.organizationId;
          user.organizationUserId = claims.organizationUserId;
          user.role = claims.role;
          user.name = dbUser.fullName || user.name || email;

          // Remember the org only for a definite activation: an invite the user
          // explicitly accepted, or a resolution that needed no picker. A
          // `choice` resolution's provisional default must NOT be persisted —
          // see the matching guard in the credentials provider above.
          if (membership && (invitedMembership !== null || resolution.kind === 'resolved')) {
            recordMembershipLogin(dbUser.id, membership);
          }
          // OAuth users bypass MFA — Microsoft Entra ID has its own MFA policies
          (user as User & { mfaVerified?: boolean }).mfaVerified = true;

          // F-001: OAuth login success (role gate already passed above).
          await audit({
            action: 'auth.login.success',
            actorId: dbUser.id,
            actorRole: claims.role,
            organizationId: claims.organizationId ?? undefined,
            metadata: {
              provider: 'microsoft-entra-id',
              instance: cookiePrefix,
              email: maskEmail(email),
            },
          });
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
          token.organizationUserId = user.organizationUserId ?? null;
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
          let freshUser;
          let membership: MembershipSummary | null = null;
          try {
            freshUser = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: {
                id: true,
                fullName: true,
                mfaEnabled: true,
                mfaVerifiedAt: true,
                passwordResetRequired: true,
                sessionVersion: true,
                authProvider: true,
              },
            });
            // Re-check the ACTIVE membership itself, not just the identity: a
            // membership deactivated (or re-roled) since the token was minted
            // must take effect on the next decode.
            if (freshUser && token.organizationId) {
              membership = await getActiveMembership(freshUser.id, token.organizationId as string);
            }
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

          // The session was scoped to an organization the user is no longer an
          // active member of — invalidate rather than silently downgrading it to
          // an org-less session.
          if (token.organizationId && !membership) {
            logger.warn({
              msg: '[Auth] Session membership revoked, invalidating',
              instance: cookiePrefix,
            });
            return null;
          }

          const claims = claimsFor(membership, cookiePrefix);
          if (!sessionAllowedRoles.includes(claims.role)) return null; // Role no longer permitted on this instance — invalidate

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

          token.role = claims.role;
          token.organizationId = claims.organizationId;
          token.organizationUserId = claims.organizationUserId;
          token.name = freshUser.fullName || token.email || 'User';
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
          session.user.organizationUserId = token.organizationUserId as string | null;
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
