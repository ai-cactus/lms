/**
 * BullMQ Worker: Orphaned Avatar Sweeper (RISK-17)
 *
 * Each run reconciles the `avatars/` object prefix against `User.avatarUrl`:
 *
 *   1. List objects under `avatars/` from ONLY the backend this environment
 *      writes to (listFilesForActiveBackend) — never a merged GCS+MinIO view.
 *   2. Drop anything still inside the grace window: an upload whose profile save
 *      has not happened yet.
 *   3. Keep any object whose key is not `avatars/<userId>/<file>`, or whose
 *      `<userId>` has no row in this database (see the owner check below).
 *   4. Keep any object whose key a `User.avatarUrl` references.
 *   5. Delete the rest in small batches (per-item failures are isolated).
 *
 * SAFETY — mirrors video-sweep-worker.ts, whose sweeper deleted production
 * videos from a non-prod environment holding prod credentials:
 *   - OPT-IN: starts only when AVATAR_SWEEP_ENABLED === 'true'.
 *   - OWNERSHIP INTERLOCK: refuses unless AVATAR_SWEEP_OWNER_APP_URL exactly
 *     equals APP_URL, which survives an env file being copied between
 *     environments.
 *   - FAIL-SAFE DRY RUN: deletes only when AVATAR_SWEEP_DRY_RUN === 'false'.
 *   - PREFIX SCOPE: every candidate key is re-checked against `avatars/` after
 *     listing, so a provider that interprets the prefix loosely cannot widen it.
 *   - OWNER CHECK: an object is a candidate only when its `<userId>` exists in
 *     this database. A process pointed at another environment's bucket finds no
 *     such users, so it deletes nothing even with every other gate passed.
 *   - EMPTY-REFERENCE-SET guardrail: aborts if no user references an avatar
 *     while aged objects exist (wrong DB / deploy window).
 *   - DELETION CAP: a real run with more orphans than AVATAR_SWEEP_MAX_DELETES
 *     aborts entirely (no partial deletes).
 */

import { Worker } from 'bullmq';
import { redis } from './redis';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { listFilesForActiveBackend, deleteFile, parseStorageUri } from '@/lib/storage';
import {
  AVATAR_SWEEP_QUEUE_NAME,
  avatarSweepQueue,
  type AvatarSweepJobData,
} from './avatar-sweep-queue';

declare global {
  var __avatarSweepWorker: Worker | undefined;
}

const SWEEP_PREFIX = 'avatars/';

/** Matches the key `uploadAvatar` writes: `avatars/<userId>/<timestamp>-<name>`. */
const AVATAR_KEY_PATTERN = /^avatars\/([^/]+)\/[^/]+$/;

const SWEEP_SCHEDULER_ID = 'avatar-sweep';
const DELETE_BATCH_SIZE = 10;
const DEFAULT_GRACE_PERIOD_HOURS = 24;
const DEFAULT_CRON = '30 3 * * *';
const DEFAULT_MAX_DELETES = 50;

export interface AvatarSweepOptions {
  /** Objects whose createdAt is within this window are skipped (too new). */
  gracePeriodMs: number;
  /** When true, log what WOULD be deleted but delete nothing. */
  dryRun: boolean;
}

export interface AvatarSweepSummary {
  /** Total objects listed under the prefix. */
  total: number;
  /** Objects skipped because they are still inside the grace window. */
  graceFiltered: number;
  /** Aged objects kept because their key is not an `avatars/<userId>/<file>` key. */
  unrecognized: number;
  /** Aged objects kept because their `<userId>` has no row in this database. */
  unknownOwner: number;
  /** Aged objects a `User.avatarUrl` references (kept). */
  referenced: number;
  /** Aged, owned, unreferenced objects (deletion candidates). */
  orphaned: number;
  /** Orphans actually deleted (always 0 in dry-run). */
  deleted: number;
  /** Orphan deletions that failed. */
  errors: number;
  /** Which guardrail aborted the sweep before any deletion; `null` if none did. */
  aborted: 'empty-reference-set' | 'delete-cap-exceeded' | null;
}

function storageKeyOf(uri: string): string | null {
  try {
    return parseStorageUri(uri).key;
  } catch {
    return null;
  }
}

/**
 * Object KEYS every `User.avatarUrl` points at. Keys rather than full URIs, so
 * an avatar stored under another bucket or backend name still protects the same
 * key here — the comparison can only err towards keeping an object.
 *
 * Soft-deleted users (Q-23) keep their row and are included: their stored photo
 * is still referenced.
 */
async function buildReferencedKeySet(): Promise<Set<string>> {
  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { avatarUrl: true },
  });
  const keys = new Set<string>();
  for (const { avatarUrl } of users) {
    const key = avatarUrl ? storageKeyOf(avatarUrl) : null;
    if (key) keys.add(key);
  }
  return keys;
}

async function findExistingUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Pure, unit-testable sweep. Never throws on an individual delete failure —
 * those are counted in `errors`. A failed listing or query does throw, so the
 * job fails rather than acting on a partial view.
 */
export async function runAvatarSweep(options: AvatarSweepOptions): Promise<AvatarSweepSummary> {
  const { gracePeriodMs, dryRun } = options;
  const cutoff = Date.now() - gracePeriodMs;

  logger.info({ msg: '[AvatarSweep] Starting sweep', prefix: SWEEP_PREFIX, gracePeriodMs, dryRun });

  const allObjects = await listFilesForActiveBackend(SWEEP_PREFIX);
  const total = allObjects.length;

  const aged = allObjects.filter((obj) => obj.createdAt.getTime() < cutoff);
  const graceFiltered = total - aged.length;

  const recognized: { storageUri: string; key: string; ownerId: string }[] = [];
  for (const obj of aged) {
    const key = storageKeyOf(obj.storageUri);
    const match = key && !key.split('/').includes('..') ? AVATAR_KEY_PATTERN.exec(key) : null;
    if (key && match) recognized.push({ storageUri: obj.storageUri, key, ownerId: match[1] });
  }
  const unrecognized = aged.length - recognized.length;

  const [referencedKeys, existingOwners] = await Promise.all([
    buildReferencedKeySet(),
    findExistingUserIds([...new Set(recognized.map((obj) => obj.ownerId))]),
  ]);

  const owned = recognized.filter((obj) => existingOwners.has(obj.ownerId));
  const unknownOwner = recognized.length - owned.length;
  if (unknownOwner > 0) {
    logger.warn({
      msg: '[AvatarSweep] Kept avatar objects whose owner is not a user in this database',
      unknownOwner,
    });
  }

  const baseSummary = { total, graceFiltered, unrecognized, unknownOwner };

  if (referencedKeys.size === 0 && aged.length > 0) {
    logger.error({
      msg: `[AvatarSweep] ABORT: no user references an avatar while ${aged.length} aged objects exist — refusing to sweep (likely wrong DB or deploy window)`,
      ...baseSummary,
    });
    const abortedSummary: AvatarSweepSummary = {
      ...baseSummary,
      referenced: 0,
      orphaned: 0,
      deleted: 0,
      errors: 0,
      aborted: 'empty-reference-set',
    };
    logger.info({ msg: '[AvatarSweep] Sweep complete', dryRun, ...abortedSummary });
    return abortedSummary;
  }

  const orphans = owned.filter((obj) => !referencedKeys.has(obj.key));
  const referenced = owned.length - orphans.length;

  const maxDeletes = resolveMaxDeletes();
  if (!dryRun && orphans.length > maxDeletes) {
    logger.error({
      msg: `[AvatarSweep] ABORT: ${orphans.length} orphans exceed delete cap of ${maxDeletes} — refusing to sweep (deleting nothing)`,
      ...baseSummary,
      referenced,
      orphaned: orphans.length,
      maxDeletes,
    });
    const abortedSummary: AvatarSweepSummary = {
      ...baseSummary,
      referenced,
      orphaned: orphans.length,
      deleted: 0,
      errors: 0,
      aborted: 'delete-cap-exceeded',
    };
    logger.info({ msg: '[AvatarSweep] Sweep complete', dryRun, ...abortedSummary });
    return abortedSummary;
  }

  let deleted = 0;
  let errors = 0;

  if (dryRun) {
    for (const orphan of orphans) {
      logger.info({
        msg: '[AvatarSweep] DRY RUN — would delete orphan',
        storageUri: orphan.storageUri,
        userId: orphan.ownerId,
      });
    }
  } else {
    for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
      const batch = orphans.slice(i, i + DELETE_BATCH_SIZE);
      await Promise.all(
        batch.map(async (orphan) => {
          try {
            await deleteFile(orphan.storageUri);
            deleted += 1;
            logger.info({
              msg: '[AvatarSweep] Deleted orphan',
              storageUri: orphan.storageUri,
              userId: orphan.ownerId,
            });
          } catch (err) {
            errors += 1;
            logger.error({
              msg: '[AvatarSweep] Failed to delete orphan',
              storageUri: orphan.storageUri,
              userId: orphan.ownerId,
              err,
            });
          }
        }),
      );
    }
  }

  const summary: AvatarSweepSummary = {
    ...baseSummary,
    referenced,
    orphaned: orphans.length,
    deleted,
    errors,
    aborted: null,
  };

  logger.info({ msg: '[AvatarSweep] Sweep complete', dryRun, ...summary });
  return summary;
}

/** Reads AVATAR_SWEEP_GRACE_PERIOD_HOURS (default 24h) → milliseconds. */
function resolveGracePeriodMs(): number {
  const hours = Number(process.env.AVATAR_SWEEP_GRACE_PERIOD_HOURS);
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_GRACE_PERIOD_HOURS;
  return safeHours * 60 * 60 * 1000;
}

/** FAIL-SAFE: dry-run unless AVATAR_SWEEP_DRY_RUN is EXACTLY the string 'false'. */
function resolveDryRun(): boolean {
  return process.env.AVATAR_SWEEP_DRY_RUN !== 'false';
}

/** Reads AVATAR_SWEEP_MAX_DELETES (default 50). */
function resolveMaxDeletes(): number {
  const cap = Number(process.env.AVATAR_SWEEP_MAX_DELETES);
  return Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_DELETES;
}

/** The bucket a sweep would delete from, mirroring lib/storage's provider precedence. */
function resolveSweepBucket(): string {
  return process.env.GCP_BUCKET_NAME || process.env.MINIO_BUCKET || 'lms-documents';
}

/**
 * Environment-ownership interlock — see video-sweep-worker.ts
 * `resolveOwnershipRefusal` for why APP_URL is the key. Returns null when this
 * environment owns the storage, or the refusal reason.
 */
function resolveOwnershipRefusal(): string | null {
  const ownerAppUrl = process.env.AVATAR_SWEEP_OWNER_APP_URL;
  const appUrl = process.env.APP_URL;

  if (!ownerAppUrl) {
    return (
      '[AvatarSweep] REFUSING to start — AVATAR_SWEEP_ENABLED is "true" but ' +
      'AVATAR_SWEEP_OWNER_APP_URL is not set. Set it to the APP_URL of the single ' +
      'environment that owns this storage bucket.'
    );
  }

  if (ownerAppUrl !== appUrl) {
    return (
      `[AvatarSweep] REFUSING to start — AVATAR_SWEEP_OWNER_APP_URL (${ownerAppUrl}) ` +
      `does not match APP_URL (${appUrl ?? '<unset>'}). This environment does not ` +
      'own the storage it would sweep.'
    );
  }

  return null;
}

/**
 * Install (or update) the cron Job Scheduler. Removes any scheduler under our id
 * first so a changed cron pattern never leaves a stale schedule behind.
 */
async function registerRepeatableJob(cron: string): Promise<void> {
  try {
    const existing = await avatarSweepQueue.getJobSchedulers();
    await Promise.all(
      existing
        .filter((s) => s.id === SWEEP_SCHEDULER_ID)
        .map((s) => avatarSweepQueue.removeJobScheduler(s.id as string)),
    );

    await avatarSweepQueue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { pattern: cron },
      { name: 'sweep' },
    );

    logger.info({ msg: '[AvatarSweep] Registered repeatable sweep schedule', cron });
  } catch (err) {
    logger.error({ msg: '[AvatarSweep] Failed to register repeatable sweep schedule', cron, err });
  }
}

/**
 * Best-effort teardown of a scheduler a previously-enabled deploy left behind, so
 * an environment no longer allowed to sweep also stops PRODUCING sweep jobs.
 */
function removeLingeringScheduler(): void {
  void avatarSweepQueue.removeJobScheduler(SWEEP_SCHEDULER_ID).catch((err) => {
    logger.error({
      msg: '[AvatarSweep] Failed to remove lingering Job Scheduler while refusing to sweep',
      schedulerId: SWEEP_SCHEDULER_ID,
      err,
    });
  });
}

/**
 * Returns the singleton sweep worker, creating it on first call. Returns null —
 * starting nothing and registering no schedule — unless AVATAR_SWEEP_ENABLED is
 * 'true' AND AVATAR_SWEEP_OWNER_APP_URL equals APP_URL. Either refusal also
 * removes a lingering cron Job Scheduler.
 */
export function getAvatarSweepWorker(): Worker | null {
  if (globalThis.__avatarSweepWorker) {
    return globalThis.__avatarSweepWorker;
  }

  if (process.env.AVATAR_SWEEP_ENABLED !== 'true') {
    logger.warn({
      msg: "[AvatarSweep] Disabled (AVATAR_SWEEP_ENABLED !== 'true') — worker not started",
    });
    removeLingeringScheduler();
    return null;
  }

  const ownershipRefusal = resolveOwnershipRefusal();
  if (ownershipRefusal) {
    logger.error({
      msg: ownershipRefusal,
      ownerAppUrl: process.env.AVATAR_SWEEP_OWNER_APP_URL ?? null,
      appUrl: process.env.APP_URL ?? null,
      bucket: resolveSweepBucket(),
    });
    removeLingeringScheduler();
    return null;
  }

  const cron = process.env.AVATAR_SWEEP_CRON || DEFAULT_CRON;
  const dryRun = resolveDryRun();

  logger.info({
    msg: '[AvatarSweep] Starting worker',
    cron,
    gracePeriodMs: resolveGracePeriodMs(),
    dryRun,
  });

  if (!dryRun) {
    logger.warn({
      msg: '[AvatarSweep] LIVE DELETES ARMED — AVATAR_SWEEP_DRY_RUN is "false"; this environment will permanently delete unreferenced avatar uploads',
      appUrl: process.env.APP_URL ?? null,
      bucket: resolveSweepBucket(),
      maxDeletes: resolveMaxDeletes(),
    });
  }

  const worker = new Worker<AvatarSweepJobData, AvatarSweepSummary>(
    AVATAR_SWEEP_QUEUE_NAME,
    // The summary becomes the job's returnvalue, keeping the counts auditable.
    async () => runAvatarSweep({ gracePeriodMs: resolveGracePeriodMs(), dryRun: resolveDryRun() }),
    {
      connection: redis,
      concurrency: 1,
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[AvatarSweep] Sweep job failed', jobId: job?.id, err });
  });

  worker.on('error', (err) => {
    logger.error({ msg: '[AvatarSweep] Worker connection error', err });
  });

  void registerRepeatableJob(cron);

  globalThis.__avatarSweepWorker = worker;
  return worker;
}
