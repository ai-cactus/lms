# Data Classification & Egress Map

**System:** Theraptly LMS · **Compiled:** 2026-08-09 · Companion to [`AUDIT-2026-08.md`](./AUDIT-2026-08.md)

The product is positioned as **non-PHI**: the scanner exists to keep PHI *out*, not to process it. This document exists so that position is auditable rather than asserted — it names every field that could plausibly carry personal data, and every path by which data leaves the trust boundary.

Classification levels used below:

| Level | Meaning |
| --- | --- |
| **P0** | Not sensitive. Product config, taxonomy, public content. |
| **P1** | Business PII. Names, work emails, org/role/facility data. Real but ordinary. |
| **P2** | Free-text or file content that *could* carry PHI if a user pasted or uploaded it. This is where the scanner and the ledger apply. |
| **P3** | Secrets and credentials. Never logged, never returned to a client. |

---

## 1. Where personal data lives

### P3 — secrets

| Location | Notes |
| --- | --- |
| `User.password` | bcrypt. Never selected into a session or response. |
| `MfaFactor.secret`, OTP payloads | AES-256-GCM at rest (`src/lib/mfa.ts`). **Key is derived from `NEXTAUTH_SECRET`** rather than a dedicated rotatable key — recorded as a gap. |
| `MfaRecoveryCode` | Hashed. |
| `VerificationToken.token` / `.password`, `Invite.token` | CSPRNG tokens; the pending-signup password is hashed. Purged by `runRetentionPurge`. |

### P1 — business PII

| Location | Notes |
| --- | --- |
| `User.email`, `.firstName`, `.lastName` | Email must pass through `maskEmail` before any log field. |
| `OrganizationUser` role/facility links | Tenancy identity; `organizationUserId` is the scoping key for org-owned data. |
| `Facility.address`, `.phone`, `Organization.primaryEmail` | Business contact data, not personal health data. |
| `Enrollment.attestationSignature`, `.attestedAt`, `.attestationRole` | Compliance attestation — an identity claim, retained deliberately. |
| `Certificate`, `QuizAttempt.answers`, `Enrollment.score` | Training performance tied to an individual. Appears in auditor exports. |
| `EmailMessage.toEmail`, delivery status | Recipient addresses + outcomes. |
| `AuditLog.actorId`, `.ip`, `.userAgent`, `.metadata` | Retained ≥6 years, excluded from `runRetentionPurge`. |

### P2 — content that could carry PHI

This is the category that matters. Everything here is user-supplied free text or file content.

| Location | Scanned? | Notes |
| --- | --- | --- |
| `DocumentVersion.content` | **Yes** | Extracted document text. The only production writer is `uploadDocument`, which blocks on `hasPHI` and `scanFailed` **before** persisting. Stored in plaintext — F-025's "encrypt or drop" decision is still open. |
| `Document.filename`, `.originalName` | No | A filename can itself carry a name (`john-doe-intake.pdf`). Stored verbatim for accepted documents; the `phi_decisions` ledger deliberately stores only a hash. |
| `Lesson.content`, `.slideContent` | **No** | AI-generated from scanned documents *or* typed directly into the editor. The editor path has no scan — **F-089, open, needs a product decision**. |
| `Quiz`/`Question.text`, `.correctAnswer` | No | Generated or authored. Reaches Vertex via the explanation fallback. |
| `MappingEvidence.snippet`, `.justification` | Inherited | Verbatim excerpts of already-scanned document text. |
| `ManualChunk.content` + `embedding` | No | Standard-manual RAG corpus, admin-curated reference material. |
| `PhiReport.detectedEntities` | n/a | **Value-free by construction**: type + offsets + confidence only. |
| `PhiDecision.entities`, `contentHash`, `filenameHash` | n/a | Value-free; text and filename are hashed, never stored. |
| `Job.payload` | No | Pipeline state and error detail. Sanitised at the API boundary before reaching a client. |

---

## 2. Egress paths — where data leaves the boundary

Every path that sends P2 content to a third party, and what gates it.

| Path | Destination | BAA | Gate |
| --- | --- | --- | --- |
| `uploadDocument` → `scanText` | Vertex AI | ✅ Google Cloud | Local regex pre-pass first (zero network for SSN/email/phone), then chunked full-document AI scan. Fail-closed. |
| `generateCourseAndQuizV46` (fresh upload) | Vertex AI | ✅ | `scanText` blocks **before the Job is created**, so no scheduled work sees unscanned text. |
| `generateCourseAndQuizV46` (stored doc) | Vertex AI | ✅ | Transitively gated — reads `DocumentVersion.content`, written only post-scan. |
| `analyzeStoredDocument` | Vertex AI | ✅ | Transitively gated, same invariant. Auth + org scope + rate limit. |
| `generateSingleQuestion` | Vertex AI | ✅ | Auth + **org scope** + rate limit. Content is lesson text — **ungated for editor-authored text (F-089)**. |
| Quiz-submit explanation fallback | Vertex AI | ✅ | Sends question text, correct answer and options only — **never** the worker's submitted answers. Rate limited, degrades to score-only. |
| `retrieveRelevantChunks` → `generateEmbedding` | Vertex AI | ✅ | Query text derived from already-scanned source. |
| Document / video / certificate objects | GCS (primary), MinIO (fallback) | ✅ GCS | Signed-URL access; no public buckets. MinIO is `MINIO_USE_SSL=false` internally — open item. |
| All HTTP traffic | Cloudflare (TLS terminates at edge) | ⚠️ Requires Enterprise | Current plan is not BAA-eligible (F-043). Acceptable under the non-PHI position; would need addressing if that changes. |
| Transactional email | Zoho SMTP (prod), MailHog (dev/CI) | ⚠️ Unverified | Recipient PII + tokenised links. Bodies must not carry P2 content. |
| Billing | Stripe | ❌ None needed | Org email + plan metadata only. **Keep P2 out of Stripe metadata.** |
| Auth | Microsoft Entra ID | Covered by MS DPA | Identity assertions. |
| Source, images, CI secrets | GitHub / GHCR | ❌ | Repo and packages both **private** as of 2026-08-09. |

### Forbidden egress

`generativelanguage.googleapis.com` and the `@google/generative-ai` / `@google/genai` SDKs are the **consumer** Gemini surface and carry **no BAA**. Enforced at lint time (`eslint.config.mjs`, `no-restricted-imports` + `no-restricted-syntax`) across `src/` and `scripts/`, after a dev script was found POSTing document text there (F-085). The package is also removed from `package.json` entirely.

---

## 3. The invariant, stated plainly

> **No document content reaches an AI provider without a recorded scan decision.**

Enforced by three things working together, not one:

1. **The gate** — `scanText`, fail-closed, runs before any generation call on every ingress path.
2. **The transitive rule** — anything reading `DocumentVersion.content` inherits the gate, because `uploadDocument` is the sole production writer and blocks before persisting. *This is the fragility that produced F-002 and F-082: it is an invariant of the call graph, not a local check.* Any new path feeding document text to an AI call must either scan locally or read from a column with the same guarantee.
3. **The ledger** — `phi_decisions` records every decision, including rejections. `buildPhiEvidenceReport` verifies the invariant rather than assuming it: `integrity.acceptedWithoutDecision` must be 0, and `attestable` is false whenever the ledger does not cover the whole period being claimed.

### Known gaps in the invariant

| Gap | Finding |
| --- | --- |
| Editor-authored lesson content and client-supplied `options.context` are never scanned | **F-089** — open, product decision |
| `DocumentVersion.content` is stored in plaintext | F-025 — open, ops |
| Free-text names/addresses still require the AI pass; only SSN/email/phone are caught locally with zero transmission | Noted in `phiScanner.ts`; a local NER/DLP model would close it |
| Chunk boundaries do not overlap, so a value straddling a 15k boundary could evade the AI pass | Noted in `phiScanner.ts`; the local pre-pass runs over the full text and bounds the risk |
| Vertex data-logging / abuse-retention settings not evidenced in-repo | Verify in the GCP console and record |
