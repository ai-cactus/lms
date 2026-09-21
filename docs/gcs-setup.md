# GCS Setup Guide

This guide covers creating and configuring the Google Cloud Storage bucket used by the LMS for document storage.

---

## Prerequisites

- A GCP project with billing enabled
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- The GCP project ID (referred to as `PROJECT_ID` below)

---

## 1. Create the Bucket

Choose a globally unique bucket name (e.g. `lms-documents-yourcompany`).

```bash
# Replace PROJECT_ID and BUCKET_NAME with your values
PROJECT_ID="your-gcp-project-id"
BUCKET_NAME="lms-documents-yourcompany"
REGION="us-central1"   # Use the region closest to your VM

gcloud storage buckets create "gs://${BUCKET_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --uniform-bucket-level-access \
  --no-public-access-prevention   # Allows signed URLs (required)
```

> [!IMPORTANT]
> **Do not make the bucket or objects publicly accessible.** Files are served only via signed URLs generated server-side.

---

## 2. Set Object Lifecycle Policy (Cost Control)

This deletes orphaned objects older than 365 days — a safety net for failed cleanup:

```bash
cat > /tmp/lms-lifecycle.json <<EOF
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 365 }
    }
  ]
}
EOF

gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --lifecycle-file=/tmp/lms-lifecycle.json
```

---

## 3. Authentication — two code paths

`src/lib/storage/gcs-provider.ts` supports exactly two ways to authenticate, chosen by whether `GCS_KEY_BASE64` is set:

| Path | When it is used | What it needs |
| --- | --- | --- |
| **Application Default Credentials (ADC)** | `GCS_KEY_BASE64` is **unset** — the provider constructs a bare `Storage()` | Whatever ADC resolves on the host: an attached service account on a GCP VM, or `gcloud auth application-default login` locally (stored in `~/.config/gcloud/application_default_credentials.json`) |
| **In-memory service-account key** | `GCS_KEY_BASE64` is **set** — the provider decodes it and constructs `Storage({ projectId, credentials })` | A base64-encoded service-account JSON key (`base64 -w0 key.json`) and `GOOGLE_PROJECT_ID`. A malformed value makes the provider refuse to construct rather than fall back |

Which path staging and production should use is **pending a decision — see OPEN-ISSUES Q-12** (`docs/local/OPEN-ISSUES.md`). This guide does not recommend one.

Whichever identity is used, grant it access **on the bucket only**, never at project level, and never let one environment's identity reach another environment's bucket:

```bash
SA_EMAIL="<service-account>@<project>.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"
```

---

## 4. Add to Environment

Set `GCP_BUCKET_NAME` in your environment file, plus `GCS_KEY_BASE64` (and `GOOGLE_PROJECT_ID`) only if you use the in-memory key path:

```dotenv
# .env.production / .env.staging
GCP_BUCKET_NAME=lms-documents-yourcompany
# GCS_KEY_BASE64=<base64 of the service-account JSON>   # key path only; leave unset for ADC
```

With `GCP_BUCKET_NAME` unset, the GCS provider is unavailable and uploads fall back to MinIO (see below).

---

## 5. Verify

After deploying, upload a document in the LMS UI and check:

```bash
# List objects in the bucket (should show the uploaded file)
gcloud storage ls "gs://${BUCKET_NAME}/documents/"
```

In the application logs you should see:
```
{"level":"info","storageUri":"gcs://lms-documents-yourcompany/documents/...","msg":"GCS upload successful"}
```

---

## Signed URL Requirements

The bucket must allow signed URLs. If you used `--no-public-access-prevention` during creation (step 1), this is already configured.

Signed URLs are generated with a **15-minute expiry** by the `getDocumentSignedUrl` server action. The VM's service account must have the `iam.serviceAccounts.signBlob` permission — `roles/storage.objectAdmin` includes this.

---

## MinIO Fallback

If `GCP_BUCKET_NAME` is not set (or GCS is unreachable), the app automatically falls back to MinIO. MinIO is always available as a Docker service in all environments. See `docker-compose.dev.yml` for the local setup.

To verify MinIO is running locally:

```bash
# MinIO S3-compatible health endpoint
curl http://localhost:9000/minio/health/live

# Browser console (dev only)
open http://localhost:9001
# Login: lms_minio_dev / lms_minio_secret_dev
```
