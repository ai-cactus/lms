#!/usr/bin/env node
/**
 * READ-ONLY diagnostic for the system-video storage prefix.
 *
 * Reconciles what the database references against what actually exists in the
 * bucket — WITHOUT deleting anything — so we can see, concretely:
 *
 *   • MISSING   — a lesson/course/artifact row points at a `system/videos/`
 *                 object that no longer exists in storage. This is the current
 *                 damage: every course here fails to play. After re-uploading,
 *                 this list should be empty.
 *
 *   • ORPHAN    — an object exists under `system/videos/` that nothing in the DB
 *                 references. This is exactly what the sweeper would delete.
 *                 A HEALTHY system has a small, explicable number here (raw
 *                 uploads superseded by a `normalized/` transcode, still inside
 *                 the grace window). A pathological state is `referenced === 0`
 *                 with many orphans — that is the "delete everything" footgun.
 *
 *   • MATCHED   — referenced AND present. These are the videos that play.
 *
 * It mirrors the sweeper's own reconciliation (video-sweep-worker.ts) so its
 * output is directly comparable to what the sweeper would have decided.
 *
 * Usage (inside the container, with production env available):
 *   docker exec -it <container> npx tsx scripts/diagnose-video-storage.ts
 *   # or locally against a specific env file:
 *   npx tsx scripts/diagnose-video-storage.ts --env-file=.env.production
 *
 * It never mutates the database or storage. Safe to run anytime.
 */

import fs from 'node:fs';
import path from 'node:path';

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

/** Load env BEFORE importing prisma/storage (both read env at module init). */
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

function sample<T>(items: T[], n = 10): T[] {
  return items.slice(0, n);
}

async function main(): Promise<void> {
  // Dynamic imports AFTER loadEnv so the storage client and Prisma pick up env.
  // Relative (not `@/…`) paths: tsx's tsconfig-paths resolution does not apply
  // to dynamic import() specifiers in the deployed container. Mirrors the
  // relative import in scripts/delete-video-courses.ts.
  const { default: prisma } = await import('../src/lib/prisma');
  const { listFiles } = await import('../src/lib/storage');

  const bucket = process.env.GCP_BUCKET_NAME ?? '(GCP_BUCKET_NAME unset)';
  console.log(`\nReconciling prefix "${SWEEP_PREFIX}" against the database.`);
  console.log(`GCP_BUCKET_NAME = ${bucket}\n`);

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
  for (const c of previewVideos) if (c.previewVideoStorageUri) referenced.add(c.previewVideoStorageUri);
  for (const a of artifacts) if (a.storageUri) referenced.add(a.storageUri);

  // Only URIs that actually live under the swept prefix are relevant here.
  const referencedInPrefix = [...referenced].filter((uri) => uri.includes(SWEEP_PREFIX));

  // 2. Everything that actually exists in storage under the prefix.
  const objects = await listFiles(SWEEP_PREFIX);
  const present = new Set(objects.map((o) => o.storageUri));

  // 3. Reconcile.
  const missing = referencedInPrefix.filter((uri) => !present.has(uri));
  const matched = referencedInPrefix.filter((uri) => present.has(uri));
  const orphans = objects.map((o) => o.storageUri).filter((uri) => !referenced.has(uri));

  console.log('── Referenced-set health ──────────────────────────────────');
  console.log(`  DB URIs under prefix:     ${referencedInPrefix.length}`);
  console.log(`  ...present in storage:    ${matched.length}   (these play)`);
  console.log(`  ...MISSING from storage:  ${missing.length}   (these are broken)`);
  console.log('');
  console.log('── Bucket vs DB ───────────────────────────────────────────');
  console.log(`  Objects in storage:       ${objects.length}`);
  console.log(`  ...ORPHAN (unreferenced): ${orphans.length}   (sweeper deletion candidates)`);
  console.log('');

  // The single most important guardrail signal: a referenced set that matches
  // nothing while objects exist is the "delete everything" footgun.
  if (objects.length > 0 && matched.length === 0) {
    console.log('  ⚠  DANGER: objects exist but ZERO are referenced. A sweep in this');
    console.log('     state would delete the entire prefix. Do NOT enable the sweeper.');
    console.log('');
  }

  if (missing.length > 0) {
    console.log(`── ${missing.length} MISSING object(s) — DB points at storage that is gone ──`);
    for (const uri of sample(missing)) console.log(`  ✗ ${uri}`);
    if (missing.length > 10) console.log(`  … and ${missing.length - 10} more`);
    console.log('');
  }

  if (orphans.length > 0) {
    console.log(`── ${orphans.length} ORPHAN object(s) — present but unreferenced ──`);
    for (const uri of sample(orphans)) console.log(`  • ${uri}`);
    if (orphans.length > 10) console.log(`  … and ${orphans.length - 10} more`);
    console.log('');
  }

  if (missing.length === 0 && objects.length > 0) {
    console.log('✓ Every referenced video is present in storage. Playback should be healthy.\n');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[diagnose-video-storage] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
