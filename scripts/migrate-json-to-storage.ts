/**
 * Migration Script: Move Course JSON data to Object Storage
 *
 * Reads large JSON fields from the Course table, uploads them to
 * GCS/MinIO, and records the storage URIs in the CourseArtifact table.
 *
 * Usage:
 *   npx tsx scripts/migrate-json-to-storage.ts [--dry-run] [--batch-size=50]
 *
 * Flags:
 *   --dry-run       Log what would be migrated without actually uploading
 *   --batch-size=N  Process N courses at a time (default: 50)
 *
 * The legacy JSON columns are NOT cleared by default. After verifying
 * the migration, run with --cleanup to null out the legacy columns.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { uploadFile } from '../src/lib/storage';

const prisma = new PrismaClient();

const JSON_FIELDS: { column: string; artifactType: string }[] = [
  { column: 'rawCourseJson', artifactType: 'course_json' },
  { column: 'rawQuizJson', artifactType: 'quiz' },
  { column: 'rawArticleMeta', artifactType: 'article_meta' },
  { column: 'rawJudgeJson', artifactType: 'judge' },
  { column: 'rawSlidesJson', artifactType: 'slides' },
];

// article_markdown is a String column, not Json
const STRING_FIELDS: { column: string; artifactType: string }[] = [
  { column: 'rawArticleMarkdown', artifactType: 'article_markdown' },
];

interface MigrationStats {
  coursesProcessed: number;
  artifactsCreated: number;
  errors: string[];
  skipped: number;
}

async function migrateCourseJsonToStorage(
  dryRun = false,
  batchSize = 50,
  cleanup = false,
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    coursesProcessed: 0,
    artifactsCreated: 0,
    errors: [],
    skipped: 0,
  };

  // Process courses in batches
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const courses = await prisma.course.findMany({
      select: {
        id: true,
        rawCourseJson: true,
        rawQuizJson: true,
        rawArticleMeta: true,
        rawArticleMarkdown: true,
        rawJudgeJson: true,
        rawSlidesJson: true,
      },
      skip: offset,
      take: batchSize,
      orderBy: { id: 'asc' },
    });

    if (courses.length === 0) {
      hasMore = false;
      break;
    }

    for (const course of courses) {
      stats.coursesProcessed++;

      for (const field of [...JSON_FIELDS, ...STRING_FIELDS]) {
        const value = (course as Record<string, unknown>)[field.column];
        if (!value) continue;

        // Check if artifact already exists
        const existing = await prisma.courseArtifact.findFirst({
          where: { courseId: course.id, type: field.artifactType },
        });
        if (existing) {
          stats.skipped++;
          continue;
        }

        if (dryRun) {
          console.log(
            `[DRY RUN] Would migrate ${field.artifactType} for course ${course.id} (${JSON.stringify(value).length} bytes)`,
          );
          stats.artifactsCreated++;
          continue;
        }

        try {
          const buffer = Buffer.from(
            typeof value === 'string' ? value : JSON.stringify(value),
            'utf-8',
          );
          const storagePath = `courses/${course.id}/${field.artifactType}-v1.json`;
          const { storageUri } = await uploadFile(storagePath, buffer, 'application/json');

          await prisma.courseArtifact.create({
            data: {
              courseId: course.id,
              type: field.artifactType,
              storageUri,
              sizeBytes: buffer.length,
              version: 1,
            },
          });

          stats.artifactsCreated++;
          console.log(
            `✓ Migrated ${field.artifactType} for course ${course.id} → ${storageUri}`,
          );
        } catch (error) {
          const msg = `Failed to migrate ${field.artifactType} for course ${course.id}: ${error instanceof Error ? error.message : String(error)}`;
          console.error(msg);
          stats.errors.push(msg);
        }
      }

      // Cleanup: null out legacy columns after successful migration
      if (cleanup && !dryRun) {
        try {
          await prisma.course.update({
            where: { id: course.id },
            data: {
              rawCourseJson: Prisma.DbNull,
              rawQuizJson: Prisma.DbNull,
              rawArticleMeta: Prisma.DbNull,
              rawArticleMarkdown: null,
              rawJudgeJson: Prisma.DbNull,
              rawSlidesJson: Prisma.DbNull,
            },
          });
          console.log(`✓ Cleaned up legacy JSON for course ${course.id}`);
        } catch (error) {
          const msg = `Failed to cleanup course ${course.id}: ${error instanceof Error ? error.message : String(error)}`;
          console.error(msg);
          stats.errors.push(msg);
        }
      }
    }

    offset += courses.length;
    console.log(
      `Processed ${offset} courses... (${stats.artifactsCreated} artifacts created, ${stats.errors.length} errors)`,
    );
  }

  return stats;
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cleanup = args.includes('--cleanup');
  const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 50;

  console.log('=== Course JSON → Object Storage Migration ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Cleanup legacy columns: ${cleanup}`);
  console.log(`Batch size: ${batchSize}`);
  console.log('');

  try {
    const stats = await migrateCourseJsonToStorage(dryRun, batchSize, cleanup);

    console.log('');
    console.log('=== Migration Summary ===');
    console.log(`Courses processed: ${stats.coursesProcessed}`);
    console.log(`Artifacts created: ${stats.artifactsCreated}`);
    console.log(`Skipped (already exist): ${stats.skipped}`);
    console.log(`Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('');
      console.log('Errors:');
      stats.errors.forEach((e) => console.log(`  - ${e}`));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
