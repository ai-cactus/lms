# Backups (F-004)

Before this existed there were **no backups of any kind** — no snapshot, no WAL
archiving, no off-host copy. A disk failure or a disk-full event would have lost
everything, including the six-year audit trail the platform is obliged to keep.
The VM reached 98% disk on 2026-08-11, so this was not theoretical.

## Where this sits in the plan

**Phase 1 (these scripts): nightly logical dump to GCS.** Runs through Docker,
changes nothing about the running database, and needs no restart. RPO is _since
last night_.

**Phase 2 (not yet built): pgBackRest with continuous WAL archiving.** RPO drops
to seconds and point-in-time recovery becomes possible. It requires a custom
database image — `archive_command` is executed by the Postgres process itself,
so pgBackRest must live inside the container — plus a restart to enable
`archive_mode`. Planned for a maintenance window.

Phase 1 was shipped first on purpose: every night spent designing Phase 2 was a
night with no backup at all.

## What is protected, and what is not

| Data                                             | Covered            | Notes                                                                |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------------------- |
| Postgres (all application data + audit ledgers)  | ✅ nightly         | The important one                                                    |
| Redis (BullMQ queues)                            | ✅ nightly         | Caches are disposable; in-flight jobs are not                        |
| GCS objects (production videos, documents)       | ➖ not here        | Already durable in GCS; object versioning is the control, not a copy |
| MinIO objects (staging, and production fallback) | ⛔ **not covered** | Recorded gap — see Open questions                                    |

## One-time setup

Per environment. `production` shown; repeat with `staging`.

### 1. Bucket

```bash
ENVIRONMENT=production
PROJECT=theraptly-lms                       # theraptly-lms-staging for staging
BUCKET="gs://theraptly-lms-backups-${ENVIRONMENT}"

# Region deliberately DIFFERENT from the VM's zone: a backup in the same
# failure domain as the thing it protects is not a backup.
gcloud storage buckets create "$BUCKET" \
  --project="$PROJECT" \
  --location=EU \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update "$BUCKET" --versioning
```

Retention is enforced by lifecycle rule rather than by the scripts — a rule
cannot be skipped because a run failed, and nothing on the VM can quietly stop
deleting (or stop keeping) data:

```bash
cat > /tmp/lifecycle.json <<'JSON'
{
  "rule": [
    { "action": {"type": "Delete"},
      "condition": {"age": 35, "isLive": true} },
    { "action": {"type": "Delete"},
      "condition": {"daysSinceNoncurrentTime": 7} },
    { "action": {"type": "Delete"},
      "condition": {"age": 2, "matchesPrefix": ["inflight/"]} }
  ]
}
JSON
gcloud storage buckets update "$BUCKET" --lifecycle-file=/tmp/lifecycle.json
```

35 days matches the runbook. Objects are encrypted with Google-managed keys —
a deliberate decision (2026-08-14) over a pgBackRest passphrase or CMEK: there
is no key to lose, and no restore can ever fail because a passphrase went
missing with the person who set it up.

> ⚠️ The audit trail must be kept for six years, and a 35-day backup window does
> **not** satisfy that on its own. Retention of the live `audit_logs` table plus
> the `lms-audit` log bucket (2200 days) is what carries that obligation.
> Backups are for recovery, not for archival. Do not conflate them.

### 2. A dedicated service account

Its own identity, scoped to this one bucket. The VM's own service account is
**not** reused: it holds broad project permissions, and sharing one credential
across purposes is the unclosed root cause behind two production data-loss
incidents.

```bash
SA="lms-backup-${ENVIRONMENT}"
gcloud iam service-accounts create "$SA" \
  --display-name="LMS backup writer (${ENVIRONMENT})" --project="$PROJECT"

EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"

# Bucket-scoped, not project-scoped. objectUser covers create + read; read is
# required because restore-verify.sh must be able to fetch what it wrote.
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member="serviceAccount:${EMAIL}" --role=roles/storage.objectUser

gcloud iam service-accounts keys create "backup-sa-${ENVIRONMENT}.json" \
  --iam-account="$EMAIL"
```

Note what this identity **cannot** do: delete the bucket, change its lifecycle
or versioning, or touch anything else in the project. Ransomware-style deletion
of the backups needs credentials this key does not have.

### 3. Place the key on the VM

```bash
scp "backup-sa-${ENVIRONMENT}.json" deploy@<VM_IP>:/tmp/
ssh deploy@<VM_IP> "
  sudo install -o deploy -g deploy -m 0400 \
    /tmp/backup-sa-${ENVIRONMENT}.json /home/deploy/secrets/backup-sa-${ENVIRONMENT}.json
  rm -f /tmp/backup-sa-${ENVIRONMENT}.json
  mkdir -p /home/deploy/backups/${ENVIRONMENT}
"
shred -u "backup-sa-${ENVIRONMENT}.json"
```

Owned by `deploy`, not UID 10001 — unlike the OTel key, this one is read by a
host process, not by a container running as another user.

### 4. Install the timer

The scripts live in the repo checkout that the deploy workflow keeps updated, so
they stay current without a separate deployment step.

```bash
ssh deploy@<VM_IP> "
  chmod +x /home/deploy/apps/lms-${ENVIRONMENT}/infra/backup/*.sh
  sudo cp /home/deploy/apps/lms-${ENVIRONMENT}/infra/backup/systemd/*.service \
          /home/deploy/apps/lms-${ENVIRONMENT}/infra/backup/systemd/*.timer \
          /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now lms-backup@${ENVIRONMENT}.timer
  systemctl list-timers lms-backup@${ENVIRONMENT}.timer
"
```

### 5. Run one immediately — do not wait for 02:30

```bash
sudo systemctl start lms-backup@production.service
journalctl -u lms-backup@production.service -n 50 --no-pager
```

### 6. Verify the restore. **This step is the deliverable.**

```bash
/home/deploy/apps/lms-production/infra/backup/restore-verify.sh production
```

It restores the newest backup into a throwaway container, prints row counts for
`users` / `enrollments` / `audit_logs` / `phi_decisions`, confirms password
hashes survived, and prints the elapsed restore time.

**Write that number down in `docs/local/RUNBOOK.md` item 9 with the date.** It is
your RTO, and it is the only defensible answer to "how long would recovery
take". Re-run quarterly — diarise it. A backup regime nobody has restored from
is indistinguishable from no backups until the day it matters.

## What has been rehearsed, and what has not

Rehearsed 2026-08-14 against the real `pgvector/pgvector:pg16` image with a
seeded database: the dump, the `pg_restore --list` integrity check (confirmed to
**reject** a truncated archive that still passes the non-empty test), the scratch
restore including `CREATE EXTENSION vector`, exact row-count and password-hash
equality after restore, the Redis `BGSAVE`/`LASTSAVE`/`docker cp` sequence, and
env-file parsing against quoted, CRLF and space-bearing values.

**Not rehearsed: the GCS upload leg.** It needs the real bucket and key, so the
first run on the VM is its first true test. That is why step 5 above says run one
immediately rather than waiting for the timer.

## Monitoring it

Each successful run writes `_last_success` to the bucket, containing the run's
UTC timestamp. Check it from anywhere:

```bash
gcloud storage cat "gs://theraptly-lms-backups-production/_last_success"
```

Alert on its **age**, not on the job's exit status. A host that has died cannot
report its own failure, and that is precisely the scenario backups exist for.
Wire this into item 10's monitoring when those policies are applied.

## Restoring for real

```bash
# 1. Find the backup you want.
gcloud storage ls 'gs://theraptly-lms-backups-production/postgres/**/*.dump'

# 2. Fetch it.
gcloud storage cp "gs://.../lms_production-<stamp>.dump" /tmp/restore.dump

# 3. Restore into a NEW database first, never over the live one. Compare, then
#    cut over. Restoring over a running database destroys the evidence needed
#    to work out what went wrong.
docker exec -u postgres lms-production-db createdb -U lms lms_restore_check
docker cp /tmp/restore.dump lms-production-db:/tmp/
docker exec -u postgres lms-production-db \
  pg_restore -U lms -d lms_restore_check --no-owner --jobs=2 /tmp/restore.dump
```

## Open questions

- **MinIO objects are not backed up.** Staging is MinIO-only and disposable, but
  production uses MinIO as a fallback store. Worth deciding whether anything
  lands there that is not also in GCS.
- **`DocumentVersion.content`** is stored in the database, so it is captured
  here. If that column is later dropped in favour of object storage (an open
  decision in the runbook), backup coverage changes with it.
