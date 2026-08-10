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

Requires `roles/monitoring.editor`.

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

## Log retention

Cloud Logging's `_Default` bucket retains 30 days. Audit rows live in Postgres and are retained ≥6 years by policy, but the shipped copy is what survives a database loss, so raise the retention on the bucket holding `lms-container-logs`:

```bash
gcloud logging buckets update _Default \
  --location=global --retention-days=400 --project="$PROJECT_ID"
```

400 days covers a SOC 2 observation window with margin. Six-year retention for the audit trail specifically wants a dedicated bucket or a sink to Cloud Storage — see the infra runbook.

## A note on PHI in metrics

Cloud Logging and Cloud Monitoring are both HIPAA-eligible under the Google Cloud BAA, but Google's guidance is explicit that **PHI must not be placed in metric labels, resource labels, or dashboards**. Metric labels must stay low-cardinality and free of user identifiers — no email, no user id, no document name. This is also just good metric hygiene: high-cardinality labels are what make a monitoring bill explode.
