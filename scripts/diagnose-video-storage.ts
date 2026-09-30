#!/usr/bin/env node
/**
 * READ-ONLY diagnostic for the system-video storage prefix.
 *
 * WHERE THIS RUNS: a FULL-SOURCE environment — a local checkout, or the staging
 * container — because it uses the generated Prisma client (`@/generated/prisma`)
 * + the `PrismaPg` driver adapter, mirroring db/index.ts. It CANNOT run in the
 * standalone production container (that image ships no `/app/src` and no
 * generated-client source). To reconcile PRODUCTION data from the standalone
 * box, use the SQL + `gcloud storage ls` fallback documented in the runbook
 * instead — it needs no app code.
 *
 * It reconciles what the database references against what actually exists in the
 * bucket — WITHOUT deleting anything:
 *
 *   • MISSING  — a lesson/course/artifact row points at a `system/videos/`
 *                object that no longer exists in storage. This is the damage:
 *                every course here fails to play. After re-uploading it should
 *                be empty.
 *   • ORPHAN   — an object exists under `system/videos/` that nothing in the DB
 *                references. This is what the sweeper would delete. A referenced
 *                count of 0 while objects exist is the "delete everything" state.
 *   • MATCHED  — referenced AND present. These are the videos that play.
 *
 * Usage (inside the container, env already present):
 *   docker cp scripts/diagnose-video-storage.ts lms-production-app:/app/scripts/
 *   docker exec -it lms-production-app npx tsx scripts/diagnose-video-storage.ts
 *
 * Never mutates the database or storage. Safe to run anytime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { Storage } from '@google-cloud/storage';
import { logger } from '@/lib/logger';

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
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
  ].filter(Boolean) as string[];
  for (const c of candidates) loadEnvFile(path.resolve(process.cwd(), c));
}

loadEnv();

const SWEEP_PREFIX = 'system/videos/';

/** Build a GCS client the same way src/lib/storage/gcs-provider.ts does. */
function makeGcs(): { storage: Storage; bucket: string } {
  const bucket = process.env.GCP_BUCKET_NAME;
  if (!bucket) throw new Error('GCP_BUCKET_NAME is not set');

  const rawKey = process.env.GCS_KEY_BASE64;
  if (rawKey) {
    const parsed = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8')) as {
      client_email: string;
      private_key: string;
    };
    const storage = new Storage({
      projectId: process.env.GOOGLE_PROJECT_ID,
      credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
    });
    return { storage, bucket };
  }
  // Local dev: ADC.
  return { storage: new Storage(), bucket };
}

function sample<T>(items: T[], n = 10): T[] {
  return items.slice(0, n);
}

async function main(): Promise<void> {
  // Mirror db/index.ts: the generated client requires the PrismaPg driver adapter.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const { storage, bucket } = makeGcs();

    logger.info({
      msg: `[diagnose-video-storage] Reconciling prefix "${SWEEP_PREFIX}" against the database.`,
    });
    logger.info({ msg: `[diagnose-video-storage] GCP_BUCKET_NAME = ${bucket}` });

    // 1. Everything the DB references (the exact three columns the sweeper trusts).
    const [lessonVideos, previewVideos, artifacts] = await Promise.all([
      prisma.lesson.findMany({
        where: { videoStorageUri: { not: null } },
        select: { videoStorageUri: true },
      }),
      prisma.course.findMany({
        where: { previewVideoStorageUri: { not: null } },
        select: { previewVideoStorageUri: true },
      }),
      prisma.courseArtifact.findMany({ select: { storageUri: true } }),
    ]);

    const referenced = new Set<string>();
    for (const l of lessonVideos) if (l.videoStorageUri) referenced.add(l.videoStorageUri);
    for (const c of previewVideos)
      if (c.previewVideoStorageUri) referenced.add(c.previewVideoStorageUri);
    for (const a of artifacts) if (a.storageUri) referenced.add(a.storageUri);

    const referencedInPrefix = [...referenced].filter((uri) => uri.includes(SWEEP_PREFIX));

    // 2. Everything that actually exists in GCS under the prefix.
    const [files] = await storage.bucket(bucket).getFiles({ prefix: SWEEP_PREFIX });
    const present = new Set(files.map((f) => `gcs://${bucket}/${f.name}`));

    // 3. Reconcile (only gcs:// referenced URIs can be checked against a GCS listing).
    const gcsReferenced = referencedInPrefix.filter((uri) => uri.startsWith('gcs://'));
    const missing = gcsReferenced.filter((uri) => !present.has(uri));
    const matched = gcsReferenced.filter((uri) => present.has(uri));
    const orphans = [...present].filter((uri) => !referenced.has(uri));

    logger.info({
      msg: '[diagnose-video-storage] ── Referenced-set health ──────────────────────────────────',
    });
    logger.info({
      msg: `[diagnose-video-storage] DB URIs under prefix:     ${referencedInPrefix.length}`,
    });
    logger.info({
      msg: `[diagnose-video-storage] ...present in storage:    ${matched.length}   (these play)`,
    });
    logger.info({
      msg: `[diagnose-video-storage] ...MISSING from storage:  ${missing.length}   (these are broken)`,
    });
    logger.info({
      msg: '[diagnose-video-storage] ── Bucket vs DB ───────────────────────────────────────────',
    });
    logger.info({ msg: `[diagnose-video-storage] Objects in storage:       ${present.size}` });
    logger.info({
      msg: `[diagnose-video-storage] ...ORPHAN (unreferenced): ${orphans.length}   (sweeper deletion candidates)`,
    });

    if (present.size > 0 && matched.length === 0) {
      logger.info({
        msg: '[diagnose-video-storage] ⚠  DANGER: objects exist but ZERO are referenced. A sweep in this',
      });
      logger.info({
        msg: '[diagnose-video-storage] state would delete the entire prefix. Do NOT enable the sweeper.',
      });
    }

    if (missing.length > 0) {
      logger.info({
        msg: `[diagnose-video-storage] ── ${missing.length} MISSING object(s) — DB points at storage that is gone ──`,
      });
      for (const uri of sample(missing)) logger.info({ msg: `[diagnose-video-storage] ✗ ${uri}` });
      if (missing.length > 10)
        logger.info({ msg: `[diagnose-video-storage] … and ${missing.length - 10} more` });
    }

    if (orphans.length > 0) {
      logger.info({
        msg: `[diagnose-video-storage] ── ${orphans.length} ORPHAN object(s) — present but unreferenced ──`,
      });
      for (const uri of sample(orphans)) logger.info({ msg: `[diagnose-video-storage] • ${uri}` });
      if (orphans.length > 10)
        logger.info({ msg: `[diagnose-video-storage] … and ${orphans.length - 10} more` });
    }

    if (missing.length === 0 && present.size > 0) {
      logger.info({
        msg: '[diagnose-video-storage] ✓ Every referenced video is present in storage. Playback should be healthy.',
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  logger.error({
    msg: '[diagnose-video-storage] Fatal',
    err,
  });
  process.exit(1);
});
