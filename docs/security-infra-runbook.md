# Security Infrastructure Runbook

**Written:** 2026-08-10 · Executable companion to [`deployment.md`](./deployment.md) §4 and [`analysis/AUDIT-2026-08.md`](./analysis/AUDIT-2026-08.md)

`deployment.md` §4 lists *what* is outstanding. This is *how*, in what order, and how to know each step worked. Everything here needs VM, cloud-console or GitHub-settings access, so none of it could be done in the code work — it is deliberately separated rather than left implied.

## What has changed since §4 was written

Two items on that checklist are now partly done, so start from here rather than there:

- **Monitoring/alerting** — built. An OTel Collector ships container logs to Cloud Logging, host metrics feed disk/memory alerts, and there are eight alert policies plus an uptime check with a content matcher. **None of it is applied yet** — see §1 below. See [`monitoring.md`](./monitoring.md).
- **Incident response** — still absent, and still a policy artefact rather than engineering. Out of scope for engineering readiness, but note the alerts now route somewhere, so "who responds" has become the binding constraint rather than "would we know".

## Ordering, and why it is this order

```
1. Apply monitoring        ── cheap, and you are currently blind
2. lms_app DB role         ── unblocks F-007; makes REVOKE real
3. Backups + tested restore ── MUST precede any data migration
4. Encryption at rest      ── needs 3 (never migrate data you cannot restore)
5. TLS in transit
6. Cloudflare follow-ups   ── independent; can run in parallel
7. Split staging/prod creds
8. Secrets manager
9. Split staging off the prod VM
```

Two hard dependencies, both learned the hard way:

**Backups before encryption-at-rest.** Encrypting a volume or migrating to a managed database moves every byte you own. Doing that with no restore path is how a hardening project becomes an outage. There are currently **no backups at all** (F-004).

**`lms_app` role before RLS.** Postgres RLS is bypassed by superusers and table owners. The app connects as `postgres` (F-093), so adding RLS policies first produces something that *looks* like a tenant-isolation backstop and enforces nothing — the exact false assurance this programme has been removing.

---

## 1. Apply the monitoring configuration

**Why:** you have no uptime check, no alerting and no log retention today. The 2026-08-04 hijack served a phishing redirect for four hours and was found by accident. This is the cheapest risk reduction available.

**Do:** follow [`infra/gcp/README.md`](../infra/gcp/README.md) — service accounts (one per environment), notification channel, uptime check, eight alert policies, log-based metrics, retention. Then place the collector keys on the VM and redeploy so the `otel-collector` service starts.

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
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lms_app;

-- The append-only ledgers. The trigger already blocks these regardless of role;
-- this makes the grant layer agree with the trigger.
REVOKE UPDATE, DELETE ON audit_logs, phi_decisions FROM lms_app;
```

Then point the app's `DATABASE_URL` at `lms_app` and keep a **separate** superuser URL for migrations — `prisma migrate deploy` needs DDL rights the app must not have. `.env.example` already documents a `directUrl` for exactly this split.

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

**Why:** there are none. Not "insufficient" — none. Every byte lives on one VM's bind mounts, with no snapshot, no WAL archiving, no off-host copy. A disk-full event (which the new alerts now warn about), a corrupting `docker compose down -v`, or a failed disk is currently unrecoverable, including the six-year audit trail.

**Do:** the pragmatic option on this topology is `pgBackRest` or `wal-g` to GCS, both of which do base backups plus WAL archiving for point-in-time recovery. Daily base, continuous WAL, 35-day retention.

```bash
# Sketch — pgBackRest to GCS, run from the VM.
sudo apt-get install -y pgbackrest
# /etc/pgbackrest/pgbackrest.conf
#   [global]
#   repo1-type=gcs
#   repo1-gcs-bucket=theraptly-lms-backups
#   repo1-gcs-key=/home/deploy/secrets/backup-sa.json
#   repo1-retention-full=4
#   repo1-cipher-type=aes-256-cbc      # encrypted at rest in the bucket
#   repo1-cipher-pass=<generated>
#   start-fast=y
```

Also: a separate GCS bucket with **object versioning and a retention policy**, its own service account (backup-write only, no read of application buckets), and a Redis RDB/AOF copy pushed off-host — AOF on the same disk is not a backup.

**Verify — this is the deliverable, not the backup:**

1. Restore last night's backup into a *scratch* Postgres instance.
2. Point a local app build at it and log in.
3. Confirm row counts on `users`, `enrollments`, `audit_logs`, `phi_decisions`.
4. Do a PITR to a timestamp mid-yesterday and confirm you get the older state.
5. Write down how long steps 1–4 took. That number is your RTO; until it is measured you do not have one.

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

Recommendation: **Option B if the budget exists**, because it collapses three checklist items into one purchase. Option A if not.

Also decide `DocumentVersion.content` — extracted document plaintext currently sits in a column. Either encrypt it or drop it and re-derive from object storage on read. This has been open since the 2026-07 audit and needs a product call on the latency trade-off, not just an infra one.

**Verify:** confirm the volume is encrypted (`cryptsetup status`) or that the managed instance reports encryption; confirm a fresh backup restores; confirm MinIO/GCS objects report SSE/CMEK.

---

## 5. Encryption in transit, internally

**Why:** `sslmode` appears nowhere; `MINIO_USE_SSL` is `false` in staging *and* production; Redis is plaintext-with-password. Defensible while everything shares one host and traffic never leaves `lo`/the bridge — and a §164.312(e) gap the moment anything splits across machines, which §9 does.

**Do:** add `?sslmode=require` to `DATABASE_URL` (and `verify-full` with a CA once on a managed instance); enable MinIO TLS or move object storage fully to GCS; enable Redis TLS. Sequence this *before* §9, not after.

**Verify:** `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();` returns true from the app's connection.

---

## 6. Cloudflare incident follow-ups

**Why:** ten of eleven follow-ups from INC-2026-08-04-01 are still open, including the ones that address the entry vector. The account was compromised through a password-only login on a **shared** Gmail identity.

**Do, in this order:**

1. Rotate the shared Gmail credential and move Cloudflare off a shared identity to per-member accounts with least-privilege roles. This is the root cause; everything else is cleanup.
2. Re-scan every zone ruleset across the two-day dwell window — assume anything could have been added, not just the redirect that was found.
3. Roll the Global API Key.
4. Retire the legacy VM `cert.pem`.
5. Confirm the plan's BAA eligibility if the non-PHI position ever changes (Free/Pro are not eligible; TLS terminates at their edge).

**Verify:** no shared-identity logins remain in the Cloudflare audit log; every member has their own account with 2FA; the uptime check from §1 now covers detection.

**Cost:** none but time — unless BAA eligibility forces an Enterprise plan, which is a significant step up.

---

## 7. Split staging and production credentials (F-072)

**Why:** both deploy workflows use one `SSH_PRIVATE_KEY`, `VM_HOST` and `VM_USER`. Staging compromise equals production access. Separately, staging and production have historically shared GCS credentials, which is the unclosed root cause of two production video-deletion incidents.

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

**Do:** the highest-value first step is smaller than full HA — **move staging onto its own host.** It removes the co-residency risk, ends the credential-sharing temptation in §7, and gives you somewhere to rehearse §2–§5 that is not production. Full HA (Postgres standby, ≥2 app replicas, a load balancer, workers extracted to their own service) is a larger programme and overlaps the planned frontend/backend split.

**Verify:** stopping the staging host leaves production serving.

---

## Credential rotation worklist (F-075)

Independent of everything above: the repository was **public** until 2026-08-09. Anything ever committed must be treated as disclosed, and history scrubbing does not help — rotation does.

Run the scheduled full-history gitleaks job (`security-scan.yml`, workflow_dispatch), then rotate every credential it reports. The dev Postgres password is known to be in history. Already confirmed handled: the exposed Gemini key, and the container package is private.

## A minimal first week

If bandwidth is the constraint, this order buys the most safety per hour:

1. **§1** — apply monitoring. You are blind, and it is nearly free.
2. **§3** — backups plus one tested restore. This is the only item where the current state is *unrecoverable data loss*.
3. **§6.1** — rotate the shared Cloudflare identity. It is the unaddressed entry vector of an incident that already happened.

Everything else can wait a sprint. Those three cannot.
