# 07 — Security & Compliance Specification (HIPAA + SOC 2 Type II)

**Prerequisite:** [`01-TARGET-ARCHITECTURE.md`](./01-TARGET-ARCHITECTURE.md). This document specifies the controls the rebuilt system must implement to support a **HIPAA** and **SOC 2 Type II** posture. It distinguishes *code fixes*, *infra fixes*, and *policy/process artifacts* (the last are outside the codebase but listed so nothing is assumed done).

The split itself is a compliance win: it shrinks the HIPAA-covered boundary to `api` + `worker` + the data stores, and removes PHI, DB credentials, and AI keys from the browser-facing tier.

## 1. The compliance boundary after the split

```
Internet ──▶ Cloudflare (BAA) ──▶ web  [NO PHI · NO DB · NO secrets · NO AI keys]
                                    │ private network (mTLS)
                                    ▼
                        api ──▶ worker  [PHI · audit log · Stripe · AI egress]
                                    │
                        Postgres(enc) · Redis · Object store(enc)
                                    │ BAA egress
                                    ▼
                        Vertex AI · GCS  (BAA-covered only)
```

**Rule:** PHI lives only behind the `api`/`worker` boundary and in the encrypted stores. `web` never receives PHI it doesn't render for the owning user, holds no data-store credentials, and never calls Vertex/GCS/Stripe directly. *(Resolves the shared-trust-boundary root cause; supports F-008, F-025, F-003.)*

## 2. Tenant isolation (multi-layer)

The single biggest correctness risk today is that isolation is 100% application-enforced with no backstop (F-007), and two checks were already missed (F-009, F-010). Build three layers:

1. **Schema:** add `organizationId` to `Course` and `Enrollment`; composite indexes (doc 04 §6).
2. **App guard (primary):** a global `OrgScopeGuard` + `requireSameOrg(resource)` that resolves every id-bearing request's resource org and rejects mismatches by default. No endpoint returns a resource without passing it.
3. **Database RLS (defense-in-depth):** Postgres Row-Level Security on tenant tables keyed to a per-request `SET app.current_org = :orgId`, so a forgotten `where` clause still cannot leak across tenants.

Cross-org **negative tests** are mandatory (doc 03 §6): prove user A cannot read/write org B's staff, courses, enrollments, certificates, or exports. This permanently guards the IDOR class.

## 3. Access control & authentication (HIPAA §164.312(a))

- **Unique user IDs** — UUID PK + unique email (already). Per-session `sessionId` (already).
- **Automatic logoff** — sliding idle timeout `INACTIVITY_TIMEOUT_MINUTES` (already); enforce server-side in the guard.
- **RBAC** — extend beyond the current 2 roles (`admin`/`worker`) toward least privilege (auditor, manager) as the in-flight RBAC effort lands. *(Note: escalation-manager assignment is admin-only until that lands.)*
- **MFA** — enforce in the global guard for `mfaEnabled` users on **every** endpoint (not just page middleware — F-012); support an **org-level MFA-required** flag (`Organization.requireMfa` exists); ensure OAuth users can't bypass MFA (verify Entra conditional access or enforce app-side — F-012).
- **Brute-force** — rate-limit + per-account lockout on the credential path itself (F-033); Redis-backed, fail-closed (F-024).
- **Emergency access** — add a break-glass procedure with mandatory audit logging (HIPAA §164.312(a)(2)(ii), missing today).
- **System-admin** — replace the shared static password with real accounts + MFA and per-actor attribution (F-056).
- **Password reset invalidates sessions** — add a `passwordChangedAt`/`sessionVersion` claim checked in the guard (F-059).

## 4. Audit controls (HIPAA §164.312(b), SOC 2 CC7) — F-001

The system has **no audit log today**. Build an append-only `AuditLog` (doc 04 §2) written by an `AuditLogInterceptor` at the `api` boundary. Minimum recorded events:

- **Auth:** login success/failure, logout, MFA enroll/verify/disable, password reset, forced reset.
- **Authorization changes:** role change, org membership add/remove (staff invite/accept/remove), manager assignment.
- **PHI access:** certificate view/download, audit-report generate/download, staff profile view, document view/download, enrollment/quiz-result view.
- **Data export:** every export (scope, format, row count).
- **Billing:** checkout/swap/cancel/pause/resume, webhook-driven changes.
- **Admin/system actions.**

Each entry: actor, actor role, action, target type/id, org, IP, user-agent, timestamp, metadata. **Immutable** — no UPDATE/DELETE grants to the app DB role; shipped to durable, retained (≥6 yr) storage.

## 5. Data protection

- **Encryption at rest** (F-025) — managed encrypted Postgres (or encrypted volumes), MinIO SSE / GCS CMEK, encrypted backups. **Drop or encrypt `DocumentVersion.content`** (extracted document text sits in the DB today).
- **Encryption in transit** — public TLS at the edge; internal mTLS between `web`↔`api`↔`worker` and to Postgres/Redis/MinIO (F-025, doc 06 §2).
- **PHI minimization** (F-003) — scan the full document (not first 15k chars); prefer a local/DLP detector over sending raw text to an LLM; **store PHI entity types/offsets, never raw values**; gate the wizard path (F-002).
- **PII in logs** (F-067) — auto-redact emails/tokens via a logger serializer; never log tokenized links or raw addresses (today `email.ts:80-82` does both).
- **Integrity** (§164.312(c)) — keep the SHA document-version hashing; verify on read; audit deletions.

## 6. BAA / subprocessor management

| Subprocessor | Receives | BAA |
|--------------|----------|-----|
| Google Cloud (Vertex AI + GCS) | PHI (document text, files) | **Required** — execute GCP BAA; disable data-logging/abuse-retention on Vertex; keep PHI off the consumer Gemini SDK (forbidden import — F-003) |
| Cloudflare | All traffic (TLS terminates at edge) | **Required** — **Enterprise plan** (Free/Pro are not BAA-eligible; today's config implies Free/Pro — F-043) |
| SMTP provider (Zoho default) | Recipient PII; PHI only if message bodies carry it | **Required if any PHI** — verify or switch to a BAA provider |
| Microsoft Entra ID | Auth assertions (PII) | Covered by MS DPA (no separate BAA typically) |
| Stripe | Org email + IDs in metadata (PII, no PHI) | No BAA — keep PHI out of metadata (compliant today) |
| GitHub (CI/GHCR) | Source, images, secrets | No PHI — harden secret handling |

Maintain a subprocessor list + data-classification as a policy artifact (SOC 2 CC9.2).

## 7. Application-security controls to build in

- **Security headers** (F-019) — CSP, HSTS, X-Frame-Options/frame-ancestors, nosniff, Referrer-Policy at edge + `helmet` on `api`.
- **Rate limiting** (F-018, F-024) — Redis-backed, fail-closed; cover auth, **AI generation/grading** (per-user/org quotas + concurrency caps), export triggers, public verification, demo/enterprise forms.
- **Bot verification** (F-023) — hCaptcha/Turnstile server-verified on all unauthenticated POSTs (signup, demo, enterprise, join) — not integrated today despite being assumed.
- **Input validation** — global Zod pipe; every endpoint schema'd.
- **Output/error hygiene** — one error envelope; never leak internal messages (F-048).
- **Prompt-injection hardening** (F-049, F-050) — delimit untrusted document/RAG text; fix `String.replace` substitution; reconsider `BLOCK_NONE`.
- **Dependency management** (F-011, F-055) — migrate off `xlsx@0.18.5` (unpatched CVEs, no npm fix) to SheetJS CDN build / `exceljs`; track Quill XSS fix; add `npm audit`/Dependabot + secret-scanning to CI.
- **Webhook security** (F-014) — Stripe signature verified (already) + `event.id` dedup + 5xx-on-retryable.
- **Preserve verified-good controls:** parameterized SQL, DOMPurify on all HTML sinks, signed-URL media (no SSRF), secure cookie flags, CSPRNG tokens, dual-realm sessions — do not regress these in the rewrite.

## 8. SOC 2 operational controls (mostly infra + process)

- **Change management (CC8.1)** — CI with security gates + required review + branch protection (F-030); versioned migrations as one-shot jobs.
- **Availability (A1.2)** — no single-node SPOF; backups + tested restore; ≥2 replicas per service (F-004, doc 06 §8).
- **Monitoring (CC7.2)** — APM, uptime + queue + backup alerts (doc 06 §7).
- **Incident response (CC7.3/7.4)** — runbook, on-call, postmortems (policy artifacts).
- **Logical access (CC6)** — provisioning/deprovisioning: full staff deprovision (not just org-detach), user self-service deletion, access reviews (F-054).
- **Data retention/disposal (C1.2)** — retention schedule + scheduled purges (doc 04 §8).
- **Vendor management (CC9.2)** — the subprocessor list above.

## 9. Compliance status target (from → to)

| Control | Today | After rebuild |
|---------|-------|---------------|
| Audit trail | Missing (F-001) | Append-only `AuditLog` at API boundary, immutable, retained |
| PHI handling | Leaking (F-002, F-003) | Gated everywhere, full-doc scan, types-not-values, BAA-only egress |
| Backups | Missing (F-004) | Automated encrypted PITR + tested restore |
| Encryption at rest | Missing (F-025) | Managed encrypted DB + SSE/CMEK storage + encrypted backups |
| Tenant isolation | App-only, breached (F-007/09/10) | Schema + guard + RLS, negative-tested |
| MFA enforcement | Page-only, bypassable (F-012) | Enforced in global guard, org-level required flag |
| Availability/monitoring | Single node, none (F-004/030) | HA, APM, alerting, IR runbook |
| Secrets | Blob + some in VCS (F-060/008) | Secrets manager, rotation, none in VCS, no `NEXT_PUBLIC_` secret |
