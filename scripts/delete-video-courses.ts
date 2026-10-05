/**
 * Permanently delete video courses and ALL of their related data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠  THIS IS IRREVERSIBLE.  It HARD-deletes:
 *      • the Course rows themselves
 *      • modules, lessons, course/lesson quizzes and their questions
 *      • enrollments, quiz attempts, certificates and attestation history
 *      • org offerings, course assignments and their reminders
 *      • course artifacts / versions
 *    and (unless --keep-files) PURGES the associated blobs from object storage
 *    (lesson videos, preview videos, course artifacts, certificate PDFs).
 *
 *    Compliance note: enrollments / certificates / attestations are normally
 *    retained. This script removes them. Only run it when you really mean it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Scope: the EXACT course IDs you pass on the command line. By default only
 * courses with type='video' are touched; any non-video IDs are skipped unless
 * you pass --allow-non-video.
 *
 * Usage:
 *   npx tsx scripts/delete-video-courses.ts <courseId> [courseId...] [flags]
 *
 * Flags:
 *   --dry-run           Print what would be removed, delete nothing.
 *   --allow-non-video   Also delete provided IDs whose type is not 'video'.
 *   --keep-files        Delete DB rows only; leave object-storage blobs in place.
 *   --env-file=<path>   Load env vars from this file (in addition to the usual
 *                       .env*). Useful when DATABASE_URL/storage creds aren't in
 *                       the shell (e.g. staging injects them via the container's env_file).
 *                       Real environment vars always take precedence.
 *
 * Examples:
 *   # See what would happen (safe):
 *   npx tsx scripts/delete-video-courses.ts 1a2b 3c4d --dry-run
 *   # Do it for real, including storage purge:
 *   npx tsx scripts/delete-video-courses.ts 1a2b 3c4d
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/db/index';
import { logger } from '@/lib/logger';

/**
 * Minimal .env loader (no deps) — fills process.env WITHOUT overwriting any
 * variable already present in the real environment. Returns true if the file
 * existed.
 */
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

/**
 * Load env BEFORE importing anything that reads it at module-init time (Prisma
 * client, storage providers) — hence the dynamic imports inside main(). Honors
 * an explicit `--env-file=<path>` and otherwise tries the usual files. Vars
 * already set in the real environment (e.g. injected via env_file on staging)
 * always win.
 */
function loadEnv(): void {
  const explicit = process.argv.find((a) => a.startsWith('--env-file='));
  const candidates = [
    explicit ? explicit.slice('--env-file='.length) : null,
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.staging',
  ].filter(Boolean) as string[];
  for (const c of candidates) loadEnvFile(path.resolve(process.cwd(), c));
}

loadEnv();

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const ids = argv.filter((a) => !a.startsWith('--'));

  const dryRun = flags.has('--dry-run');
  const allowNonVideo = flags.has('--allow-non-video');
  const keepFiles = flags.has('--keep-files');

  if (ids.length === 0) {
    logger.error({
      msg:
        '[delete-video-courses] Usage: npx tsx scripts/delete-video-courses.ts <courseId> [courseId...] ' +
        '[--dry-run] [--allow-non-video] [--keep-files] [--env-file=<path>]',
    });
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    logger.error({
      msg:
        '[delete-video-courses] DATABASE_URL is not set. Provide it via your environment or --env-file. Examples:\n' +
        '  DATABASE_URL="postgresql://…" npx tsx scripts/delete-video-courses.ts <id>\n' +
        '  npx tsx scripts/delete-video-courses.ts <id> --env-file=.env.production',
    });
    process.exit(1);
  }

  // ── Resolve the target courses ──────────────────────────────────────────────
  const courses = await prisma.course.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, type: true, isGlobal: true },
  });
  const foundIds = new Set(courses.map((c) => c.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  const nonVideo = courses.filter((c) => c.type !== 'video');

  const targets = allowNonVideo ? courses : courses.filter((c) => c.type === 'video');
  const targetIds = targets.map((c) => c.id);

  if (missing.length) {
    logger.warn({ msg: `[delete-video-courses] ⚠  Not found (skipped): ${missing.join(', ')}` });
  }
  if (!allowNonVideo && nonVideo.length) {
    logger.warn({
      msg:
        `[delete-video-courses] ⚠  Skipping non-video courses (pass --allow-non-video to include): ` +
        nonVideo.map((c) => `${c.id} [${c.type}]`).join(', '),
    });
  }
  if (targetIds.length === 0) {
    logger.error({ msg: '[delete-video-courses] No matching courses to delete. Aborting.' });
    process.exit(1);
  }

  // ── Collect related counts + storage URIs (must read BEFORE deleting) ───────
  const [lessonVideos, previewVideos, artifacts, certPdfs] = await Promise.all([
    prisma.lesson.findMany({
      where: { courseId: { in: targetIds }, videoStorageUri: { not: null } },
      select: { videoStorageUri: true },
    }),
    prisma.course.findMany({
      where: { id: { in: targetIds }, previewVideoStorageUri: { not: null } },
      select: { previewVideoStorageUri: true },
    }),
    prisma.courseArtifact.findMany({
      where: { courseId: { in: targetIds } },
      select: { storageUri: true },
    }),
    prisma.certificate.findMany({
      where: { courseId: { in: targetIds }, pdfStoragePath: { not: null } },
      select: { pdfStoragePath: true },
    }),
  ]);

  const moduleCount = await prisma.courseModule.count({ where: { courseId: { in: targetIds } } });
  const lessonCount = await prisma.lesson.count({ where: { courseId: { in: targetIds } } });
  const quizCount =
    (await prisma.quiz.count({ where: { courseId: { in: targetIds } } })) +
    (await prisma.quiz.count({ where: { lesson: { courseId: { in: targetIds } } } }));
  const enrollmentCount = await prisma.enrollment.count({ where: { courseId: { in: targetIds } } });
  const attemptCount = await prisma.quizAttempt.count({
    where: { enrollment: { courseId: { in: targetIds } } },
  });
  const certCount = await prisma.certificate.count({ where: { courseId: { in: targetIds } } });
  const offeringCount = await prisma.orgCourseOffering.count({
    where: { courseId: { in: targetIds } },
  });
  const assignmentCount = await prisma.courseAssignment.count({
    where: { courseId: { in: targetIds } },
  });

  const fileUris = [
    ...lessonVideos.map((l) => l.videoStorageUri as string),
    ...previewVideos.map((c) => c.previewVideoStorageUri as string),
    ...artifacts.map((a) => a.storageUri),
    ...certPdfs.map((c) => c.pdfStoragePath as string),
  ];

  // ── Summary ─────────────────────────────────────────────────────────────────
  logger.info({ msg: `[delete-video-courses] Courses to delete (${targets.length})` });
  for (const c of targets) {
    logger.info({
      msg: `[delete-video-courses] - ${c.id} ${c.isGlobal ? '[global] ' : ''}${c.title} (${c.type})`,
    });
  }
  logger.info({ msg: '[delete-video-courses] Related records that will be removed' });
  logger.info({ msg: `[delete-video-courses] modules:        ${moduleCount}` });
  logger.info({ msg: `[delete-video-courses] lessons:        ${lessonCount}` });
  logger.info({ msg: `[delete-video-courses] quizzes:        ${quizCount}` });
  logger.info({ msg: `[delete-video-courses] enrollments:    ${enrollmentCount}` });
  logger.info({ msg: `[delete-video-courses] quiz attempts:  ${attemptCount}` });
  logger.info({ msg: `[delete-video-courses] certificates:   ${certCount}` });
  logger.info({ msg: `[delete-video-courses] offerings:      ${offeringCount}` });
  logger.info({ msg: `[delete-video-courses] assignments:    ${assignmentCount}` });
  logger.info({
    msg: `[delete-video-courses] storage blobs:  ${fileUris.length}${keepFiles ? ' (kept — --keep-files)' : ''}`,
  });

  if (dryRun) {
    logger.info({
      msg: '[delete-video-courses] DRY RUN — nothing was deleted. Re-run without --dry-run to execute.',
    });
    return;
  }

  // ── Delete DB rows ──────────────────────────────────────────────────────────
  // Enrollments first: that cascades quiz attempts + certificates, which would
  // otherwise block the course delete (Enrollment.course / Certificate.course /
  // QuizAttempt.quiz are RESTRICT). Deleting the course then cascades modules,
  // lessons, quizzes, questions, artifacts, versions, offerings, assignments and
  // reminders.
  await prisma.$transaction([
    prisma.enrollment.deleteMany({ where: { courseId: { in: targetIds } } }),
    prisma.course.deleteMany({ where: { id: { in: targetIds } } }),
  ]);
  logger.info({
    msg: `[delete-video-courses] ✓ Deleted ${targetIds.length} course(s) and all related DB records.`,
  });

  // ── Purge storage blobs (best-effort) ───────────────────────────────────────
  if (!keepFiles && fileUris.length > 0) {
    const { deleteFile } = await import('../src/lib/storage');
    let ok = 0;
    let fail = 0;
    for (const uri of fileUris) {
      try {
        await deleteFile(uri);
        ok++;
      } catch (err) {
        fail++;
        logger.warn({
          msg: `[delete-video-courses] ! failed to delete ${uri}: ${(err as Error).message}`,
        });
      }
    }
    logger.info({
      msg: `[delete-video-courses] ✓ Storage: ${ok} blob(s) deleted, ${fail} failed.`,
    });
  }
}

main()
  .catch((err) => {
    logger.error({ msg: '[delete-video-courses] Failed', err });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
