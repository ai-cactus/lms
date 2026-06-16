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
 *   --yes               Actually perform the deletion. WITHOUT it the script is
 *                       a DRY RUN that only prints what would be removed.
 *   --allow-non-video   Also delete provided IDs whose type is not 'video'.
 *   --keep-files        Delete DB rows only; leave object-storage blobs in place.
 *
 * Examples:
 *   # See what would happen (safe):
 *   npx tsx scripts/delete-video-courses.ts 1a2b 3c4d
 *   # Do it for real, including storage purge:
 *   npx tsx scripts/delete-video-courses.ts 1a2b 3c4d --yes
 */

import { loadEnvConfig } from '@next/env';

// Load .env* exactly like Next does, BEFORE importing anything that reads env
// at module-init time (Prisma client, storage providers). Hence the dynamic
// imports inside main().
loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import('../src/lib/prisma');

  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const ids = argv.filter((a) => !a.startsWith('--'));

  const execute = flags.has('--yes');
  const allowNonVideo = flags.has('--allow-non-video');
  const keepFiles = flags.has('--keep-files');

  if (ids.length === 0) {
    console.error(
      'Usage: npx tsx scripts/delete-video-courses.ts <courseId> [courseId...] ' +
        '[--yes] [--allow-non-video] [--keep-files]',
    );
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
    console.warn(`⚠  Not found (skipped): ${missing.join(', ')}`);
  }
  if (!allowNonVideo && nonVideo.length) {
    console.warn(
      `⚠  Skipping non-video courses (pass --allow-non-video to include): ` +
        nonVideo.map((c) => `${c.id} [${c.type}]`).join(', '),
    );
  }
  if (targetIds.length === 0) {
    console.error('No matching courses to delete. Aborting.');
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
  console.log(`\nCourses to delete (${targets.length}):`);
  for (const c of targets) {
    console.log(`  - ${c.id} ${c.isGlobal ? '[global] ' : ''}${c.title} (${c.type})`);
  }
  console.log('\nRelated records that will be removed:');
  console.log(`  modules:        ${moduleCount}`);
  console.log(`  lessons:        ${lessonCount}`);
  console.log(`  quizzes:        ${quizCount}`);
  console.log(`  enrollments:    ${enrollmentCount}`);
  console.log(`  quiz attempts:  ${attemptCount}`);
  console.log(`  certificates:   ${certCount}`);
  console.log(`  offerings:      ${offeringCount}`);
  console.log(`  assignments:    ${assignmentCount}`);
  console.log(`  storage blobs:  ${fileUris.length}${keepFiles ? ' (kept — --keep-files)' : ''}`);

  if (!execute) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --yes to execute.\n');
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
  console.log(`\n✓ Deleted ${targetIds.length} course(s) and all related DB records.`);

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
        console.warn(`  ! failed to delete ${uri}: ${(err as Error).message}`);
      }
    }
    console.log(`✓ Storage: ${ok} blob(s) deleted, ${fail} failed.`);
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../src/lib/prisma');
    await prisma.$disconnect();
  });
