# GCP monitoring configuration

Definitions for the Cloud Monitoring side of the observability work. These are applied with `gcloud`, not by any deploy workflow — they are control-plane configuration, not application code, and nothing in CI has (or should have) permission to change them.

## Why uptime checks matter here specifically

On 2026-08-04 the production zone was hijacked at the DNS/proxy layer and served a 301 to a phishing site for roughly four hours. It was found **by accident**, while someone ran a performance snapshot.

A naive uptime check would not have caught it: the hijacked endpoint was *up*, and it returned a perfectly healthy status code. What catches that class of failure is the **content matcher** — asserting the response is not merely 200 but actually *our application*. That is the single most important line in `uptime-check-production.json`:

```json
"contentMatchers": [{ "content": "\"status\":\"ok\"", "matcher": "CONTAINS_STRING" }]
```

A redirect to an attacker's page cannot satisfy it. Neither can a parked domain, a proxy error page, or a stale cache.

The checks also run from Google's edge in three regions rather than from the VM, so they survive the host being down — the failure mode where a self-hosted monitor tells you nothing precisely when you need it.

## Applying

Requires `roles/monitoring.editor`. Use the script — it is idempotent by display
name, so re-running after a partial failure will not create duplicates:

```bash
./apply.sh production ops@theraptly.com --with-uptime
./apply.sh staging    ops@theraptly.com
```

It creates (or reuses) the notification channel, the four log-based metrics, the
alert policies and the `_Default` bucket retention, and finishes by printing the
verification steps that turn this from applied into proven.

> ⚠️ **The disk and memory alerts depend on OPTIONAL collector metrics.**
> `system.memory.utilization` and `system.filesystem.utilization` are not emitted
> by the hostmetrics receiver unless explicitly enabled, and both policies filter
> on exactly those metric types. They are enabled in
> `infra/otel/collector-config.yaml` as of 2026-08-14 — verified empirically
> against `otel/opentelemetry-collector-contrib:0.114.0`, which with the scrapers
> alone emits only `system.memory.usage` / `system.filesystem.usage`.
>
> **A collector running the old config leaves both alerts permanently silent**,
> which looks exactly like "nothing is wrong". Redeploy the collector before
> trusting them, and confirm with the `time-series list` check the script prints.

> ⚠️ **`system.memory.utilization` emits one series per state** (used, free,
> cached, buffered, slab_\*), and the condition reduces with MAX across series.
> The filter therefore pins `state="used"`. Without that pin, an idle host with
> plenty of free memory fires a memory-pressure alert continuously — the alert
> would be loudest precisely when there is no problem.

The raw commands below are kept for reference and for anyone applying a single
piece by hand.

```bash
PROJECT_ID=your-project-id

# 1. Notification channel — do this first; policies reference it.
gcloud alpha monitoring channels create \
  --display-name="LMS ops email" \
  --type=email \
  --channel-labels=email_address=ops@theraptly.com \
  --project="$PROJECT_ID"

# Note the returned channel id.
CHANNEL=projects/$PROJECT_ID/notificationChannels/REPLACE_ME

# 2. Uptime check.
sed "s/REPLACE_WITH_PROJECT_ID/$PROJECT_ID/" uptime-check-production.json > /tmp/uptime.json
gcloud monitoring uptime create --config-from-file=/tmp/uptime.json --project="$PROJECT_ID"

# 3. Alert policies.
for f in alert-*.json; do
  sed -e "s|REPLACE_WITH_CHANNEL|$CHANNEL|" -e "s/REPLACE_WITH_PROJECT_ID/$PROJECT_ID/" "$f" > /tmp/policy.json
  gcloud alpha monitoring policies create --policy-from-file=/tmp/policy.json --project="$PROJECT_ID"
done
```

## Verifying the content matcher actually works

Do **not** verify by breaking production. Point a check at staging, change the staging health response so it no longer contains `"status":"ok"`, and confirm the check goes red and the alert fires. A monitor nobody has ever seen fail is a monitor nobody should trust.

## Service accounts

One per environment, never shared. The staging collector must not hold a credential that can write to production telemetry — sharing credentials across environments is the unclosed root cause behind two production data-loss incidents (see the SAFETY block in `src/lib/queue/video-sweep-worker.ts`).

```bash
for ENV in production staging; do
  gcloud iam service-accounts create "lms-otel-$ENV" \
    --display-name="LMS OTel collector ($ENV)" --project="$PROJECT_ID"

  SA="lms-otel-$ENV@$PROJECT_ID.iam.gserviceaccount.com"

  # Least privilege: write telemetry, read nothing.
  for ROLE in roles/logging.logWriter roles/monitoring.metricWriter; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:$SA" --role="$ROLE"
  done

  gcloud iam service-accounts keys create "otel-sa-$ENV.json" --iam-account="$SA"
done
```

Place each key on the VM at `/home/deploy/secrets/otel-sa-<env>.json`, mode `0400`, owned by `deploy`. These files are **never** committed — `infra/otel/collector-config.yaml` mounts them read-only by path.

## Log-based metrics

> **Filters use `labels.*`, not `jsonPayload.*`.** Verified against real entries in
> `theraptly-lms-staging` on 2026-08-12. The `googlecloud` exporter puts the raw
> line in `textPayload` and maps the collector's parsed OTel attributes into
> Cloud Logging **`labels`** — so `jsonPayload` does not exist on these entries and
> any filter written against it matches nothing, permanently and silently.
>
> A real entry looks like:
>
> ```json
> {
>   "textPayload": "{\"level\":\"debug\",\"service\":\"lms-staging\",\"msg\":\"...\"}\n",
>   "severity": "DEBUG",
>   "labels": { "level": "debug", "msg": "...", "service": "lms-staging",
>               "service.name": "lms-staging", "log.iostream": "stdout" },
>   "logName": "projects/theraptly-lms-staging/logs/lms-container-logs",
>   "resource": { "type": "generic_node" }
> }
> ```
>
> `severity` **is** mapped correctly by the collector's severity parser, so
> `severity>=ERROR` works as written and is preferable to matching on
> `labels.level` where either would do.


Domain counters are **derived from the logs**, not emitted from application code. The events already appear as structured lines with stable `msg` prefixes, so extracting them here avoids instrumenting every call site a second time, keeps label cardinality under explicit control instead of depending on whatever a caller passes, and adds no dependency to the app.

```bash
PROJECT_ID=your-project-id

# PHI gate outcomes. The label distinguishes a genuine detection from a scan that
# could not complete — a Vertex outage must not read as a wave of PHI uploads.
gcloud logging metrics create lms_phi_blocked \
  --project="$PROJECT_ID" \
  --description="Documents blocked by the PHI gate" \
  --log-filter='labels.msg=~"Upload blocked" AND labels.service=~"lms-"'

# Failed logins — the input to credential-stuffing detection.
gcloud logging metrics create lms_auth_failures \
  --project="$PROJECT_ID" \
  --description="Failed authentication attempts" \
  --log-filter='labels.msg=~"login failed" OR labels.msg=~"System admin login failed"'

# Rate-limit rejections. A sudden drop to zero is as interesting as a spike: the
# limiter falls back to per-process memory when Redis is unreachable (F-024), so
# silence can mean it has stopped limiting rather than that abuse stopped.
gcloud logging metrics create lms_rate_limit_rejections \
  --project="$PROJECT_ID" \
  --description="Requests rejected by the rate limiter" \
  --log-filter='labels.msg=~"rate limit exceeded"'

# Evidence-ledger gaps. Should be permanently zero.
gcloud logging metrics create lms_ledger_write_failures \
  --project="$PROJECT_ID" \
  --description="audit_logs or phi_decisions write failures" \
  --log-filter='labels.msg=~"Failed to write audit log" OR labels.msg=~"FAILED to record PHI decision"'
```

These filters depend on the `msg` prefixes in the code. If a message is reworded, the metric silently goes quiet — so treat the strings as a contract, and prefer adding a new `msg` over editing an existing one.

## Six-year audit retention off-host

Audit rows live in Postgres and are excluded from `runRetentionPurge`, but there are no database backups yet (F-004), so the shipped copy is what survives losing the DB. The default log bucket's retention is far short of the ≥6-year requirement, so route audit entries to their own bucket:

```bash
gcloud logging buckets create lms-audit \
  --location=global --retention-days=2200 \
  --description="LMS audit trail — 6 year retention" --project="$PROJECT_ID"

gcloud logging sinks create lms-audit-sink \
  "logging.googleapis.com/projects/$PROJECT_ID/locations/global/buckets/lms-audit" \
  --log-filter='labels.msg=~"\[audit\]" OR labels.msg=~"\[phi\]"' \
  --project="$PROJECT_ID"
```

2200 days ≈ 6 years. Consider locking the bucket (`--locked`) once satisfied with the filter — a locked bucket's retention cannot be shortened, which is the point, and also means a mistake in the filter is permanent.

## Log retention

Cloud Logging's `_Default` bucket retains 30 days. Audit rows live in Postgres and are retained ≥6 years by policy, but the shipped copy is what survives a database loss, so raise the retention on the bucket holding `lms-container-logs`:

```bash
gcloud logging buckets update _Default \
  --location=global --retention-days=400 --project="$PROJECT_ID"
```

400 days covers a SOC 2 observation window with margin. Six-year retention for the audit trail specifically wants a dedicated bucket or a sink to Cloud Storage — see the infra runbook.

## A note on PHI in metrics

Cloud Logging and Cloud Monitoring are both HIPAA-eligible under the Google Cloud BAA, but Google's guidance is explicit that **PHI must not be placed in metric labels, resource labels, or dashboards**. Metric labels must stay low-cardinality and free of user identifiers — no email, no user id, no document name. This is also just good metric hygiene: high-cardinality labels are what make a monitoring bill explode.
