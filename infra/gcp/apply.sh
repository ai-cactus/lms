#!/usr/bin/env bash
#
# Apply the Cloud Monitoring configuration for one environment.
#
# These are control-plane settings, applied deliberately by a human with
# gcloud — nothing in CI has (or should have) permission to change them.
#
# Idempotent by display name: policies and metrics that already exist are
# skipped rather than duplicated, so a re-run after a partial failure is safe.
#
# Usage:
#   apply.sh <production|staging> <notification-email> [--with-uptime]
#
#   --with-uptime   also create the uptime check. Production only: it targets
#                   training.theraptly.com.

set -euo pipefail

ENVIRONMENT="${1:-}"
ALERT_EMAIL="${2:-}"
WITH_UPTIME="${3:-}"

case "$ENVIRONMENT" in
  production)
    PROJECT="theraptly-lms"
    SERVICE="lms-production"
    ;;
  staging)
    PROJECT="theraptly-lms-staging"
    SERVICE="lms-staging"
    ;;
  *)
    echo "usage: $0 <production|staging> <notification-email> [--with-uptime]" >&2
    exit 2
    ;;
esac

[ -n "$ALERT_EMAIL" ] || {
  echo "A notification email is required." >&2
  echo "There is no default on purpose: an alert policy pointed at a mailbox" >&2
  echo "nobody reads is indistinguishable from no alerting at all." >&2
  exit 2
}

cd "$(dirname "$0")"
log() { echo "[apply][${ENVIRONMENT}] $*"; }

log "project=${PROJECT} service=${SERVICE} email=${ALERT_EMAIL}"

# ── 1. Notification channel ──────────────────────────────────────────────────
# Everything else references this, so it goes first. Reused if it already
# exists — re-running must not create a second channel that half the policies
# point at.
# String literals in a Monitoring filter MUST be quoted. Unquoted, `email` is
# read as a field reference and the API rejects the whole filter:
#   ambiguous use of email on the right-hand side of the '=' operator
# This only surfaces once a channel EXISTS — with none, the filter merely warns
# that the keys are absent and returns nothing, so the first run creates one and
# every run after it dies. Exactly the re-run this block exists to make safe.
CHANNEL="$(gcloud beta monitoring channels list \
  --project="$PROJECT" \
  --filter="type=\"email\" AND labels.email_address=\"${ALERT_EMAIL}\"" \
  --format='value(name)' | head -1)"

if [ -z "$CHANNEL" ]; then
  log "creating notification channel"
  CHANNEL="$(gcloud beta monitoring channels create \
    --project="$PROJECT" \
    --display-name="LMS ops (${ENVIRONMENT})" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}" \
    --format='value(name)')"
else
  log "reusing existing notification channel"
fi
log "channel: ${CHANNEL}"

# ── 2. Log-based metrics ─────────────────────────────────────────────────────
# Derived from the structured logs already shipping rather than emitted from
# application code: no second instrumentation path, and label cardinality stays
# under explicit control.
#
# These filter on labels.msg / labels.service, which exist only on the app's
# own JSON lines. That is correct here — every event below is an application
# event. (Pipeline liveness is a different question, answered by
# labels."service.name", which is present on every line from every container.)
create_metric() {
  local name="$1" description="$2" filter="$3"
  if gcloud logging metrics describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    log "metric ${name} exists, skipping"
    return
  fi
  log "creating metric ${name}"
  gcloud logging metrics create "$name" \
    --project="$PROJECT" \
    --description="$description" \
    --log-filter="$filter"
}

create_metric "lms_phi_upload_blocked" \
  "Uploads rejected because PHI was detected" \
  'labels.msg=~"Upload blocked" AND labels.service=~"lms-"'

create_metric "lms_auth_failures" \
  "Failed login attempts, including system-admin attempts" \
  'labels.msg=~"login failed" OR labels.msg=~"System admin login failed"'

create_metric "lms_rate_limit_rejections" \
  "Requests rejected by rate limiting" \
  'labels.msg=~"rate limit exceeded"'

create_metric "lms_audit_write_failures" \
  "Failures to write the append-only audit or PHI ledgers" \
  'labels.msg=~"Failed to write audit log" OR labels.msg=~"FAILED to record PHI decision"'

# ── 3. Uptime check (production only) ────────────────────────────────────────
# The content matcher is the load-bearing part: on 2026-08-04 the zone was
# hijacked and served a 301 to a phishing page. A status-code-only check stayed
# green throughout. Asserting the body is OUR app is what catches that.
if [ "$WITH_UPTIME" = "--with-uptime" ]; then
  # `gcloud monitoring uptime create` takes FLAGS — it has no --config-from-file
  # (that exists for `alpha monitoring policies create`, which is why the two
  # looked symmetric and were not). The settings below are the ones this check
  # is built around; keep them together if they change.
  UPTIME_NAME="LMS production — reachable and serving our own app"
  UPTIME_HOST="training.theraptly.com"

  # Matched by exact display name. An approximate match here silently creates a
  # DUPLICATE check on every run instead of skipping.
  if gcloud monitoring uptime list-configs --project="$PROJECT" \
    --format='value(displayName)' 2>/dev/null | grep -qF "$UPTIME_NAME"; then
    log "uptime check exists, skipping"
  else
    log "creating uptime check"
    # Region names are the CLI's own enum, NOT the API's: usa-oregon /
    # europe / asia-pacific, not USA_OREGON / EUROPE_IRELAND /
    # ASIA_PACIFIC_SINGAPORE. At least 3 are required.
    gcloud monitoring uptime create "$UPTIME_NAME" \
      --project="$PROJECT" \
      --resource-type=uptime-url \
      --resource-labels=host="${UPTIME_HOST}",project_id="$PROJECT" \
      --protocol=https \
      --port=443 \
      --path=/api/health \
      --validate-ssl=true \
      --status-codes=200 \
      --matcher-content='"status":"ok"' \
      --matcher-type=contains-string \
      --period=1 \
      --timeout=10 \
      --regions=usa-oregon,europe,asia-pacific
  fi
fi

# ── 4. Alert policies ────────────────────────────────────────────────────────
for f in alert-*.json; do
  # The uptime policy is meaningless without the check that feeds it.
  if [ "$f" = "alert-uptime-production.json" ] && [ "$WITH_UPTIME" != "--with-uptime" ]; then
    log "skipping ${f} (no uptime check in this environment)"
    continue
  fi

  DISPLAY="$(python3 -c "import json,sys; print(json.load(open('$f'))['displayName'])")"
  if gcloud alpha monitoring policies list --project="$PROJECT" \
    --format='value(displayName)' 2>/dev/null | grep -Fqx "$DISPLAY"; then
    log "policy '${DISPLAY}' exists, skipping"
    continue
  fi

  log "creating policy '${DISPLAY}'"
  sed -e "s|REPLACE_WITH_CHANNEL|${CHANNEL}|g" \
    -e "s|REPLACE_WITH_PROJECT_ID|${PROJECT}|g" \
    "$f" >/tmp/lms-policy.json
  gcloud alpha monitoring policies create --policy-from-file=/tmp/lms-policy.json --project="$PROJECT"
  rm -f /tmp/lms-policy.json
done

# ── 5. Log retention ─────────────────────────────────────────────────────────
log "setting _Default bucket retention to 400 days"
gcloud logging buckets update _Default \
  --location=global --retention-days=400 --project="$PROJECT"

cat <<EOF

[apply][${ENVIRONMENT}] Applied. NOT YET PROVEN.

Next, and it is not optional:

  1. Confirm the email channel is VERIFIED. Google sends a confirmation mail;
     until it is accepted, every policy below points at nothing.
       gcloud beta monitoring channels describe ${CHANNEL} \\
         --project=${PROJECT} --format='value(verificationStatus)'

  2. Trigger ONE alert end to end and confirm the mail arrives. An alert
     policy nobody has ever seen fire is decoration.
     Safe method: point a check at staging and break the staging health
     response, never production.

  3. Confirm the disk/memory metrics actually exist. They depend on the
     OPTIONAL hostmetrics utilization metrics enabled in
     infra/otel/collector-config.yaml on 2026-08-14 — a collector predating
     that change publishes only *.usage, and both policies stay silent:
       gcloud monitoring time-series list \\
         --project=${PROJECT} \\
         --filter='metric.type="workload.googleapis.com/system.memory.utilization"' \\
         --format='value(metric.type)' --limit=1
     Empty output means the collector has not been redeployed with the new
     config. Restart it, then re-check.
EOF
