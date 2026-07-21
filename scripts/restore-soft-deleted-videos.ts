#!/usr/bin/env node
/**
 * Restore soft-deleted objects under `system/videos/` in the GCS bucket.
 *
 * Incident 2026-07-21: a dev-machine video sweeper holding prod credentials
 * deleted every prod video as an "orphan" (its local DB had no references).
 * The bucket has a 7-day soft-delete policy, so recent deletions are
 * recoverable — this script lists them and (with --restore) restores each.
 *
 * SELF-CONTAINED: imports only real node_modules (`@google-cloud/storage`) so
 * it runs from any checkout or container without app source. Credentials come
 * from GCS_KEY_BASE64 (base64 service-account JSON) + GCP_BUCKET_NAME,
 * mirroring src/lib/storage/gcs-provider.ts; falls back to ADC if the key var
 * is unset. Loads .env/.env.local without overwriting real env vars.
 *
 * Usage:
 *   npx tsx scripts/restore-soft-deleted-videos.ts             # dry-run (default)
 *   npx tsx scripts/restore-soft-deleted-videos.ts --restore   # actually restore
 *   npx tsx scripts/restore-soft-deleted-videos.ts --env-file=/path/to/.env
 *
 * Behaviour:
 *   • Lists soft-deleted generations under the prefix.
 *   • Groups by object name, keeping only the LATEST generation of each.
 *   • Skips any name that already exists live (never overwrites).
 *   • Dry-run prints what would be restored; --restore performs it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';

const PREFIX = 'system/videos/';

/** Minimal .env loader — fills process.env WITHOUT overwriting real env vars. */
function loadEnvFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

function loadEnv(): void {
  const explicit = process.argv.find((a) => a.startsWith('--env-file='));
  const candidates = [
    explicit ? explicit.slice('--env-file='.length) : null,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
  ].filter((f): f is string => f !== null);
  for (const file of candidates) loadEnvFile(file);
}

function buildStorage(): Storage {
  const rawKey = process.env.GCS_KEY_BASE64;
  if (!rawKey) {
    // No in-memory key — rely on ADC (GOOGLE_APPLICATION_CREDENTIALS / gcloud).
    return new Storage();
  }
  const parsed = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8')) as {
    client_email?: string;
    private_key?: string;
    project_id?: string;
  };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GCS_KEY_BASE64 decoded but is not a service-account key');
  }
  return new Storage({
    projectId: process.env.GOOGLE_PROJECT_ID || parsed.project_id,
    credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
  });
}

interface SoftDeletedEntry {
  name: string;
  generation: string;
  softDeleteTime: string;
  hardDeleteTime: string;
  sizeBytes: number;
}

async function main(): Promise<void> {
  loadEnv();

  const doRestore = process.argv.includes('--restore');
  const bucketName = process.env.GCP_BUCKET_NAME;
  if (!bucketName) {
    console.error('GCP_BUCKET_NAME is not set (env or .env file). Aborting.');
    process.exit(1);
  }

  const storage = buildStorage();
  const bucket = storage.bucket(bucketName);

  console.log(`Bucket: ${bucketName}`);
  console.log(`Prefix: ${PREFIX}`);
  console.log(`Mode:   ${doRestore ? 'RESTORE' : 'dry-run (pass --restore to apply)'}\n`);

  const [liveFiles] = await bucket.getFiles({ prefix: PREFIX });
  const liveNames = new Set(liveFiles.map((f) => f.name));
  console.log(`Live objects under prefix:        ${liveNames.size}`);

  const [softDeletedFiles] = await bucket.getFiles({ prefix: PREFIX, softDeleted: true });
  console.log(`Soft-deleted generations found:   ${softDeletedFiles.length}\n`);

  if (softDeletedFiles.length === 0) {
    console.log(
      'Nothing soft-deleted under the prefix. If videos are still missing, the 7-day\n' +
        'soft-delete window has passed and re-upload is the only recovery.',
    );
    return;
  }

  // Group per-generation entries by name; keep the most recently deleted generation.
  const latestByName = new Map<string, SoftDeletedEntry>();
  for (const f of softDeletedFiles) {
    const entry: SoftDeletedEntry = {
      name: f.name,
      generation: String(f.metadata.generation ?? ''),
      softDeleteTime: String(f.metadata.softDeleteTime ?? ''),
      hardDeleteTime: String(f.metadata.hardDeleteTime ?? ''),
      sizeBytes: Number(f.metadata.size ?? 0),
    };
    const prev = latestByName.get(f.name);
    if (!prev || entry.softDeleteTime > prev.softDeleteTime) {
      latestByName.set(f.name, entry);
    }
  }

  const toRestore = [...latestByName.values()].filter((e) => !liveNames.has(e.name));
  const skippedLive = latestByName.size - toRestore.length;

  console.log('── Soft-deleted objects (latest generation per name) ──────────');
  for (const e of [...latestByName.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const status = liveNames.has(e.name) ? 'SKIP (exists live)' : 'RESTORABLE';
    console.log(
      `  [${status}] ${e.name}\n` +
        `      gen=${e.generation}  deleted=${e.softDeleteTime}  purged-after=${e.hardDeleteTime}  ${(
          e.sizeBytes /
          1024 /
          1024
        ).toFixed(1)}MB`,
    );
  }
  console.log('');
  console.log(`Restorable: ${toRestore.length}   Skipped (already live): ${skippedLive}`);

  if (!doRestore) {
    console.log('\nDry-run complete. Re-run with --restore to restore the objects above.');
    return;
  }

  let restored = 0;
  let failed = 0;
  for (const e of toRestore) {
    try {
      await bucket.file(e.name).restore({ generation: Number(e.generation) });
      restored += 1;
      console.log(`  restored: ${e.name}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED:   ${e.name} — ${(err as Error).message}`);
    }
  }

  console.log(`\nRestore complete. restored=${restored} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
