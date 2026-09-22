# Security Infrastructure Runbook

**Written:** 2026-08-10 · **Updated:** 2026-09-22 · Executable companion to [`deployment.md`](./deployment.md) §4 and [`analysis/AUDIT-2026-08.md`](./analysis/AUDIT-2026-08.md)

This is the **single ops procedure** for the infrastructure-hardening items. It absorbs what the local execution log (`docs/local/RUNBOOK.md` items 9–12) recorded. For what to do next on the release/ops track, start at `docs/local/OPEN-ISSUES.md` → REL-01.

> **Production backups are running (verified 2026-09-22, §3). A recent restore and the monitoring configuration are unconfirmed — see OPEN-ISSUES RISK-08.** Nothing below asserts that monitoring is running on the VM.

`deployment.md` §4 lists *what* is outstanding. This is *how*, in what order, and how to know each step worked. Everything here needs VM, cloud-console or GitHub-settings access, so none of it could be done in the code work — it is deliberately separated rather than left implied.

## What has changed since §4 was written

Two items on that checklist are now partly done, so start from here rather than there:

- **Monitoring/alerting** — built. An OTel Collector ships container logs to Cloud Logging, host metrics feed disk/memory alerts, and there are eight alert policies plus an uptime check with a content matcher. Whether it is applied: status unconfirmed — records conflict, see OPEN-ISSUES RISK-08. See §1 and [`monitoring.md`](./monitoring.md).
- **Incident response** — still absent, and still a policy artefact rather than engineering. Out of scope for engineering readiness, but note the alerts now route somewhere, so "who responds" has become the binding constraint rather than "would we know".

## Ordering, and why it is this order

```
1. Apply monitoring        ── cheap; without it you are blind
2. lms_app DB role         ── unblocks F-007; makes REVOKE real
3. Backups + tested restore ── MUST precede any data migration
4. Encryption at rest      ── needs 3 (never migrate data you cannot restore)
5. TLS in transit
6. Cloudflare follow-ups   ── DONE (kept as record)
7. Split staging/prod creds
8. Secrets manager
9. Single-VM SPOF          ── staging stays co-resident by decision (§9)
```

Two hard dependencies, both learned the hard way:

**Backups before encryption-at-rest.** Encrypting a volume or migrating to a managed database moves every byte you own. Doing that with no restore path is how a hardening project becomes an outage. Nightly production backups are running (verified 2026-09-22), but a recent dump has not been restore-tested — see OPEN-ISSUES RISK-08 (F-004).

**`lms_app` role before RLS.** Postgres RLS is bypassed by superusers and table owners. The app connects as `postgres` (F-093), so adding RLS policies first produces something that *looks* like a tenant-isolation backstop and enforces nothing — the exact false assurance this programme has been removing.

---

## 1. Apply the monitoring configuration

**Why:** without it there is no uptime check, no alerting and no log retention. The 2026-08-04 hijack served a phishing redirect for four hours and was found by accident. This is the cheapest risk reduction available.

**Status:** unconfirmed — records conflict, see OPEN-ISSUES RISK-08. PR #503 (`apply.sh` survives its first run and every re-run) merged 2026-08-18.

**Do:** follow [`infra/gcp/README.md`](../infra/gcp/README.md) — service accounts (one per environment), notification channel, uptime check, eight alert policies, log-based metrics, retention. Then place the collector keys on the VM and redeploy so the `otel-collector` service starts.

```bash
./infra/gcp/apply.sh production admin@theraptly.com --with-uptime
./infra/gcp/apply.sh staging    admin@theraptly.com
```

- **Run it from a workstation as a human with `roles/monitoring.editor`, never on the VM.** On the VM `gcloud` authenticates as the application's service account, which has (and must not be given) monitoring rights — whoever compromises the VM could otherwise delete the alerts meant to detect it.
- Idempotent by display name, so it is safe to re-run after a partial failure. The notification channel is created first because the policies reference its ID.
- **Redeploy the collector before trusting the disk/memory alerts.** Three inert-by-construction defects were fixed before applying (2026-08-13/14), all of the same shape — valid config that can never fire: filters written against `jsonPayload.*` (corrected to `labels.*`, `e1d73ec`); `system.filesystem.utilization` / `system.memory.utilization` are optional hostmetrics that `infra/otel/collector-config.yaml` now enables explicitly; and the memory alert pins `state="used"` (with `REDUCE_MAX` across states, a host with plenty of *free* memory would have fired). `exclude_fs_types` keeps squashfs/tmpfs mounts from lighting the disk alert permanently. `apply.sh` prints a `time-series list` check — empty output means the new collector config is not live yet.
- Once backups run, add the alert that matters most for them: the **age** of the `_last_success` object in the backup bucket (see §3), never the job's exit status.

**Verify:** restart staging and confirm the boot line reaches Cloud Logging within a minute; break the staging health payload and confirm the uptime check goes red; trigger one alert end-to-end and confirm the notification actually arrives. An alert policy with an unverified channel is decoration.

**Cost:** roughly $0–20/month at this log volume. Uptime checks and the first metrics are effectively free.

**Risk:** low. The collector is additive and memory-capped; if it fails, the app is unaffected.

---

## 2. A non-superuser database role (F-093)

**Why:** the app authenticates as `postgres`, a superuser. Three consequences: any SQL injection reaching the database runs unrestricted; `REVOKE` is inert, so grant-based controls are theatre; and **RLS will not engage**, which blocks F-007 entirely.

**Do:**

```sql
-- As a superuser, once per environment.
CREATE ROLE lms_app LOGIN PASSWORD '<generated>';

GRANT CONNECT ON DATABASE lms_production TO lms_app;
GRANT USAGE ON SCHEMA public TO lms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lms_app;

-- Future tables created by migrations inherit these.
-- ⚠️ Only for objects created by the role running this block. If migrations run
-- as a separate role (lms_migrate), use `ALTER DEFAULT PRIVILEGES FOR ROLE lms_migrate …`
-- instead — see the note below.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lms_app;

-- The append-only ledgers. The trigger already blocks these regardless of role;
-- this makes the grant layer agree with the trigger.
REVOKE UPDATE, DELETE ON audit_logs, phi_decisions FROM lms_app;
```

Then point the app's `DATABASE_URL` at `lms_app` and keep a **separate** DDL-capable URL for migrations — `prisma migrate deploy` needs rights the app must not have.

**Two-role world — use `FOR ROLE`.** `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` only covers objects created by the *executing* role. When migrations run as `lms_migrate`, every table a future migration adds would otherwise be unreadable by `lms_app` — a delayed failure that appears days after the grants look correct. On Cloud SQL (PG16) the creating role also cannot `SET ROLE` to or grant for these roles until it runs `GRANT <role> TO CURRENT_USER`. The corrected, tested block is `docs/local/cloudsql-roles.sql`.

**Where migrations run (shipped 2026-08-14, #473 + #475).** Migrations no longer run in the container entrypoint. The deploy workflow runs a one-shot `migrate` service (`profiles: ['tools']`, `docker compose --profile tools run --rm migrate`) between bringing up the databases and `up -d`, so a container restart cannot alter the schema. That service reads `MIGRATE_DATABASE_URL` and falls back to `DATABASE_URL`, so the change is behaviour-preserving until the role split is actually made. What remains is the role work itself: create the roles, apply the grants above, set `MIGRATE_DATABASE_URL` in the environment secret, then repoint `DATABASE_URL`. (There is no `directUrl` in `prisma/schema.prisma`; `prisma.config.ts` uses one URL.)

**Relationship to Cloud SQL.** Production is planned to move to Cloud SQL (decided 2026-08-14, see §4), where `lms_migrate` / `lms_app` have already been created in SQL with least privilege verified — see `docs/local/plan-cloudsql-production.md` and `docs/local/cloudsql-roles.sql`. Cloud SQL has no true superuser, which solves the "app connects as `postgres`" half by construction. Doing this on the VM database is only needed if the Cloud SQL move is abandoned.

**Verify:**

```sql
-- As lms_app: must fail.
CREATE TABLE probe (id int);
UPDATE audit_logs SET action = 'x' WHERE false;
-- As lms_app: must succeed.
SELECT count(*) FROM users;
```

Then run one full user journey (login → course → quiz → certificate) against the new role. Prisma surfaces missing grants as runtime errors, not startup errors, so exercise the app rather than trusting a successful boot.

**Cost:** none. Half a day of care.

**Risk:** medium — a missed grant breaks a feature at runtime. Do staging first and leave it a week. Rollback is a one-line `DATABASE_URL` revert, so keep the superuser credential until you are confident.

---

## 3. Backups and a tested restore (F-004)

**Why:** every byte lives on one VM's bind mounts. Without an off-host copy, a disk-full event, a corrupting `docker compose down -v`, or a failed disk is unrecoverable, including the six-year audit trail.

**Status (verified 2026-09-22):** production backups are running — `lms-backup@production.timer` is active and fires nightly (~02:37 UTC); `gs://theraptly-lms-backups-production/` holds Postgres dumps and Redis RDBs from 2026-08-18 onward, and `_last_success` read `20260922T023717Z`. Staging has no backup timer. **Not yet verified:** a restore of a recent dump (the Verify steps below) and an alert on a stale `_last_success` — see OPEN-ISSUES RISK-08.

**Decisions (2026-08-14):**

- **Phase 1 — nightly logical dump to GCS**, built in [`infra/backup/`](../infra/backup/README.md): `pg-backup.sh` (`pg_dump -Fc` via `docker exec`, disk precheck, `pg_restore --list` integrity check, inflight→final upload, `_last_success` heartbeat), `redis-backup.sh` (`BGSAVE` + off-host copy for the BullMQ queues), `restore-verify.sh`, and a per-environment systemd timer at 02:30 UTC (`Persistent=true`, `OnFailure=`). RPO is "since last night".
- **Phase 2 — pgBackRest / WAL archiving: cancelled.** Replaced by the Cloud SQL decision (§4): managed PITR gives continuous WAL archiving without a custom database image or an `archive_mode` restart. If the Cloud SQL move is abandoned, Phase 2 comes back.
- **Phase 1 survives the Cloud SQL move.** Cloud SQL backups live in the same project, and so the same blast radius, as what they protect; the GCS dump is an independent copy with its own scoped identity. It needs one change after cutover: `docker exec` becomes a networked `pg_dump`.
- **Google-managed encryption**, not a pgBackRest passphrase or CMEK — no key to lose.
- **35 days of backups does not satisfy the six-year audit obligation.** That is carried by `audit_logs` retention and the `lms-audit` log bucket (2200 days). Backups are for recovery, not archival.

**Do** (full text in [`infra/backup/README.md`](../infra/backup/README.md)):

1. Create the bucket in a **different region** from the VM (us-central1), with object versioning and a 35-day lifecycle rule.
2. Create `lms-backup-<env>` and grant `roles/storage.objectUser` **on that bucket only** — never the VM's service account, which holds broad project rights.
3. Place the key at `/home/deploy/secrets/backup-sa-<env>.json`, mode `0400`, owner `deploy:deploy`.
4. Install and enable `lms-backup@<env>.timer`, then run it once immediately — don't wait for 02:30.

**Verify — this is the deliverable, not the backup:**

1. Restore last night's backup into a *scratch* Postgres instance.
2. Point a local app build at it and log in.
3. Confirm row counts on `users`, `enrollments`, `audit_logs`, `phi_decisions`.
4. Do a PITR to a timestamp mid-yesterday and confirm you get the older state.
5. Write down how long steps 1–4 took, with the date, **here**. That number is your RTO; until it is measured you do not have one.

`restore-verify.sh` automates steps 1 and 3 (throwaway container, row counts, password-hash count, timing). Step 4 applies only once PITR exists (Cloud SQL). A local rehearsal on 2026-08-14 against the real `pgvector/pgvector:pg16` image passed every leg except the GCS upload, which needs the real bucket and key. A figure of "RTO (restore only): 7s" is recorded in the local execution log, but whether it came from the VM is part of RISK-08.

Re-run quarterly. An untested backup is a belief, not a control.

**Cost:** GCS storage for a few hundred GB with versioning is single-digit to low-tens of dollars monthly. The real cost is the half-day to set up and the half-day to test.

**Risk:** low to set up (read-only from the primary's perspective), and it is the prerequisite for everything in §4.

---

## 4. Encryption at rest (F-025)

**Why:** HIPAA §164.312(a)(2)(iv). Plain `pgvector/pgvector:pg16` on host bind mounts, MinIO without SSE, no CMEK. Even under the non-PHI product position, customer staff PII, attestation signatures and quiz history sit unencrypted on a disk you do not physically control.

**Do not start this before §3 is verified.**

Two routes:

*Option A — encrypt in place.* LUKS on the data volume, or migrate the bind mounts onto an encrypted volume. Cheapest, keeps the topology, but you own key management and the unlock-on-boot problem.

*Option B — managed Postgres (Cloud SQL).* Encryption at rest and PITR come as defaults, and it deletes §3's ongoing maintenance and §9's HA problem too. Costs real money (a small HA instance is roughly $50–150/month at this scale) and is a migration project. It also pairs naturally with the CMEK story for GCS.

**Decided 2026-08-14: Option B, for production only.** Cloud SQL for PostgreSQL 16, single-zone (`us-central1-c`) to start, private IP, TLS, PITR, deletion protection, Google-managed encryption; cutover by a short `pg_dump`/`pg_restore` maintenance window. Staging stays containerized on the VM. The instance and roles exist; the cutover itself is outstanding — design in `docs/local/plan-cloudsql-production.md`, sequence and traps in `docs/local/NEXT-hardening-release-cutover.md` §8C.

Also decide `DocumentVersion.content` — extracted document plaintext currently sits in a column. Either encrypt it or drop it and re-derive from object storage on read. This has been open since the 2026-07 audit and needs a product call on the latency trade-off, not just an infra one.

**Verify:** confirm the volume is encrypted (`cryptsetup status`) or that the managed instance reports encryption; confirm a fresh backup restores; confirm MinIO/GCS objects report SSE/CMEK.

---

## 5. Encryption in transit, internally

**Why:** `sslmode` appears nowhere; `MINIO_USE_SSL` is `false` in staging *and* production; Redis is plaintext-with-password. Defensible while everything shares one host and traffic never leaves `lo`/the bridge — and a §164.312(e) gap the moment anything splits across machines, which the Cloud SQL move (§4) does.

**Do:** add `?sslmode=require` to `DATABASE_URL` (and `verify-full` with a CA once on a managed instance); enable MinIO TLS or move object storage fully to GCS; enable Redis TLS. Sequence this *before* the Cloud SQL cutover, not after (`sslmode=verify-full` with the instance's CA).

**Verify:** `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();` returns true from the app's connection.

---

## 6. Cloudflare incident follow-ups — ✅ DONE (2026-08-10)

Resolved. Kept here as the record of what was closed, because the entry vector matters for future review.

INC-2026-08-04-01 was a zone hijack: the production domain served a 301 to a phishing site for roughly four hours. Root cause was a **password-only login on a shared Gmail identity** with no MFA — not a flaw in the application.

Closed:

- Shared identity retired; Cloudflare moved to per-member accounts with 2FA and least-privilege roles. This was the root cause; everything else was cleanup.
- Zone rulesets re-scanned across the full two-day dwell window, on the assumption that anything could have been added rather than only the redirect that was found.
- Global API Key rolled.
- Legacy VM `cert.pem` retired.

**Detection is the part that was missing and is now built.** The hijack was found by accident, during an unrelated performance snapshot. The Cloud Monitoring uptime check in §1 closes that gap specifically: it runs from Google's edge in three regions and asserts a **content match** on the health payload, so an endpoint that returns a perfectly healthy 200 while serving someone else's page fails the check. A status-code-only monitor would have stayed green for all four hours.

BAA eligibility remains the one open Cloudflare item, and only conditionally: TLS terminates at their edge, so if the product ever handles PHI the plan must be BAA-eligible (Free/Pro are not). Under the current non-PHI-by-policy position it is not required.

## 7. Split staging and production credentials (F-072)

**Why:** both deploy workflows use one `SSH_PRIVATE_KEY`, `VM_HOST` and `VM_USER` (confirmed not split, 2026-08-14). Staging compromise equals production access. A split gives attribution and independent revocation, **not** lateral-movement containment — both environments share a host where `docker` is root. Separately, shared GCS credentials across environments caused two production video-deletion incidents. Staging now uses its own bucket in `theraptly-lms-staging` (verified 2026-09-22); which identity the VM itself authenticates as is still open (OPEN-ISSUES Q-12).

**Do:** generate a second keypair, add `STAGING_SSH_PRIVATE_KEY` / `STAGING_VM_USER`, point `deploy-staging.yml` at them, and give each environment its own OS user with access only to its own directories. Audit every `.env.*` for a credential that appears in more than one environment — especially `GCP_BUCKET_NAME` and `GCS_KEY_BASE64`.

**Verify:** the staging key cannot `ssh` as the production user; a `grep`/hash comparison across env files shows no shared cloud credential.

---

## 8. Secrets manager (F-076)

**Why:** each environment's entire secret set lives in one GitHub secret (`PRODUCTION_ENV_BASE64`), base64-decoded to a file on the VM at every deploy. No per-secret rotation, no access log, no versioning — and rotating one value means re-encoding the whole blob.

**Do:** move to Google Secret Manager (already your cloud) and have the deploy fetch individual secrets, or at minimum split the blob into per-secret GitHub secrets as an interim.

**Verify:** rotating a single secret requires no change to any other; Secret Manager's access log shows the fetch.

---

## 9. Remove the single-VM SPOF (SOC 2 A1.2)

**Why:** production, staging, Postgres, Redis and MinIO share one host, one disk and one `cloudflared`. The app runs a single replica capped at 1 GB with background workers inside the web process. Any host event takes down both environments simultaneously — including the monitoring that would tell you, which is why §1's uptime checks run from Google's edge instead.

**Decided 2026-08-11: staging and production stay on one VM.** A second VM was rejected; the risk it would have addressed is closed more cheaply by a **separate GCP project for staging** (`theraptly-lms-staging` — staging's Vertex calls, storage bucket and telemetry run there, verified 2026-09-22; whether the VM's own identity is shared is OPEN-ISSUES Q-12) plus staging resource ceilings so it cannot starve production. The reasoning is recorded in `docs/local/ops-actions-2026-08-10.md` §0. The Cloud SQL move (§4) takes the production database off the shared host.

Full HA (Postgres standby, ≥2 app replicas, a load balancer, workers extracted to their own service) remains a larger programme and overlaps the planned frontend/backend split.

---

## 10. GitHub settings (branch protection, environments)

**Unblocked 2026-08-17 — the org moved to the GitHub Team plan.** Branch protection, rulesets and environment protection rules were previously `403` on the free plan for a private repo.

- Required **status checks** are the substantive control. Required approving reviews are also viable: a second org account (same maintainer) handles review/merge, so self-approval does not deadlock — treat it as a deliberate second pass, not peer review.
- **Never mark a path-filtered workflow's job as required.** `security-scan.yml` only triggers on certain paths; on a PR that touches none of them the job never reports and a required check blocks the merge forever. `ci.yml`'s jobs are unfiltered and safe to require.
- `environment: production` in `deploy-production.yml` gates nothing until an environment is actually created in the repo settings.
- Dependabot alerts and security updates are both enabled (verified 2026-08-14).

## Credential rotation worklist (F-075)

Independent of everything above: the repository was **public** until 2026-08-09. Anything ever committed must be treated as disclosed, and history scrubbing does not help — rotation does.

Run the scheduled full-history gitleaks job (`security-scan.yml`, workflow_dispatch), then rotate every credential it reports. The dev Postgres password is known to be in history. Already confirmed handled: the exposed Gemini key, and the container package is private.

The first run (2026-08-14, `31764747102`) was **inconclusive** — the history scan was killed at its 20-minute cap and produced no artifact; the cap was then raised to 45 minutes. Credentials were rotated several times on 2026-08-17, which neutralises historical exposure, but a complete history scan is still the only way to know *what* was exposed. Every rotation must also be propagated to the GitHub environment secrets and the VM env files.

## A minimal first week

If bandwidth is the constraint, this order buys the most safety per hour:

1. **Finish RISK-08** — confirm on the VM whether §1 (monitoring) is applied, including an alert on a stale backup heartbeat, and record the answer here.
2. **§3** — backups are running (2026-09-22); do one tested restore of a recent dump and record the RTO. This is the only item where the failure mode is *unrecoverable data loss*.
3. **§2 / §4** — the least-privilege role split, via the Cloud SQL cutover or on the VM. It is the hard prerequisite for tenant-isolation RLS (F-007).

Everything else can wait a sprint. Those three cannot.

(§6, the Cloudflare follow-ups, was the third item here until 2026-08-10 and is now closed.)
