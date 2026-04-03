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

## 3. Configure IAM — Grant the VM Access

The app reads/writes GCS using **Application Default Credentials (ADC)**. On a GCP VM this resolves to the VM's service account automatically — no key file needed.

### Option A — VM Service Account (Recommended for Production)

Find the VM's service account email:

```bash
gcloud compute instances describe YOUR_VM_NAME \
  --zone=YOUR_ZONE \
  --format='get(serviceAccounts[0].email)'
```

Grant `Storage Object Admin` on the bucket only (principle of least privilege):

```bash
SA_EMAIL="your-vm-sa@your-project.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"
```

### Option B — Local Development (ADC via gcloud)

```bash
gcloud auth application-default login
```

This stores credentials in `~/.config/gcloud/application_default_credentials.json`. The GCS SDK picks them up automatically.

---

## 4. Add to Environment

Set `GCP_BUCKET_NAME` in your environment file:

```dotenv
# .env.production / .env.staging
GCP_BUCKET_NAME=lms-documents-yourcompany
```

**No** `GOOGLE_APPLICATION_CREDENTIALS` key file path is required — ADC handles it.

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
