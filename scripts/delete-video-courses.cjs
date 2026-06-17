/*
 * Self-contained version of delete-video-courses for running INSIDE the app
 * container via `docker exec` (no tsx, no TypeScript, no src/ imports — only
 * @prisma/client and the minio SDK, both already present in the app image).
 *
 * ⚠  IRREVERSIBLE. Hard-deletes the given video courses and ALL related data
 *    (modules, lessons, quizzes, questions, enrollments, quiz attempts,
 *    certificates/attestations, offerings, assignments, reminders) and — unless
 *    --keep-files — purges the associated MinIO blobs (lesson videos, preview
 *    videos, course artifacts, certificate PDFs).
 *
 * Scope: the exact course IDs you pass. Only type='video' courses are deleted
 * unless you pass --allow-non-video. Env (DATABASE_URL, MINIO_*) is read from
 * the container's own environment.
 *
 * How to run (on the staging server):
 *   docker cp scripts/delete-video-courses.cjs lms-staging-app:/app/dvc.cjs
 *   # dry run (read-only):
 *   docker exec -it -w /app lms-staging-app node dvc.cjs <courseId> [courseId...]
 *   # execute for real:
 *   docker exec -it -w /app lms-staging-app node dvc.cjs <courseId> [courseId...] --yes
 *
 * Flags: --yes  --allow-non-video  --keep-files
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── MinIO helpers (mirror src/lib/storage/minio-provider.ts) ──────────────────
function getMinioClient() {
  const Minio = require('minio');
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'lms_minio_dev',
    secretKey: process.env.MINIO_SECRET_KEY || 'lms_minio_secret_dev',
  });
}

function parseUri(uri) {
  const m = String(uri).match(/^(gcs|minio):\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { backend: m[1], bucket: m[2], key: m[3] };
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const ids = argv.filter((a) => !a.startsWith('--'));

  const execute = flags.has('--yes');
  const allowNonVideo = flags.has('--allow-non-video');
  const keepFiles = flags.has('--keep-files');

  if (ids.length === 0) {
    console.error(
      'Usage: node dvc.cjs <courseId> [courseId...] [--yes] [--allow-non-video] [--keep-files]',
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in this environment.');
    process.exit(1);
  }

  const courses = await prisma.course.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, type: true, isGlobal: true },
  });
  const foundIds = new Set(courses.map((c) => c.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  const nonVideo = courses.filter((c) => c.type !== 'video');
  const targets = allowNonVideo ? courses : courses.filter((c) => c.type === 'video');
  const targetIds = targets.map((c) => c.id);

  if (missing.length) console.warn('⚠  Not found (skipped): ' + missing.join(', '));
  if (!allowNonVideo && nonVideo.length) {
    console.warn(
      '⚠  Skipping non-video (pass --allow-non-video to include): ' +
        nonVideo.map((c) => `${c.id} [${c.type}]`).join(', '),
    );
  }
  if (targetIds.length === 0) {
    console.error('No matching courses to delete. Aborting.');
    process.exit(1);
  }

  // Collect storage URIs + counts BEFORE deletion.
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
    ...lessonVideos.map((l) => l.videoStorageUri),
    ...previewVideos.map((c) => c.previewVideoStorageUri),
    ...artifacts.map((a) => a.storageUri),
    ...certPdfs.map((c) => c.pdfStoragePath),
  ].filter(Boolean);

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

  // Enrollments first (cascades attempts + certificates), then courses (cascades
  // modules, lessons, quizzes, questions, artifacts, versions, offerings,
  // assignments, reminders).
  await prisma.$transaction([
    prisma.enrollment.deleteMany({ where: { courseId: { in: targetIds } } }),
    prisma.course.deleteMany({ where: { id: { in: targetIds } } }),
  ]);
  console.log(`\n✓ Deleted ${targetIds.length} course(s) and all related DB records.`);

  if (!keepFiles && fileUris.length > 0) {
    let client;
    try {
      client = getMinioClient();
    } catch (err) {
      console.warn('  ! minio SDK unavailable — skipping storage purge: ' + err.message);
      client = null;
    }
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    for (const uri of fileUris) {
      const parsed = parseUri(uri);
      if (!parsed || parsed.backend !== 'minio' || !client) {
        skipped++;
        console.warn(`  · skipped (not a MinIO URI or no client): ${uri}`);
        continue;
      }
      try {
        await client.removeObject(parsed.bucket, parsed.key);
        ok++;
      } catch (err) {
        if (err && err.code === 'NoSuchKey') {
          ok++; // already gone
        } else {
          fail++;
          console.warn(`  ! failed to delete ${uri}: ${err.message}`);
        }
      }
    }
    console.log(`✓ Storage: ${ok} deleted, ${fail} failed, ${skipped} skipped.`);
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
