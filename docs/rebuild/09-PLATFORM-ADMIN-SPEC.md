# 09 — Platform Admin Specification

**Status:** Design, not yet implemented · **Written:** 2026-08-10 · Companion to [`07-SECURITY-COMPLIANCE-SPEC.md`](./07-SECURITY-COMPLIANCE-SPEC.md)

Specifies how the platform-operator surface at `/system` should be built, replacing the interim implementation in `src/app/actions/system-admin.ts` and `src/lib/system-auth.ts`.

## 1. Context — how we got here

The `/system` dashboard was built as a **temporary superuser tool for staging**, pending a proper super/system-user design. Operational demand moved it into production ahead of that design. It now carries real load, so this is not a defect report — it is a deliberate trade-off that has outlived its intended scope, and the job now is a migration path rather than a rewrite-under-pressure.

Two consequences shape everything below:

1. **It cannot simply be switched off.** It handles work with no other home today (§2).
2. **Its security model was scoped for staging**, where a shared password guarding non-production data is reasonable. In production, guarding cross-tenant data, it is not.

## 2. What it handles today

| Area | Surface | Notes |
| --- | --- | --- |
| Cross-org user administration | `getAllUsers`, `getUserDetail`, `getUserDeletePreview`, `deleteUserWithRelations` | Reads and irreversibly deletes any user in **any** organization, cascading to enrollments, quiz attempts, certificates and attestations |
| Standard-manual management | `/system/manual`, `POST /api/system/manual` | Uploads and indexes the RAG corpus used by course generation |
| Global video courses | `/system/video-courses/**`, `/api/system/video-courses/**` | Create, edit, sample, upload (incl. signed upload URLs) for catalogue content shared across tenants |
| Background job control | `/api/system/reminders/run`, `/api/system/notifications/run`, `/api/system/worker` | Manually triggers sweeps and worker runs |

That is a genuine platform-operations console. The target design keeps the capability and fixes how it is governed.

## 3. Current security properties

Assessed 2026-08-10. Recorded plainly so the migration can be prioritised.

| Property | Today | Finding |
| --- | --- | --- |
| Identity | **None.** One shared static `SYSTEM_ADMIN_PASSWORD`. No accounts, no per-person attribution | F-056 |
| Brute-force protection | **None.** `verifySystemPassword` has no rate limit and no lockout | F-056 (extend) |
| MFA | None, despite `src/lib/mfa.ts` already existing and being used for tenant users | F-056 |
| Session | HMAC-signed cookie whose payload is **only `{exp}`** — no subject, no session id, no nonce. A captured cookie is a replayable bearer token, and `logoutSystemAdmin` only clears the browser copy: the token stays valid for its full 4h TTL. **No revocation is possible.** | new |
| Signing key | Shares `NEXTAUTH_SECRET` with NextAuth *and* with MFA secret encryption. Rotation has wide blast radius | related to F-025 |
| Route protection | **Opt-in.** `/system` is not covered by the proxy/middleware matcher; each page and action calls `verifySystemAdminCookie` itself. A new page that forgets is open | F-013 class |
| CSRF posture | `sameSite: 'lax'`, `path: '/'`. Adequate for POST server actions, weaker than `strict` warrants for a superuser panel | new |
| Network restriction | None. Reachable from any IP | new |
| Audit | `system.auth.success`, `system.auth.failure`, `system.user.delete` added 2026-08-10. Manual-upload, video-course and job-trigger actions remain unaudited | F-094 (partial) |
| Tests | **None.** 650 lines including HMAC minting and the destructive delete path | F-096 |
| Emergency access procedure | None documented — HIPAA §164.312(a)(2)(ii) | F-056 |

## 4. Target design

### 4.1 Identity — a separate principal type

Platform operators are **not** tenant users and must not be modelled as one with a magic role. A tenant user with a `platform_admin` flag creates two hazards: a tenant-scoped query could accidentally return them, and a compromised tenant account becomes a privilege-escalation path.

```prisma
model PlatformAdmin {
  id            String    @id @default(uuid())
  email         String    @unique
  password      String                          // bcrypt, cost >= 12
  fullName      String    @map("full_name")
  status         PlatformAdminStatus @default(invited)
  mfaEnrolledAt DateTime? @map("mfa_enrolled_at")
  lastLoginAt   DateTime? @map("last_login_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  grants   PlatformAdminGrant[]
  sessions PlatformAdminSession[]

  @@map("platform_admins")
}

enum PlatformAdminStatus { invited active suspended }

/// Capability grants — least privilege instead of all-or-nothing.
model PlatformAdminGrant {
  id         String   @id @default(uuid())
  adminId    String   @map("admin_id")
  capability String                             // see §4.3
  grantedBy  String   @map("granted_by")
  grantedAt  DateTime @default(now()) @map("granted_at")
  expiresAt  DateTime? @map("expires_at")       // set for break-glass grants

  admin PlatformAdmin @relation(fields: [adminId], references: [id], onDelete: Cascade)

  @@unique([adminId, capability])
  @@map("platform_admin_grants")
}

/// Server-side sessions, so revocation is real.
model PlatformAdminSession {
  id         String   @id @default(uuid())
  adminId    String   @map("admin_id")
  createdAt  DateTime @default(now()) @map("created_at")
  expiresAt  DateTime @map("expires_at")
  lastSeenAt DateTime @map("last_seen_at")
  revokedAt  DateTime? @map("revoked_at")
  ip         String?
  userAgent  String?  @map("user_agent")

  admin PlatformAdmin @relation(fields: [adminId], references: [id], onDelete: Cascade)

  @@index([adminId, expiresAt])
  @@map("platform_admin_sessions")
}
```

### 4.2 Authentication

- Password (bcrypt, cost ≥ 12) **plus mandatory TOTP**. Reuse `src/lib/mfa.ts`; do not build a second MFA path. MFA is not optional for this surface — an operator without an enrolled factor stays `invited` and cannot authenticate.
- **Rate limit and per-account lockout** on the credential step, reusing `checkRateLimit`. Fail *closed* here specifically: unlike tenant login, availability of the operator console is not worth a brute-force window (this is the one place the F-024 fail-closed recommendation is unambiguous).
- Session cookie carries **only an opaque session id**. All state — subject, expiry, revocation — is server-side, so a stolen cookie can be killed. `sameSite: 'strict'`, `httpOnly`, `secure`, path-scoped as narrowly as the API layout allows.
- Idle timeout 30 min, absolute cap 4 h. `lastSeenAt` drives idle expiry.
- Sign session ids with a **dedicated secret** (`PLATFORM_ADMIN_SESSION_SECRET`), not `NEXTAUTH_SECRET`. Today one secret signs tenant sessions, this cookie, and derives the MFA encryption key; rotating it should not be an all-or-nothing event.

### 4.3 Authorisation — capabilities, not a god-mode flag

The single biggest reduction in blast radius. Most operator work is read-only or content management; only a fraction needs destructive power.

| Capability | Covers |
| --- | --- |
| `platform.user.read` | Cross-org user search and detail |
| `platform.user.delete` | Irreversible user deletion |
| `platform.manual.write` | Standard-manual upload and indexing |
| `platform.catalog.write` | Global video-course create/edit/upload |
| `platform.jobs.run` | Manual sweep and worker triggers |
| `platform.admin.manage` | Managing other platform admins and grants |

Default-deny, checked in one shared guard, mirroring `src/lib/rbac/permissions.ts` rather than inventing a parallel system.

### 4.4 Default-deny routing

Add `/system/**` and `/api/system/**` to the proxy matcher so **the framework denies by default**, instead of every new page remembering to check. This is the F-013 fix applied to the highest-privilege surface, and it is the single change most likely to prevent a future hole.

### 4.5 Destructive-action controls

`deleteUserWithRelations` destroys compliance history — enrollments, attempts, certificates, attestations — with no recovery path. Required controls:

1. **Soft-delete first.** Mark and exclude; hard-delete only after a cooling-off window via a scheduled job. This alone converts an unrecoverable mistake into a recoverable one.
2. **Typed confirmation** of the target's email, server-verified against the record.
3. **Second-approver requirement** for hard deletion, once ≥2 admins exist. Recorded as an approval row, not a checkbox.
4. **`auditCritical` inside the transaction** — already implemented.
5. **Preview must be exact.** `getUserDeletePreview` and the delete must derive counts from the same query, so the operator's decision matches the outcome.

### 4.6 Break-glass / emergency access

HIPAA §164.312(a)(2)(ii) requires a documented emergency-access procedure. Design:

- A time-boxed grant (`PlatformAdminGrant.expiresAt`, default 60 min) issued by any active admin, for a stated reason.
- Issuing one emits `platform.breakglass.granted` with the reason and target capability, and **alerts** (Phase 3 notification channel) — it should be socially impossible to use quietly.
- Auto-expires. No permanent elevation.

### 4.7 Audit and network

- Every action audited via `auditCritical`, with a real `actorId` — the whole point of §4.1. Extend beyond auth/delete to manual upload, catalogue writes and job triggers.
- Optional `PLATFORM_ADMIN_IP_ALLOWLIST`. Cheap and effective given a small, known operator group, but must not be the only control (offices change, VPNs fail).

## 5. Migration path

Ordered so each step is independently shippable and nothing goes dark. The console keeps working throughout.

| Step | Change | Breaks anything? |
| --- | --- | --- |
| 1 | **Interim hardening** (§6) — rate limit, `sameSite: strict`, revocable session id, IP allowlist, audit the remaining actions | No |
| 2 | Add the three models + migration. No behaviour change | No |
| 3 | Build account/invite/MFA-enrolment flow. Seed the first admin via a one-off script | No |
| 4 | Accept **either** auth mechanism, preferring accounts. Shared password becomes a fallback and emits `system.auth.legacy_password` on every use | No |
| 5 | Introduce capability checks, granting every existing admin all capabilities initially | No |
| 6 | Add `/system/**` to the proxy matcher | No, if step 4 is done |
| 7 | Watch for `system.auth.legacy_password` to reach zero, then **remove `SYSTEM_ADMIN_PASSWORD`** | Yes — deliberately, once evidence says nobody depends on it |
| 8 | Soft-delete, typed confirmation, second approver, break-glass | No |

Step 7's gate is evidence, not a date: the audit action added in step 4 is what tells you the fallback is unused.

## 6. Interim hardening — doable now, no new models

If the full design is weeks away, these are hours and remove the sharpest edges:

1. **Rate-limit + lock `verifySystemPassword`.** Currently unlimited attempts against one static password. Highest value per effort in this document.
2. **Put a session id in the cookie payload** and keep a server-side set of valid ids, so `logoutSystemAdmin` and a global "revoke all" actually work. A captured cookie is currently valid for its full TTL regardless of logout.
3. **`sameSite: 'strict'`.**
4. **Audit the remaining actions** — manual upload, catalogue writes, job triggers (F-094 is only partly closed).
5. **`PLATFORM_ADMIN_IP_ALLOWLIST`** if the operator set is stable.
6. **Rotate `SYSTEM_ADMIN_PASSWORD`** and confirm it is not shared through any channel that retains it.
7. **A first test file** covering the cookie's sign/verify/expire logic and that each action refuses without a session (F-096).

## 7. Acceptance criteria

- No shared credential grants platform access; every action attributes to a named admin.
- MFA cannot be skipped.
- An operator's session can be revoked and the revocation takes effect on the next request.
- A new `/system` page is denied by default without an explicit allow.
- User deletion is recoverable within a cooling-off window and requires a second approver.
- Emergency elevation is time-boxed, reasoned, alerted, and auto-expiring.
- Capability grants are per-admin and least-privilege; a catalogue editor cannot delete a user.
- Every action appears in `audit_logs` with a real `actorId`.

## 8. Open decisions

1. **Is a second operator account realistic soon?** The second-approver rule and break-glass alerting need ≥2 people. With one operator, §4.5.3 is deferred and §4.6 degrades to "audited and alerted" without a second party.
2. **Should job triggers move out entirely?** `reminders/run`, `notifications/run` and `worker` are operational rather than administrative. A CLI over SSH may be a better home than an HTTP surface, shrinking the console.
3. **Soft-delete semantics for a person.** Retaining a suspended user's compliance history conflicts with a deletion request; §4.5.1 needs a retention decision (see F-054, F-089).
4. **IP allowlist feasibility** — depends on whether operators have stable egress.
