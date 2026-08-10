# Monitoring & Observability

How the LMS is observed, what alerts exist and why, and what to do when one fires.

Companion to [`infra/gcp/README.md`](../infra/gcp/README.md) (applying the config) and [`infra/otel/collector-config.yaml`](../infra/otel/collector-config.yaml) (log shipping).

## 1. Starting point

Before this work there was **no** monitoring: no APM, no error tracking, no metrics, no alerting, no uptime check, and no log shipping. `package.json` had zero observability dependencies. Application logs went to stdout and died with the container, with no rotation, so the structured-logging and PHI-evidence work was durable only until the next `docker compose up`.

The practical consequence is on record: on 2026-08-04 the production zone was hijacked and served a phishing redirect for roughly four hours. Nobody was told. It was found while someone happened to run a performance snapshot.

## 2. Architecture

```
app / db / redis / minio  ──stdout──▶  Docker json-file (rotated 10m × 5)
                                              │
                                    OTel Collector (tails, read-only)
                                              │  service-account key, per env
                                              ▼
                                       Cloud Logging
                                              │
                              log-based alert policies ──▶ notification channel

Google edge (3 regions) ──▶ https://training.theraptly.com/api/health
                                    + content matcher ──▶ uptime alert policy
```

Two deliberate choices:

**Logs are tailed from files, not pushed by the app.** The app already writes one JSON object per line; tailing needs no code change and no npm dependency, and it captures Postgres, Redis and MinIO too. Pushing from the app would cover only the app and would couple request handling to a telemetry sink's availability.

**Uptime checks run from Google's edge, not the VM.** A self-hosted monitor tells you nothing precisely when the host is the problem.

## 3. What is alerted, and why each one exists

| Alert | Exists because |
| --- | --- |
| **Production unreachable or not serving our app** | The 2026-08-04 hijack returned a healthy 200. A status-code-only check would have stayed green. The content matcher asserts the body is *ours* |
| **Authentication failure spike** | Credential stuffing. Also surfaces a rate limiter that has silently degraded — it falls back to per-process memory when Redis is unreachable (F-024) |
| **System-admin authentication** | That surface grants cross-org powers including irreversible deletion, authenticated by a shared static password with no rate limit (F-056, F-097). Every use warrants a look, and it should be near-zero volume |
| **PHI scan failing** | The scanner fails *closed*, so this means uploads are being rejected, not that PHI leaked. Sustained firing = document upload and course generation are down |
| **Audit or PHI ledger write failed** | A compliance issue, not an ops one. The trail HIPAA §164.312(b) treats as a control now has a gap, and the evidence report will refuse to attest for any period containing it |
| **Background workers failed to start** | Workers boot inside the web process and a boot failure is swallowed so the app still serves traffic. The symptom is silence — reminders, transcodes, digests and retention purges just stop (this was F-005) |

Each policy carries its first-response steps in its `documentation` field, so they appear in the notification rather than living only here.

## 4. Querying logs

```
# All app logs for an environment
jsonPayload.service="lms-production"

# Follow one request end to end (the logger stamps this automatically)
jsonPayload.correlationId="<id>"

# Errors only
jsonPayload.service="lms-production" AND severity>=ERROR

# PHI gate activity
jsonPayload.msg=~"PHI"
```

`correlationId` is the useful one: `src/lib/request-context.ts` binds it per request via `AsyncLocalStorage`, so every line emitted while handling a request shares it without anyone threading it through call signatures.

## 5. What logs will and will not contain

Redaction is **structural** (F-078) — the logger scrubs on the way out rather than relying on each call site. Never present: passwords, tokens, secrets, cookies, document content, quiz answers, addresses, phone numbers, SSNs, signatures. Email addresses are masked to `ad***@company.com`, including when interpolated into a message. Error objects contribute only allow-listed operational properties; anything else is dropped with its *name* recorded as `errExtraKeysOmitted`.

So a log line is safe to paste into a ticket, and if you need the full value of something you will not find it here by design — look at the row in Postgres.

**Metrics are different.** Cloud Logging and Cloud Monitoring are both HIPAA-eligible under the Google Cloud BAA, but Google is explicit that PHI must not go into metric labels, resource labels or dashboards. Keep metric labels low-cardinality and identifier-free.

## 6. Verifying the monitoring actually works

A monitor nobody has seen fail is a monitor nobody should trust. Do these against **staging**, never by breaking production:

1. **Log shipping** — restart the staging app, then confirm the boot line appears in Cloud Logging within a minute:
   `jsonPayload.service="lms-staging" AND jsonPayload.msg=~"Background workers started"`
2. **Content matcher** — change the staging health response so it no longer contains `"status":"ok"`, confirm the check goes red, then revert.
3. **One alert end to end** — trigger a system-admin login failure on staging and confirm the notification actually arrives. An alert policy with an unverified notification channel is decoration.
4. **Log rotation** — `docker inspect lms-production-app` and confirm `max-size` / `max-file`.

## 7. Not yet built

Honest list, so nobody assumes coverage that does not exist:

- **Metrics and traces.** Only logs ship today. Request latency, queue depth, DLQ growth and Vertex spend are not measured; the alerts above are log-derived. Adding them needs the OTel SDK wired into `src/instrumentation.ts` and an OTLP receiver on the collector.
- **Error grouping.** Cloud Error Reporting will pick up structured error entries, but stack-trace grouping has not been verified.
- **Six-year audit retention off-host.** The `_Default` log bucket is being raised to 400 days; the ≥6-year audit requirement wants a dedicated bucket or a Cloud Storage sink.
- **Log-based metrics + SLOs.** No error-budget tracking.
- **On-call rotation and IR runbook.** Alerts route to an email channel. Who responds, and how, is a policy artefact and out of scope for engineering readiness.
